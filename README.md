# dsh-decision-log(决策日志)

把会话中做过的**关键决策**沉淀为项目里可版本化的 `DECISIONS.md`，并在后续会话自动注入摘要——让"当时为什么这么做"有据可查，不再重复讨论、不会轻易推翻。

> 面向 DeepSeek Harness (dsh) 0.1.x 的插件。开发者预览期，插件 API 可能变动；读取逻辑集中在纯逻辑层（`src/lib/`），格式变化只改这一层。

---

## 它能做什么

| 能力 | 说明 |
|---|---|
| `decision_log` | 记录一条决策（选了什么 + 为什么），落盘 `.dsh/DECISIONS.md` |
| `decision_list` | 查询已记录决策（关键词/状态过滤，最新在前） |
| `decision_audit` | 审计：查重、状态统计、token 估算 |
| `decision_export` | 查看/重建 DECISIONS.md 内容 |
| `/log-decision` | 在输入框直接记决策，不占模型 token |
| 自动注入 | 每个新回合自动带上"已有决策摘要"，防止重复讨论 |

---

## 安装

```bash
# 方式一：从 GitHub 安装（推荐）
dsh plugin --profile web add github:yuyolin/dsh-decision-log

# 方式二：本地开发调试
dsh plugin --profile web add "link:D:/dsh-decision-log"

# 方式三：npm 发布后（届时可用）
dsh plugin add dsh-decision-log
```

**装完必须重启 Web UI，且启动时带 `--patch`，否则插件不生效：**

```bash
npx @deepseek-ai/dsh web --patch
```

**验证是否装好**：重启后随便开个会话，输入框里输入 `/log-decision 测试`，如果返回"决策已记录:...",说明插件已生效（记完可删除该条）。

---

## 使用方法（在 dsh 里实际操作）

### 方式一：大白话让 AI 记（最常用，推荐）

不用记任何命令，**直接对 AI 说人话**即可。插件附带的 `log-decision` 技能会让 AI 自动调用 `decision_log` 落盘：

```
"记一下：登录用 JWT 不用 session cookie"
"把刚才选 X 方案的决定记下来"
"记住我们缓存用 Redis 不用 Memcached，原因是持久化更强"
```

**你会在界面上看到**：AI 返回类似这样的结果——

```
决策已记录到 D:\work\myproject\.dsh\DECISIONS.md（当前共 3 条）
- 用 JWT 不用 session cookie（accepted）
- 理由：跨端无状态，避免 session 同步
```

### 方式二：输入框敲命令 `/log-decision`（不占模型 token）

在输入框里直接敲，适合自己明确要记什么的时候：

```
/log-decision 用 Redis 不用 Memcached --context 缓存层选型 --reason 持久化更强
```

支持参数：

| 参数 | 说明 |
|---|---|
| `--context` | 决策背景 |
| `--reason` | 选择理由 |
| `--status` | 状态（accepted / superseded / rejected），默认 accepted |

记错了/改主意了，补记一条并标注旧决策已被推翻：

```
/log-decision 缓存方案改为 Memcached --reason 团队更熟 --status accepted
/log-decision 用 Redis 不用 Memcached --reason 已被推翻 --status superseded
```

### 方式三：直接让模型调用工具（进阶）

对 AI 说"用 decision_log 记录"，它会带全参数调用：

```
decision_log(
  decision: "用 JWT 不用 session cookie",
  context: "登录模块改造",
  alternatives: ["session cookie", "OAuth"],
  reason: "跨端无状态，避免 session 同步",
  files: ["src/auth/session.ts"]
)
```

所有工具参数一览：

#### `decision_log` — 记一条决策
| 参数 | 必填 | 说明 |
|---|---|---|
| `decision` | ✅ | 决策内容，如"用 JWT 不用 session cookie" |
| `context` | - | 决策背景 |
| `alternatives` | - | 备选方案列表 |
| `reason` | - | 为什么这么选（最有价值，建议写） |
| `status` | - | accepted / superseded / rejected |
| `files` | - | 涉及的文件路径 |

#### `decision_list` — 查决策
```
"查一下我们有哪些决策"
"查一下关于登录的决策"
```
支持参数：`keyword`（关键词）、`status`（状态过滤）、`limit`（条数，默认 20）。

