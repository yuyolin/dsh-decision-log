/**
 * dsh-decision-log —— 决策日志插件入口
 *
 * 把会话中做出的关键决策沉淀为项目内可版本化的 DECISIONS.md，
 * 并在后续会话自动注入摘要，让决策可追溯、不重复、不推翻。
 *
 * 能力：
 *   - 工具 decision_log   :手动记一条决策（模型显式调用）
 *   - 工具 decision_list  :查询已记录决策
 *   - 工具 decision_audit :审计（查重/统计）
 *   - 工具 decision_export:导出 DECISIONS.md
 *   - 命令 /log-decision  :命令平面记决策（不占模型 token）
 *   - 钩子 agent/pre-step :自动注入决策摘要（防重复讨论）
 *   - 钩子 systemPrompt   :教模型在方案选择时主动记决策
 *
 * 设计约束：
 *   - 走官方 API（exec.agent.session、ctx.fs、ctx.on），不解析内部日志文件
 *   - 源会话只读，绝不改写
 *   - 单能力注册失败不影响整体
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { appendEntry, emptyLog, hasDuplicateDecision, parseLog, queryLog, renderSummary, serializeLog, updateStatusByDecision, validateFiles, type DecisionEntry, type DecisionLog } from './lib/store.js'
import { extractCandidate, type DecisionCandidate } from './lib/candidate.js'
import { auditLog } from './lib/audit.js'

export const name = 'dsh-decision-log'
export const inject = ['tools']

type AnyFn = (...args: any[]) => any

/** 决策文件相对工作区的位置 */
const DECISIONS_FILE = '.dsh/DECISIONS.md'
/** 注入摘要上限 */
const INJECT_MAX_CHARS = 2000

function log(fn: 'info' | 'warn', msg: string): void {
  if (fn === 'warn') console.warn(`[decision-log] ${msg}`)
  else console.log(`[decision-log] ${msg}`)
}

/** 读取工作区的 DECISIONS.md；不存在返回空 log */
async function loadLog(ctx: Context, cwd: string, signal?: AbortSignal): Promise<DecisionLog> {
  try {
    const fs = (ctx as any).fs
    if (fs && typeof fs.readText === 'function') {
      const text = await fs.readText(`${cwd}/${DECISIONS_FILE}`, undefined, signal)
      return parseLog(text)
    }
  } catch {
    /* 文件不存在或不可读 → 空 */
  }
  return emptyLog()
}

/** 写回 DECISIONS.md */
async function saveLog(ctx: Context, cwd: string, log: DecisionLog, signal?: AbortSignal): Promise<string> {
  const fs = (ctx as any).fs
  const text = serializeLog(log)
  if (fs && typeof fs.writeText === 'function') {
    await fs.writeText(`${cwd}/${DECISIONS_FILE}`, text, undefined, signal)
  } else {
    // 兜底：Node 原生写文件（无 ctx.fs 时）
    const { mkdirSync, writeFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const dir = join(cwd, '.dsh')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'DECISIONS.md'), text, 'utf8')
  }
  return `${cwd}/${DECISIONS_FILE}`
}

function cwdOf(exec: { agent?: { session?: { header?: { cwd?: string } } } }): string {
  return exec?.agent?.session?.header?.cwd ?? process.cwd()
}

/** 构建注入消息：官方 createUserMessage 生成稳定 id + 插件来源标记 */
async function buildInjectionMessage(ctx: Context, text: string): Promise<unknown> {
  const { createUserMessage } = await import('@deepseek-ai/dsh-llm')
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: name, form: 'snapshot', sections: [{ name: 'decision-log:summary', text }] },
  })
}

/** summary 缓存：cwd -> { mtimeMs, summary }，文件未变时不重读盘（省 I/O） */
const summaryCache = new Map<string, { mtimeMs: number; summary: string }>()

