/**
 * audit —— 决策审计（复用拖即续审计思路）：
 *   - 完整性：检查目标/已做决策是否都有记录
 *   - 查重：相同/相似决策是否重复记录（简单文本相似度）
 *   - 统计：token 估算、条目数
 */

import type { DecisionEntry, DecisionLog } from './store.js'

export interface AuditResult {
  total: number
  pending: number
  accepted: number
  superseded: number
  rejected: number
  /** 最老待确认条目的年龄（天），无 pending 时为 null */
  oldestPendingAgeDays: number | null
  duplicates: Array<{ index: number; decision: string; of: number; reason: string }>
  tokenEstimate: number
  note: string
}

/** 简单相似度：共现词比例 */
function similarity(a: string, b: string): number {
  const norm = (s: string) => new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean))
  const A = norm(a)
  const B = norm(b)
  if (A.size === 0 || B.size === 0) return 0
  let inter = 0
  for (const w of A) if (B.has(w)) inter++
  return inter / Math.min(A.size, B.size)
}

/** 审计决策日志：查重 + 统计 */
export function auditLog(log: DecisionLog, opts: { similarityThreshold?: number } = {}): AuditResult {
  const threshold = opts.similarityThreshold ?? 0.7
  const entries = log.entries
  const pending = entries.filter((e) => e.status === 'pending').length
  const accepted = entries.filter((e) => e.status === 'accepted').length
  const superseded = entries.filter((e) => e.status === 'superseded').length
  const rejected = entries.filter((e) => e.status === 'rejected').length

  const duplicates: AuditResult['duplicates'] = []
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (entries[i].status === 'superseded' || entries[j].status === 'superseded') continue
      const sim = similarity(entries[i].decision, entries[j].decision)
      if (sim >= threshold) {
        duplicates.push({
          index: j,
          decision: entries[j].decision,
          of: i,
          reason: `与 #${i + 1} 「${entries[i].decision}」相似度 ${(sim * 100).toFixed(0)}%`,
        })
      }
    }
  }

  const allText = entries.map((e) => e.decision + ' ' + (e.reason ?? '')).join(' ')
  const asciiLen = (allText.match(/[\x00-\x7f]/g) ?? []).length
  const cjkLen = allText.length - asciiLen
  const tokenEstimate = Math.ceil(asciiLen / 4 + cjkLen / 1.5)

  // 最老待确认条目的年龄（天）；无 pending 为 null
  const now = Date.now()
  let oldestPendingAgeDays: number | null = null
  for (const e of entries) {
    if (e.status !== 'pending') continue
    const t = Date.parse(e.time)
    if (Number.isNaN(t)) continue
    const ageDays = Math.floor((now - t) / 86400000)
    if (oldestPendingAgeDays === null || ageDays > oldestPendingAgeDays) oldestPendingAgeDays = ageDays
  }
  const stalePending = oldestPendingAgeDays !== null && oldestPendingAgeDays >= 7

  return {
    total: entries.length,
    pending,
    accepted,
    superseded,
    rejected,
    oldestPendingAgeDays,
    duplicates: duplicates.slice(0, 20),
    tokenEstimate,
    note: [
      pending > 0 ? `${pending} 条待确认，用 decision_confirm / decision_reject 处理` : '',
      stalePending ? `最老的待确认已 ${oldestPendingAgeDays} 天，建议尽快处理` : '',
      duplicates.length ? `发现 ${duplicates.length} 组疑似重复` : '',
    ].filter(Boolean).join('；') || '无重复记录',
  }
}