#### `decision_audit` — 审计决策
```
"审计一下决策日志"
```
返回：总数、各状态数量、疑似重复条目、token 估算。

#### `decision_export` — 导出/查看全文
```
"导出决策文档"
```
返回 DECISIONS.md 完整内容与路径。

---

## 自动注入：换了会话也不怕

插件会在**每个回合开始前**自动把"已有决策摘要"注入模型上下文，效果是：

- 新开会话继续干同一个项目 → AI 自动知道"之前定过用 JWT"，**不会重新问你选什么**
- 正在干活时 AI 想推翻旧决策 → 摘要里写着"勿重复讨论，如需推翻请先说明理由"
- 摘要只放**最新几条 + 总数**，超长历史不占上下文（详见 `.dsh/DECISIONS.md`）

你会在对话里看到类似这样的注入内容：

```
决策记录(历史已定，勿重复讨论，如需推翻请先说明理由)：
- [accepted] 用 JWT 不用 session cookie — 跨端无状态，避免 session 同步
- [accepted] 缓存用 Redis 不用 Memcached — 持久化更强
(... 其余 1 条见 .dsh/DECISIONS.md)
```

---

## 决策文件在哪、长什么样

文件位置：**当前工作区的 `.dsh/DECISIONS.md`**（每个项目一份，跟着项目走）。

```markdown
---
schema: dsh-decision-log/v1
updated_at: 2026-08-24T16:00:00+08:00
count: 3
---

## [2026-08-24T15:30:00+08:00] 用 JWT 不用 session cookie
- 状态: accepted
- 上下文: 登录模块改造
- 备选: [session cookie, OAuth]
- 理由: 跨端无状态，避免 session 同步
- 涉及文件: [src/auth/session.ts]
- 来源: session-abc123 (seq 42)

## [2026-08-24T16:10:00+08:00] 缓存用 Redis 不用 Memcached
- 状态: accepted
- 理由: 持久化更强
```

**这是普通 markdown，可以直接 `git add .dsh/DECISIONS.md && git commit`**，随代码一起版本化。好处：

- 换电脑/换人/换会话，决策不丢
- 可以 diff：看决策怎么演变的
- 代码评审时可以对照"当时为什么这么写"
- 给 AI 写周报/复盘时直接引用

---

## 常见问题

**Q：安装后没反应？**
A：确认 ① 用了 `--patch` 启动 ② 重启了 profile ③ `/log-decision 测试` 有返回。

**Q：AI 不主动记决策？**
A：技能只在装好后才生效；也可以直接说"用 decision_log 记录"。重要决策建议显式让 AI 记。

**Q：记错了怎么办？**
A：用 `--status superseded` 补记一条说明已推翻，不用删文件。

**Q：多个项目会串吗？**
A：不会。文件在**各自工作区**的 `.dsh/DECISIONS.md`，按项目隔离。

---

## 权限与安全

- 插件以当前 dsh 进程权限运行，只读写**当前工作区**的 `.dsh/DECISIONS.md`
- **只读源会话**：从 `exec.agent.session` 读取元数据，绝不改写会话日志
- 自动识别仅输出"候选"日志，**不自动落盘**——落盘必须经 `decision_log`（模型或用户显式触发）
- 本插件不触发任何高危操作（无删除、无远程调用、无 shell 执行）

## 兼容性

- Node.js: ^22.19.0 || >=24.0.0
- dsh: 0.1.x（官方 API：`agent.session`、`ctx.fs`、`agent/pre-step`、`session/event`）
- 纯 JS 无原生二进制依赖

## 开发

```bash
npm install
npm run build     # esbuild 编译到 lib/
npm test          # node --test（store/extractor/audit 纯逻辑测试）
```

## 路线图

- [x] Phase 1: MVP —— decision_log 手动记录 + 落盘 + 查询 + 审计 + 注入摘要
- [ ] Phase 2: 自动识别决策候选增强（LLM 蒸馏理由）+ Web UI 投影
- [ ] Phase 3: 跨会话语义去重（ctx.sessionQuery）+ git commit 关联

## License

MIT