/** 读取决策摘要（含 mtime 缓存，文件未变时不重读盘）；无内容返回 '' */
async function summaryFor(ctx: Context, cwd: string, signal?: AbortSignal): Promise<string> {
  const file = `${cwd}/${DECISIONS_FILE}`
  let mtimeMs = 0
  try {
    const { statSync } = await import('node:fs')
    mtimeMs = statSync(file).mtimeMs
  } catch {
    /* 文件不存在 → mtime 0 */
  }
  const cached = summaryCache.get(cwd)
  if (cached && cached.mtimeMs === mtimeMs) return cached.summary
  const log = await loadLog(ctx, cwd, signal)
  const summary = renderSummary(log, INJECT_MAX_CHARS)
  summaryCache.set(cwd, { mtimeMs, summary })
  return summary
}

/** 确保工作区已初始化空白 DECISIONS.md（只建一次） */
async function ensureLogFile(ctx: Context, cwd: string, signal?: AbortSignal): Promise<void> {
  const log = await loadLog(ctx, cwd, signal)
  if (log.entries.length === 0) await saveLog(ctx, cwd, log, signal)
}

// ---------- 决策候选队列（自动识别的"潜在决策"，不落盘，等用户/AI 确认） ----------
/** 候选队列：cwd -> 未提示过的候选列表 */
const candidateQueue = new Map<string, DecisionCandidate[]>()
/** 已提示过的候选指纹（防重复提示） */
const promptedCandidates = new Set<string>()

function candidateFingerprint(c: DecisionCandidate): string {
  return `${c.sessionId}:${c.seq ?? ''}:${c.text.slice(0, 40)}`
}

/** 入队候选（带 dedup）；返回入队数 */
function enqueueCandidate(cwd: string, c: DecisionCandidate): number {
  const fp = candidateFingerprint(c)
  if (promptedCandidates.has(fp)) return 0
  promptedCandidates.add(fp)
  const list = candidateQueue.get(cwd) ?? []
  list.push(c)
  candidateQueue.set(cwd, list)
  return 1
}

/** 取走某工作区的全部候选（提示后清空） */
function drainCandidates(cwd: string): DecisionCandidate[] {
  const list = candidateQueue.get(cwd) ?? []
  candidateQueue.delete(cwd)
  return list
}

