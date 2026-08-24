# dsh 记忆型插件横纵对比（市场分析）

> 更新日期：2026-08-25 | 数据来源：awesome-dsh-plugin 市场 catalog（memory 类共 106 个）+ 已读源码的插件实测机制
> 目的：说明 dsh-decision-log 的市场定位与差异化

---

## 一、定位象限图（记忆形态 × 自动化程度）

```
                        全自动 / 每轮注入
                                ▲
       OpenViking 32.5k★        │   dsh-memento / dsh-mneme
       hindsight 20.9k★         │   meow-memory / auto-memory
              │                 │
  对话/事实记忆 ├─────────────────┼──► 决策/结构化记忆
   engramory   │                 │
   dsh-memory  │                 │  ★ dsh-decision-log（我们）
   dsh-memoir  │                 │    决策专用 · 手动记 + 自动注入
   deja-vu     │                 │
              ▼                 │
                        手动 / 按需
```

**核心洞察**：绝大多数记忆插件扎堆在左半边（对话/事实记忆），决策/结构化记忆区几乎空白——dsh-decision-log 是少数明确聚焦"决策"的插件。

## 二、横向：市场记忆插件全景（106 个中取 16 个代表）

| 插件 | ★ | 存储介质 | 记忆对象 | 注入方式 | 自动化 |
|---|---|---|---|---|---|
| OpenViking | 32.5k | 云端服务 | 对话+画像 | pre-step 注入+recall | 全自动 |
| hindsight | 20.9k | 云/本地银行 | 知识页+反思 | pre-step 召回 | 全自动 |
| deja-vu | 683 | 读他 AI 文件 | 其他工具会话 | 工具按需 | 手动 |
| MisakaNet | 424 | 本地库 | 失败教训 | BM25+RAG 检索 | 半自动 |
| dsh-mnemon | 192 | 本地+图谱 | 项目档案 | 语义召回+UI | 半自动 |
| engramory | 171 | 纯 MD（一事实一文件） | 事实 | 索引注入(200行上限) | 半自动 |
| dsh-noema | 124 | 本地+图谱 | 长期记忆 | 搜索+浏览工具 | 半自动 |
| dsh-memory(Git) | 68 | Git | 引用+排序 | 工具读取 | 半自动 |
| dsh-memento | 60 | SQLite | 分层记忆 | 冻结快照注入 | 全自动 |
| dsh-mneme | 39 | SQLite+MD镜像 | 实体时间轴 | autoDream 巩固 | 全自动 |
| billion-context | 39 | —(压缩) | 上下文压缩 | 模型决定压缩 | 全自动 |
| meow-memory | 38 | SQLite 七层 | soul/project/fact/lesson | 关键词命中注入 | 全自动 |
| auto-memory | 27 | 本地三层 | 自动沉淀 | 精简注入+提醒 | 全自动 |
| dsh-memoir | 20 | 本地 JSON+MD | 项目记忆 | 有界热记忆注入 | 全自动 |
| **dsh-decision-log(我们)** | 🆕 | **纯 MD** | **决策+理由** | **手动记+自动注入** | **双通道** |

## 三、纵向：我们 vs 三个"最像"的深度对比（已读源码）

| 维度 | **dsh-decision-log** | **dsh-plugin-focus** | **dsh-memento** | **dsh-meow-memory** |
|---|---|---|---|---|
| 记忆对象 | **决策（选什么+为什么）** | 目标/约束/决策 | 分层通用记忆 | 七类混合记忆 |
| 存储 | **MD（任何 AI 可读）** | MD | SQLite | SQLite 七层 |
| 写入方式 | **手动记录+AI 主动** | 手动 focus 工具 | 审批门+工具 | 全自动每轮沉淀 |
| 注入 | **session-start + pre-step 双保险** | pre-step 单点 | 冻结快照 | 关键词命中 |
| 审计/查重 | ✅ decision_audit | ❌ | ✅ 可审计 | ❌ |
| 状态管理 | ✅ accepted/superseded | ❌ | ✅ 分层 | ❌ |
| 依赖 | **零依赖（纯 MD）** | 零依赖 | SQLite(零依赖) | node:sqlite |
| 定位独特性 | **决策生命周期管理** | 专注板 | 通用记忆 | 综合记忆 |

## 四、结论

1. **差异化成立且清晰**：106 个记忆插件里，没有第二个专做"决策记录+状态管理+审计"的。多数是"事实/对话记忆"，我们是"决策记忆"——右上角空白就是机会。
2. **刻意做了减法**：主流插件追求"全自动沉淀"（代价是 SQLite/图谱/云端复杂度+不可控），我们保持纯 MD + 手动记录 + 自动注入——简单、透明、任何 AI 可读。
3. **可借鉴的下一步**：engramory 的索引上限（我们已有 2000 字符注入上限 ✅）、dsh-memento 的审批门（决策落盘前用户确认，防 AI 乱记，按需再做）。
