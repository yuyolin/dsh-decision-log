/**
 * store —— DECISIONS.md 读写、解析、序列化（纯逻辑，无 DSH 依赖，可独立单测）
 *
 * 文件格式（ADR 风格，git 友好）：
 *
 *   ---
 *   schema: dsh-decision-log/v1
 *   updated_at: 2026-08-24T16:00:00+08:00
 *   count: 3
 *   ---
 *
 *   ## [2026-08-24T15:30:00+08:00] 用 JWT 不用 session cookie
 *   - 状态: accepted
 *   - 上下文: 登录模块改造
 *   - 备选: [session cookie, OAuth]
 *   - 理由: 跨端无状态，避免 session 同步
 *   - 涉及文件: src/auth/session.ts
 *   - 来源: session-abc123 (seq 42)
 */

export interface DecisionEntry {
  time: string          // ISO 时间戳
  decision: string      // 决策内容（标题行）
  status: 'pending' | 'accepted' | 'superseded' | 'rejected'
  context?: string      // 背景
  alternatives?: string[] // 备选方案
  reason?: string       // 理由
  files?: string[]      // 涉及文件
  source?: { sessionId: string; seq?: number }
}

export interface DecisionLog {
  entries: DecisionEntry[]
}

const HEADER = '# DECISIONS'
const FORMAT_TAG = '<!-- dsh-decision-log v1 -->'

const ENTRY_RE = /^## \[([^\]]+)\]\s+(.+)$/
const FIELD_RE = /^-\s*([^:：]+)[:：]\s*(.*)$/

export function emptyLog(): DecisionLog {
  return { entries: [] }
}

/** 解析 DECISIONS.md 文本 → { entries }。未知行忽略，CRLF 归一化。 */
export function parseLog(text: string): DecisionLog {
  const entries: DecisionEntry[] = []
  let current: DecisionEntry | null = null
  let extra: string[] = []
  const flushExtra = () => {
    if (current !== null && extra.length) {
      current.decision = current.decision + ' ' + extra.join(' ')
    }
    extra = []
  }
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trimEnd()
    const match = ENTRY_RE.exec(line)
    if (match !== null) {
      flushExtra()
      current = {
        time: match[1],
        decision: match[2].trim(),
        status: 'accepted',
      }
      entries.push(current)
    } else if (current !== null) {
      const field = FIELD_RE.exec(line)
      if (field !== null) {
        const key = field[1].trim()
        const value = field[2].trim()
        if (key === '状态' || key === 'status') {
          const v = (value === 'superseded' || value === 'rejected' || value === 'pending' ? value : 'accepted') as DecisionEntry['status']
          current.status = v
        }
        else if (key === '上下文' || key === 'context') current.context = value
        else if (key === '备选' || key === 'alternatives') current.alternatives = parseList(value)
        else if (key === '理由' || key === 'reason') current.reason = value
        else if (key === '涉及文件' || key === 'files') current.files = parseList(value)
        else if (key === '来源' || key === 'source') {
          const sm = /([a-zA-Z0-9-]+)\s*\(seq\s*(\d+)\)/.exec(value)
          if (sm) current.source = { sessionId: sm[1], seq: Number(sm[2]) }
          else if (value) current.source = { sessionId: value }
        }
        else extra.push(line)
      } else if (line.trim() !== '') {
        extra.push(line)
      }
    }
  }
  flushExtra()
  return { entries }
}

/** 列表字段解析："[a, b, c]" 或 "a | b | c" */
function parseList(raw: string): string[] {
  let s = raw.trim()
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1)
  if (!s) return []
  return s.split(/[|,]/).map((x) => x.trim()).filter(Boolean)
}

function fmtList(list: string[] | undefined): string | undefined {
  if (!list || list.length === 0) return undefined
  return '[' + list.join(', ') + ']'
}