export async function apply(ctx: Context): Promise<void> {
  const tools = (ctx as unknown as { tools: { register: (def: unknown) => unknown } }).tools

  // ---------- 服务:ctx.decisionLog（暴露给其他插件/UI 调用，对标 OpenViking ctx.provide） ----------
  try {
    const provide = (ctx as any).provide
    if (typeof provide === 'function') {
      provide('decisionLog', {
        /** 查询某工作区的决策 */
        async list(cwd: string, opts?: { keyword?: string; status?: string; limit?: number }) {
          return queryLog(await loadLog(ctx, cwd), opts)
        },
        /** 追加一条决策，返回新总条数 */
        async add(cwd: string, entry: DecisionEntry) {
          const log = appendEntry(await loadLog(ctx, cwd), entry)
          await saveLog(ctx, cwd, log)
          return log.entries.length
        },
      })
    }
  } catch (err) {
    log('warn', `注册 decisionLog 服务失败:${(err as Error).message}`)
  }

  // ---------- 工具 1:decision_log ----------
  try {
    tools.register((defineTool as unknown as AnyFn)({
      name: 'decision_log',
      description:
        '记录一条关键决策：选了什么方案、为什么。决策会追加到工作区 .dsh/DECISIONS.md，后续会话会自动看到，避免重复讨论或被推翻。重要决策（方案选择、技术替换、方向变更）请主动调用。',
      parameters: {
        decision: { type: 'string', required: true, description: '决策内容，如"用 JWT 不用 session cookie"' },
        context: { type: 'string', description: '决策背景（可选）' },
        alternatives: { type: 'array', items: { type: 'string' }, description: '备选方案列表（可选）' },
        reason: { type: 'string', description: '选择理由（可选，建议填写）' },
        status: { type: 'string', enum: ['accepted', 'superseded', 'rejected'], description: '状态，默认 accepted；改主意时用 superseded' },
        files: { type: 'array', items: { type: 'string' }, description: '涉及文件路径（可选）' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args: unknown, value: unknown) => [
          { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) },
        ],
      },
      async execute(args: Record<string, unknown>, exec: unknown) {
        const decision = String(args.decision ?? '').trim()
        if (!decision) throw new Error('decision_log: decision 必填')
        const cwd = cwdOf(exec as { agent?: { session?: { header?: { cwd?: string } } } })
        const signal = (exec as { signal?: AbortSignal })?.signal
        const log = await loadLog(ctx, cwd, signal)
        // 防自污染：已有完全相同的有效决策时拒绝重复记录（排除已推翻/已拒绝的）
        if (hasDuplicateDecision(log, decision)) {
          return {
            ok: false,
            duplicated: true,
            error: `决策已存在:「${decision}」。请勿重复记录；如需改变主意，调用 decision_log 并传 status: superseded 标注旧决策已推翻。`,
            hint: '用 decision_list 查看已有决策；确属新决定才记录。',
          }
        }
        const seq = (exec as { agent?: { session?: { seq?: number } } })?.agent?.session?.seq
        const sessionId = (exec as { agent?: { session?: { id?: string } } })?.agent?.session?.id ?? 'unknown'
        // 文件来源校验（防 AI 幻觉引用）：只在文件真实存在时保留
        const rawFiles = Array.isArray(args.files) ? args.files.map(String) : []
        let droppedFiles: string[] = []
        if (rawFiles.length > 0) {
          try {
            const { existsSync } = await import('node:fs')
            const { resolve } = await import('node:path')
            const existing = new Set<string>()
            for (const f of rawFiles) {
              try {
                const abs = resolve(cwd, f)
                if (existsSync(abs)) existing.add(f)
              } catch { /* 忽略单条校验失败 */ }
            }
            const v = validateFiles(rawFiles, existing)
            droppedFiles = v.dropped
            if (v.kept.length > 0) rawFiles.splice(0, rawFiles.length, ...v.kept)
          } catch { /* 校验失败则保留原始 files（fail-open） */ }
        }
        const entry: DecisionEntry = {
          time: new Date().toISOString(),
          decision,
          context: typeof args.context === 'string' ? args.context : undefined,
          alternatives: Array.isArray(args.alternatives) ? args.alternatives.map(String) : undefined,
          reason: typeof args.reason === 'string' ? args.reason : undefined,
          // 审批门：AI 记录默认 pending（待用户确认），用户手动指定 accepted/rejected 除外
          status: (['accepted', 'superseded', 'rejected'].includes(String(args.status)) ? String(args.status) : 'pending') as DecisionEntry['status'],
          files: rawFiles.length > 0 ? rawFiles : undefined,
          source: { sessionId, seq },
        }
        const next = appendEntry(log, entry)
        const path = await saveLog(ctx, cwd, next, signal)
        const result: Record<string, unknown> = {
          ok: true,
          path,
          count: next.entries.length,
          entry,
          pending: entry.status === 'pending',
          // 提示 AI/用户确认流程
          hint: entry.status === 'pending' ? '该决策已记为"待确认"。请向用户展示，用户确认后调用 decision_confirm，拒绝则调用 decision_reject。' : undefined,
        }
        if (droppedFiles.length > 0) {
          result.droppedFiles = droppedFiles
          result.warning = `以下文件不存在，已从决策中移除：${droppedFiles.join(', ')}`
        }
        return result
      },
    }))
  } catch (err) {
    log('warn', `注册 decision_log 失败:${(err as Error).message}`)
  }

  // ---------- 工具 3:decision_confirm / decision_reject（审批门） ----------
  const registerDecisionVerdict = (toolName: string, status: 'accepted' | 'rejected', verb: string) => {
    try {
      tools.register((defineTool as unknown as AnyFn)({
        name: toolName,
        description: `将一条"待确认"的决策标记为 ${verb}。用 decision_list 或决策摘要找到那条待确认决策，传入其决策内容。`,
        parameters: {
          decision: { type: 'string', required: true, description: '要确认/拒绝的决策内容（与记录时一致）' },
        },
        output: {
          schema: { type: 'object', additionalProperties: true },
          render: (_a: unknown, v: unknown) => [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }],
        },
        async execute(args: Record<string, unknown>, exec: unknown) {
          const decision = String(args.decision ?? '').trim()
          if (!decision) throw new Error(`${toolName}: decision 必填`)
          const cwd = cwdOf(exec as { agent?: { session?: { header?: { cwd?: string } } } })
          const signal = (exec as { signal?: AbortSignal })?.signal
          const log = await loadLog(ctx, cwd, signal)
          const r = updateStatusByDecision(log, decision, status)
          if (!r.found) return { ok: false, error: `未找到决策:「${decision}」`, hint: '先调用 decision_list 确认准确的决策内容' }
          await saveLog(ctx, cwd, r.log, signal)
          return { ok: true, decision, status, count: r.log.entries.length }
        },
      }))
    } catch (err) {
      log('warn', `注册 ${toolName} 失败:${(err as Error).message}`)
    }
  }
  registerDecisionVerdict('decision_confirm', 'accepted', '已确认')
  registerDecisionVerdict('decision_reject', 'rejected', '已拒绝')

  // ---------- 工具 3:decision_audit ----------
  try {
    tools.register((defineTool as unknown as AnyFn)({
      name: 'decision_list',
      description: '查询工作区已记录的决策。关键词/状态过滤，最新在前。',
      parameters: {
        keyword: { type: 'string', description: '关键词过滤（可选）' },
        status: { type: 'string', enum: ['pending', 'accepted', 'superseded', 'rejected'], description: '状态过滤（可选）' },
        limit: { type: 'number', description: '返回条数，默认 20，最大 200' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args: unknown, value: unknown) => [
          { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) },
        ],
      },
      async execute(args: Record<string, unknown>, exec: unknown) {
        const cwd = cwdOf(exec as { agent?: { session?: { header?: { cwd?: string } } } })
        const signal = (exec as { signal?: AbortSignal })?.signal
        const log = await loadLog(ctx, cwd, signal)
        const result = queryLog(log, {
          keyword: typeof args.keyword === 'string' ? args.keyword : undefined,
          status: typeof args.status === 'string' ? args.status : undefined,
          limit: typeof args.limit === 'number' ? args.limit : undefined,
        })
        return { ok: true, count: result.length, entries: result }
      },
    }))
  } catch (err) {
    log('warn', `注册 decision_list 失败:${(err as Error).message}`)
  }

  // ---------- 工具 4:decision_audit ----------
  try {
    tools.register((defineTool as unknown as AnyFn)({
      name: 'decision_audit',
      description: '审计工作区决策日志：查重、状态统计、token 估算。',
      parameters: {},
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args: unknown, value: unknown) => [
          { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) },
        ],
      },
      async execute(_args: Record<string, unknown>, exec: unknown) {
        const cwd = cwdOf(exec as { agent?: { session?: { header?: { cwd?: string } } } })
        const signal = (exec as { signal?: AbortSignal })?.signal
        const log = await loadLog(ctx, cwd, signal)
        return { ok: true, ...auditLog(log) }
      },
    }))
  } catch (err) {
    log('warn', `注册 decision_audit 失败:${(err as Error).message}`)
  }

  // ---------- 工具 5:decision_export ----------
  try {
    tools.register((defineTool as unknown as AnyFn)({
      name: 'decision_export',
      description: '把工作区已记录的决策导出为标准 DECISIONS.md（已自动落盘，此工具用于查看当前内容或强制重建）。',
      parameters: {},
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args: unknown, value: unknown) => [
          { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) },
        ],
      },
      async execute(_args: Record<string, unknown>, exec: unknown) {
        const cwd = cwdOf(exec as { agent?: { session?: { header?: { cwd?: string } } } })
        const signal = (exec as { signal?: AbortSignal })?.signal
        const log = await loadLog(ctx, cwd, signal)
        const path = await saveLog(ctx, cwd, log, signal)
        return { ok: true, path, count: log.entries.length, content: serializeLog(log) }
      },
    }))
  } catch (err) {
    log('warn', `注册 decision_export 失败:${(err as Error).message}`)
  }

  // ---------- 命令:/log-decision ----------
  try {
    const commands = (ctx as any).get?.('commands') ?? (ctx as any).commands as
      | { register?: (def: Record<string, unknown>) => unknown }
      | undefined
    if (commands && typeof commands.register === 'function') {
      commands.register({
        name: 'log-decision',
        description: '手动记录一条决策（命令平面，不占模型 token）',
        usage: '/log-decision <决策内容> [--context 背景] [--reason 理由]',
        handler: async (args: unknown) => {
          try {
            const a = (args ?? {}) as Record<string, unknown>
            const text = typeof a.text === 'string' ? a.text : String(a.arguments ?? '')
            if (!text.trim()) return { kind: 'error', text: '用法:/log-decision <决策内容> [--context 背景] [--reason 理由]' }
            // 解析 --key value 或 --key=value
            const m = text.match(/(--\w+\s+[^--]+|--\w+=\S+)/g) ?? []
            let decision = text
            const fields: Record<string, string> = {}
            for (const part of m) {
              const kv = part.startsWith('--') ? part.slice(2) : part
              const [k, ...rest] = kv.split(/[= ]/)
              fields[k] = rest.join(' ').trim() || 'true'
              decision = decision.replace(part, '')
            }
            const cwd = process.env.DSH_WORKSPACE ?? process.cwd()
            const log = await loadLog(ctx, cwd)
            const entry: DecisionEntry = {
              time: new Date().toISOString(),
              decision: decision.trim(),
              context: fields.context,
              reason: fields.reason,
              status: 'accepted',
            }
            const next = appendEntry(log, entry)
            const path = await saveLog(ctx, cwd, next)
            return { kind: 'success', text: `决策已记录:${path}（共 ${next.entries.length} 条）` }
          } catch (err) {
            return { kind: 'error', text: `记录失败:${(err as Error).message}` }
          }
        },
      })
    }
  } catch (err) {
    log('warn', `注册 /log-decision 失败:${(err as Error).message}`)
  }

  // ---------- 钩子:session/event 自动识别决策候选（入队不落盘，提示由 pre-step 做） ----------
  try {
    ;(ctx as any).on?.('session/event', (session: { id?: string; header?: { cwd?: string } }, event: unknown) => {
      const cwd = session?.header?.cwd
      if (!cwd) return
      const candidate = extractCandidate(session.id ?? 'unknown', event)
      if (candidate) enqueueCandidate(cwd, candidate)
    })
  } catch (err) {
    log('warn', `注册 session/event 候选识别失败:${(err as Error).message}`)
  }

  // ---------- 钩子:agent/pre-step 自动注入决策摘要 ----------
  try {
    const lastInjected = new WeakMap<object, string>()
    // 记录已初始化过空白文件的 cwd，避免每次 pre-step 都检查磁盘
    const ensuredCwd = new Set<string>()
    ;(ctx as any).on?.('agent/pre-step', async ({ agent, step, signal }: { agent: { session?: { header?: { cwd?: string } } }; step: number; signal: AbortSignal }, next: AnyFn) => {
      const decision = await next()
      if (decision?.kind === 'reject' || signal?.aborted) return decision
      const cwd = agent?.session?.header?.cwd
      if (!cwd) return decision
      let summary: string
      try {
        // 首次遇到该工作区：确保空白 DECISIONS.md 已创建（给 AI 读的"小本本"）
        if (!ensuredCwd.has(cwd)) {
          ensuredCwd.add(cwd)
          await ensureLogFile(ctx, cwd, signal)
        }
        summary = await summaryFor(ctx, cwd, signal)
      } catch {
        return decision
      }
      if (!summary) return decision
      const last = lastInjected.get(agent as object)
      if (step !== 1 && last === summary) return decision
      lastInjected.set(agent as object, summary)
      // 决策摘要注入
      const messages = [await buildInjectionMessage(ctx, summary)]
      // 候选提示注入：检测到潜在决策时提醒 AI 询问用户（不自动落盘）
      const candidates = drainCandidates(cwd)
      if (candidates.length > 0) {
        const hint = '检测到潜在决策（自动识别，未记录）：\n' + candidates.map((c) => `- ${c.text}`).join('\n') + '\n如需记录，请询问用户后调用 decision_log；若与已有决策重复或无关，忽略即可。'
        messages.push(await buildInjectionMessage(ctx, hint))
      }
      return {
        kind: 'enter',
        messages: decision.messages.concat(messages),
      }
    }, { prepend: true })
  } catch (err) {
    log('warn', `注册 agent/pre-step 注入失败:${(err as Error).message}`)
  }

  // ---------- 钩子:agent/session-start 开局注入决策摘要（对标 OpenViking 同款机制） ----------
  try {
    ;(ctx as any).on?.('agent/session-start', async ({ agent }: { agent: { session?: { header?: { cwd?: string } }; status?: string; inject?: (m: unknown) => void } }) => {
      const cwd = agent?.session?.header?.cwd
      if (!cwd || agent?.status !== 'idle') return
      try {
        await ensureLogFile(ctx, cwd)
        const summary = await summaryFor(ctx, cwd)
        if (!summary) return
        const message = await buildInjectionMessage(ctx, summary)
        // 空闲时注入开局摘要（不打断进行中的工作）
        agent.inject?.(message)
      } catch (err) {
        log('warn', `session-start 注入失败:${(err as Error).message}`)
      }
    })
  } catch (err) {
    log('warn', `注册 agent/session-start 失败:${(err as Error).message}`)
  }

  // ---------- systemPrompt 引导:教模型在方案选择时主动记决策 ----------
  try {
    const systemPrompt = (ctx as any).get?.('systemPrompt') ?? (ctx as any).systemPrompt as
      | { section?: (def: Record<string, unknown>) => unknown }
      | undefined
    if (systemPrompt && typeof systemPrompt.section === 'function') {
      ;(ctx as any).effect?.(() => systemPrompt.section({
        name: 'decision-log:instructions',
        order: 200,
        text:
          '【决策日志】调用 decision_log 工具记录决策（选了什么 + 为什么），时机：① 用户批准方案后、开始写代码前 ② 技术选型/方向变更时 ③ 推翻旧决策时。记录后以"待确认"状态落盘，请把决策内容展示给用户，用户确认后调用 decision_confirm、拒绝则调用 decision_reject。重要决策不要只留在对话里，要落盘到 .dsh/DECISIONS.md 供后续会话复用。\n' +
          '【可见归属】当你依据 DECISIONS.md 中的决策记录回答问题时，请用引用块标注来源，格式：> 📌 依据 .dsh/DECISIONS.md（决策名）。拿不准是否相关时也要标注——让用户看到决策记忆在被使用，比隐藏价值更好。\n' +
          '【防自污染】不要因为用户复述了注入的决策摘要就重复记录；除非用户明确说"新决定/改主意"，否则不调用 decision_log。',
      }), 'decision-log.section()')
    }
  } catch (err) {
    log('warn', `注册 systemPrompt 引导失败:${(err as Error).message}`)
  }

  log('info', 'plugin ready: decision_log / decision_list / decision_audit / decision_export')
}
