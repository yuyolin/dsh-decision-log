/**
 * candidate —— 从会话事件识别"决策候选"（纯逻辑，可单测）
 *
 * 设计依据（学自顶级记忆插件）：
 *   - 只识别"可能产生决策"的信号，不自动落盘（保持克制 + 审批门精神）
 *   - goal/change  → 目标变更本身就是一次决策
 *   - tool/call    → 写类操作（write/delete/rename/rewrite）意味着"改了什么"，可能是决策
 *
 * 输出候选信号，由宿主决定是否提示用户/AI 记录。
 */

export interface DecisionCandidate {
  kind: 'goal' | 'tool'
  sessionId: string
  seq?: number
  time?: string
  /** 候选描述（简短，给用户/AI 看） */
  text: string
}

/** 目标变更事件的 objective 字段取值 */
function goalObjective(data: unknown): string {
  const d = (data ?? {}) as { goal?: { objective?: unknown } }
  return typeof d.goal?.objective === 'string' ? d.goal.objective.trim() : ''
}

/** 写类工具名（小写匹配）：这些操作意味着"项目状态被改变" */
const WRITE_TOOL_RE =
  /^(write|write_file|create|create_file|edit|edit_file|replace|rename|move|delete|remove|rm|rewrite|refactor|migrate|update|apply_patch|patch|add|install|uninstall|set|enable|disable)/

/** 工具调用的 name 字段 */
function toolName(data: unknown): string {
  return String((data as { name?: unknown })?.name ?? '')
}

/** 工具调用的 arguments 字段（可能是字符串或对象） */
function toolArgsText(data: unknown): string {
  const args = (data as { arguments?: unknown })?.arguments
  if (typeof args === 'string') return args
  if (args && typeof args === 'object') {
    try {
      return JSON.stringify(args).slice(0, 120)
    } catch {
      return ''
    }
  }
  return ''
}

/**
 * 从一条 session event 提取决策候选；非候选返回 null。
 * 事件形状：{ type, seq?, time?, data? }（dsh SessionEvent）
 */
export function extractCandidate(sessionId: string, event: unknown): DecisionCandidate | null {
  if (!event || typeof event !== 'object') return null
  const ev = event as { type?: unknown; seq?: unknown; time?: unknown; data?: unknown }
  const type = typeof ev.type === 'string' ? ev.type : ''
  const base = {
    sessionId,
    seq: typeof ev.seq === 'number' ? ev.seq : undefined,
    time: typeof ev.time === 'number' ? new Date(ev.time).toISOString() : undefined,
  }

  if (type === 'goal/change') {
    const objective = goalObjective(ev.data)
    if (objective) {
      return { ...base, kind: 'goal', text: `目标变更为：${objective.slice(0, 200)}` }
    }
    return null
  }

  if (type === 'tool/call') {
    const name = toolName(ev.data)
    if (WRITE_TOOL_RE.test(name.toLowerCase())) {
      const args = toolArgsText(ev.data)
      return {
        ...base,
        kind: 'tool',
        text: `执行了写操作 ${name}${args ? `(${args})` : ''}`,
      }
    }
    return null
  }

  return null
}
