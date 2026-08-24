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
 *   - 钩子 session/event  :启发式识别决策候选（记录候选，不自动落盘）
 *
 * 设计约束：
 *   - 走官方 API（exec.agent.session、ctx.fs、ctx.on），不解析内部日志文件
 *   - 源会话只读，绝不改写
 *   - 单能力注册失败不影响整体
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { appendEntry, emptyLog, parseLog, queryLog, renderSummary, serializeLog, type DecisionEntry, type DecisionLog } from './lib/store.js'
import { extractCandidate } from './lib/extractor.js'
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

export async function apply(ctx: Context): Promise<void> {
  const tools = (ctx as unknown as { tools: { register: (def: unknown) => unknown } }).tools

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
        const seq = (exec as { agent?: { session?: { seq?: number } } })?.agent?.session?.seq
        const sessionId = (exec as { agent?: { session?: { id?: string } } })?.agent?.session?.id ?? 'unknown'
        const entry: DecisionEntry = {
          time: new Date().toISOString(),
          decision,
          context: typeof args.context === 'string' ? args.context : undefined,
          alternatives: Array.isArray(args.alternatives) ? args.alternatives.map(String) : undefined,
          reason: typeof args.reason === 'string' ? args.reason : undefined,
          status: (['accepted', 'superseded', 'rejected'].includes(String(args.status)) ? String(args.status) : 'accepted') as DecisionEntry['status'],
          files: Array.isArray(args.files) ? args.files.map(String) : undefined,
          source: { sessionId, seq },
        }
        const next = appendEntry(log, entry)
        const path = await saveLog(ctx, cwd, next, signal)
        return { ok: true, path, count: next.entries.length, entry }
      },
    }))
  } catch (err) {
    log('warn', `注册 decision_log 失败:${(err as Error).message}`)
  }

  // ---------- 工具 2:decision_list ----------
  try {
    tools.register((defineTool as unknown as AnyFn)({
      name: 'decision_list',
      description: '查询工作区已记录的决策。关键词/状态过滤，最新在前。',
      parameters: {
        keyword: { type: 'string', description: '关键词过滤（可选）' },
        status: { type: 'string', enum: ['accepted', 'superseded', 'rejected'], description: '状态过滤（可选）' },
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

  // ---------- 工具 3:decision_audit ----------
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

  // ---------- 工具 4:decision_export ----------
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
          const a = (args ?? {}) as Record<string, unknown>
          const text = typeof a.text === 'string' ? a.text : String(a.arguments ?? '')
          if (!text.trim()) return '用法:/log-decision <决策内容> [--context 背景] [--reason 理由]'
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
          return `决策已记录:${path}（共 ${next.entries.length} 条）`
        },
      })
    }
  } catch (err) {
    log('warn', `注册 /log-decision 失败:${(err as Error).message}`)
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
          const log0 = await loadLog(ctx, cwd, signal)
          if (log0.entries.length === 0) {
            await saveLog(ctx, cwd, log0, signal)
          }
        }
        const log = await loadLog(ctx, cwd, signal)
        summary = renderSummary(log, INJECT_MAX_CHARS)
      } catch {
        return decision
      }
      if (!summary) return decision
      const last = lastInjected.get(agent as object)
      if (step !== 1 && last === summary) return decision
      lastInjected.set(agent as object, summary)
      return {
        kind: 'enter',
        messages: decision.messages.concat([{
          role: 'user',
          content: [{ type: 'text', text: summary }],
          // 官方插件标记：声明这是插件注入的上下文快照，而非真实用户消息
          source: {
            kind: 'plugin',
            plugin: name,
            form: 'snapshot',
            sections: [{ name: 'decision-log:summary', text: summary }],
          },
        }]),
      }
    }, { prepend: true })
  } catch (err) {
    log('warn', `注册 agent/pre-step 注入失败:${(err as Error).message}`)
  }

  // ---------- 钩子:session/event 启发式识别候选（记录日志，不自动落盘） ----------
  try {
    ;(ctx as any).on?.('session/event', (session: { id: string }, event: unknown) => {
      const candidate = extractCandidate(session?.id ?? 'unknown', event)
      if (candidate) {
        console.log(`[decision-log] 决策候选 ${candidate.kind}:${candidate.text.slice(0, 80)}（如需记录请调用 decision_log 确认）`)
      }
    })
  } catch {
    /* 事件名未知则静默 */
  }

  log('info', 'plugin ready: decision_log / decision_list / decision_audit / decision_export')
}