/** 序列化 entries → markdown 文本（追加友好：旧在前） */
export function serializeLog(log: DecisionLog): string {
  const body = log.entries.map(renderEntry).join('\n\n')
  return body.length === 0
    ? HEADER + '\n\n' + FORMAT_TAG + '\n'
    : HEADER + '\n\n' + FORMAT_TAG + '\n\n' + body + '\n'
}

function renderEntry(e: DecisionEntry): string {
  const lines = [`## [${e.time}] ${e.decision}`]
  lines.push(`- 状态: ${e.status}`)
  if (e.context) lines.push(`- 上下文: ${e.context}`)
  const alts = fmtList(e.alternatives)
  if (alts) lines.push(`- 备选: ${alts}`)
  if (e.reason) lines.push(`- 理由: ${e.reason}`)
  const files = fmtList(e.files)
  if (files) lines.push(`- 涉及文件: ${files}`)
  if (e.source) {
    const s = e.source.seq !== undefined ? `${e.source.sessionId} (seq ${e.source.seq})` : e.source.sessionId
    lines.push(`- 来源: ${s}`)
  }
  return lines.join('\n')
}

/** 追加一条决策，返回新 log（不可变） */
export function appendEntry(log: DecisionLog, entry: DecisionEntry): DecisionLog {
  return { entries: [...log.entries, entry] }
}

/** 查询：关键词 / 状态过滤，最新在前 */
export function queryLog(log: DecisionLog, opts: { keyword?: string; status?: string; limit?: number } = {}): DecisionEntry[] {
  let list = [...log.entries].reverse()
  if (opts.status) list = list.filter((e) => e.status === opts.status)
  if (opts.keyword) {
    const k = opts.keyword.toLowerCase()
    list = list.filter((e) =>
      e.decision.toLowerCase().includes(k) ||
      (e.context ?? '').toLowerCase().includes(k) ||
      (e.reason ?? '').toLowerCase().includes(k) ||
      (e.alternatives ?? []).some((a) => a.toLowerCase().includes(k)),
    )
  }
  const limit = opts.limit ?? 20
  return list.slice(0, Math.max(1, Math.min(limit, 200)))
}

/** 渲染摘要（模型注入用）：最新在前，cap 字符数 */
export function renderSummary(log: DecisionLog, maxChars = 2000): string {
  const list = [...log.entries].reverse()
  const blocks: string[] = []
  let total = 0
  const statusLabel: Record<string, string> = { pending: '待确认', accepted: 'accepted', superseded: 'superseded', rejected: 'rejected' }
  for (const e of list) {
    const block = `- [${statusLabel[e.status] ?? e.status}] ${e.decision}` + (e.reason ? ` — ${e.reason}` : '')
    if (total + block.length + 1 > maxChars) break
    blocks.push(block)
    total += block.length + 1
  }
  if (blocks.length === 0) return ''
  const omitted = log.entries.length - blocks.length
  const pendingCount = log.entries.filter((e) => e.status === 'pending').length
  const head = `已有 ${log.entries.length} 条决策记录${pendingCount > 0 ? `（其中 ${pendingCount} 条待确认，请说'确认'或'拒绝'）` : '（勿重复讨论，如需推翻请先说明理由）'}：`
  return head + '\n' + blocks.join('\n') + (omitted > 0 ? `\n(... 其余 ${omitted} 条见 .dsh/DECISIONS.md)` : '')
}

/** 按决策标题精确匹配，更新状态；返回是否找到并更新（用于 decision_confirm / decision_reject） */
export function updateStatusByDecision(log: DecisionLog, decision: string, status: DecisionEntry['status']): { log: DecisionLog; found: boolean } {
  const target = decision.trim()
  if (!target) return { log, found: false }
  const idx = log.entries.findIndex((e) => e.decision.trim() === target)
  if (idx === -1) return { log, found: false }
  const entry = { ...log.entries[idx], status }
  const entries = [...log.entries]
  entries[idx] = entry
  return { log: { entries }, found: true }
}
