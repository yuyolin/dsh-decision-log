/**
 * audit —— 决策审计（复用拖即续审计思路）：
 *   - 完整性：检查目标/已做决策是否都有记录
 *   - 查重：相同/相似决策是否重复记录（简单文本相似度）
 *   - 统计：token 估算、条目数
 */

import type { DecisionEntry, DecisionLog } from './store.js'

export interface AuditResult {
  total: number
  accepted: number
  superseded: number
  rejected: number
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

  return {
    total: entries.length,
    accepted,
    superseded,
    rejected,
    duplicates: duplicates.slice(0, 20),
    tokenEstimate,
    note: duplicates.length
      ? `发现 ${duplicates.length} 组疑似重复，建议用 decision_log 标记 superseded 或用 decision_export 手工整理`
      : '无重复记录',
  }
}
