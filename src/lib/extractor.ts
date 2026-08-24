/**
 * extractor —— 从会话事件流启发式识别"决策候选"（确定性，不靠 LLM）
 *
 * 识别模式：
 *   1. goal/change   —— 目标变更本身就是一次决策（objective 文本）
 *   2. tool/call     —— 涉及替换/改用/选择的工具名（如 write_file 覆盖、git mv、npm install 换包）
 *   3. assistant/message —— 含方案对比/权衡/决定话术的文本（仅作为候选标记，正文由 decision_log 落盘）
 *
 * 本模块只输出"候选信号"，不落盘——落盘由用户确认或 decision_log 工具执行。
 */

export interface DecisionCandidate {
  kind: 'goal' | 'tool' | 'text'
  sessionId: string
  seq?: number
  time?: string
  text: string
  /** 相关文件路径（若有） */
  files?: string[]
}

/** 涉及决策的工具名模式（小写匹配） */
const DECISION_TOOL_RE =
  /^(replace|rename|move|delete|install|add|remove|uninstall|switch|change|rewrite|migrate|refactor|write|update|set|enable|disable)/

/** 方案对比/决定话术 */
const DECISION_TEXT_RE =
  /(决定|选择|采用|改用|换成|放弃|不选|优先|考虑到|权衡|相比之下|方案[AB一二三123]|用.+(而|不)用|相比.+更)/

/** 从一条 session event 提取决策候选；非候选返回 null */
export function extractCandidate(sessionId: string, event: unknown): DecisionCandidate | null {
  if (!event || typeof event !== 'object') return null
  const ev = event as { type?: string; data?: unknown; seq?: number; time?: number }
  const type = ev.type ?? ''
  const data = (ev.data ?? {}) as Record<string, unknown>
  const base = { sessionId, seq: ev.seq, time: ev.time !== undefined ? new Date(ev.time).toISOString() : undefined }

  if (type === 'goal/change') {
    const objective = (data as { goal?: { objective?: string } }).goal?.objective
    if (typeof objective === 'string' && objective.trim()) {
      return { ...base, kind: 'goal', text: `目标变更为：${objective.trim().slice(0, 200)}` }
    }
    return null
  }

  if (type === 'tool/call') {
    const name = String((data as { name?: string }).name ?? '')
    const args = (data as { arguments?: unknown }).arguments
    if (DECISION_TOOL_RE.test(name.toLowerCase())) {
      let argText = ''
      if (typeof args === 'string') argText = args.slice(0, 120)
      else if (args && typeof args === 'object') argText = JSON.stringify(args).slice(0, 120)
      return { ...base, kind: 'tool', text: `工具调用 ${name}(${argText})` }
    }
    return null
  }

  if (type === 'assistant/message' || type === 'user/message') {
    const msg = (data as { message?: { content?: unknown } }).message
    const content = (msg as { content?: unknown } | undefined)?.content
    let text = ''
    if (Array.isArray(content)) {
      text = content.filter((b) => (b as { type?: string }).type === 'text')
        .map((b) => (b as { text?: string }).text ?? '').join('\n')
    } else if (typeof content === 'string') {
      text = content
    }
    if (text && DECISION_TEXT_RE.test(text)) {
      return { ...base, kind: 'text', text: text.slice(0, 200) }
    }
    return null
  }

  return null
}
