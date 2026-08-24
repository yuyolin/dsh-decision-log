# dsh-decision-log(决策日志)

把会话中做过的**关键决策**自动沉淀为项目里可版本化的 `DECISIONS.md`，并在后续会话自动注入摘要——让"当时为什么这么做"有据可查，不再重复讨论、不会轻易推翻。

> 面向 DeepSeek Harness (dsh) 0.1.x 的插件。开发者预览期，插件 API 可能变动；读取逻辑集中在纯逻辑层（`src/lib/`），格式变化只改这一层。

## 它能做什么

| 能力 | 说明 |
|---|---|
| `decision_log` | 手动记一条决策（选了什么 + 为什么），落盘 `.dsh/DECISIONS.md` |
| `decision_list` | 查询已记录决策（关键词/状态过滤，最新在前） |
| `decision_audit` | 审计：查重、状态统计、token 估算 |
| `decision_export` | 查看/重建 DECISIONS.md 内容 |
| `/log-decision` | 命令平面记决策，不占模型 token |
| 自动注入 | 每回合自动带上"已有决策摘要"，防止重复讨论 |

## 安装

```bash
# 从 GitHub（开发期）
dsh plugin --profile web add github:<you>/dsh-decision-log

# 本地开发
dsh plugin --profile web add "link:D:/dsh-decision-log"
```

**重要:启动 Web UI 必须带 `--patch`,否则插件/技能不生效。**

```bash
npx @deepseek-ai/dsh web --patch
```

## 用法

**零门槛(推荐)** —— 附带的 `log-decision` 技能让 AI 听懂大白话:

```
"记一下:登录用 JWT 不用 session cookie"
"把刚才选 X 方案的决定记下来"
```

AI 会自动调 `decision_log` 落盘,返回路径 + 条数。

**手动方式**:

```
/log-decision 用 Redis 不用 Memcached --context 缓存层选型 --reason 持久化更强
```

或让模型执行:`decision_log(decision: "...", reason: "...")`。

## 存储格式(ADR 风格)

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
```

文件在 `<工作区>/.dsh/DECISIONS.md`,可 git 提交、可 diff、可评审、可跨机器恢复。

## 权限与安全

- 插件以当前 dsh 进程权限运行,只读写**当前工作区**的 `.dsh/DECISIONS.md`
- **只读源会话**:从 `exec.agent.session` 读取元数据,绝不改写会话日志
- 自动识别仅输出"候选"日志,不自动落盘——落盘必须经 `decision_log`(模型或用户显式触发)
- 本插件不触发任何高危操作(无删除、无远程调用、无 shell 执行)

## 兼容性

- Node.js:^22.19.0 || >=24.0.0
- dsh:0.1.x(官方 API:`agent.session`、`ctx.fs`、`agent/pre-step`、`session/event`)
- 纯 JS 无原生二进制依赖

## 开发

```bash
npm install
npm run build     # esbuild 编译到 lib/
npm test          # node --test(store/extractor/audit 纯逻辑测试)
```

## 路线图

- [x] Phase 1:MVP —— decision_log 手动记录 + 落盘 + 查询 + 审计 + 注入摘要
- [ ] Phase 2:自动识别决策候选增强(LLM 蒸馏理由)+ Web UI 投影
- [ ] Phase 3:跨会话语义去重(ctx.sessionQuery)+ git commit 关联

## License

MIT
