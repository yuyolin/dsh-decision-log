# dsh-decision-log(决策日志)

**一句话介绍**：这个插件就是给 AI 干活的时候"记小本本"用的。AI 每做一个重要决定（比如"用 A 方案不用 B 方案"），你让它记下来，它就写进项目里的一个文件（`DECISIONS.md`）。以后不管是换新对话、还是过几天再看，AI 都还记得当初是怎么想的、为什么这么做。

> 面向 DeepSeek Harness (dsh) 0.1.x 的插件。开发者预览期，插件 API 可能变动；读取逻辑集中在纯逻辑层（`src/lib/`），格式变化只改这一层。

---

## 这插件到底解决什么问题？（先看懂这个）

平时你用 dsh 干活，是不是经常遇到这种情况：

- 上次让 AI 选了"用 JWT 不用 session cookie"，**这次新开个对话**，AI 又从头问你要选哪个；
- 过了俩星期，你看着代码想："当初为啥不用 Redis？"——**没人记得了**；
- 交接给同事/新会话，人家问"这块为什么这么写"，你**说不清楚**。

这个插件就是治这个病的：**决定做完立刻记下来，以后谁都能查、AI 也不会忘。**

---

## 安装（一次性）

打开你的命令行，跑这几条：

```bash
# 推荐：从 GitHub 装
dsh plugin --profile web add github:yuyolin/dsh-decision-log

# 如果是本地开发调试
dsh plugin --profile web add "link:D:/dsh-decision-log"
```

装完**必须重启**，而且启动命令要带 `--patch`（不然插件不生效）：

```bash
npx @deepseek-ai/dsh web --patch
```

**怎么确认装好了？** 重启后随便开个对话，在输入框里打：

```
/log-decision 测试一下
```

如果它回你"决策已记录:...",就说明插件活了。（这条测试记录可以留着也可以删。）

---

## 怎么用？（三种玩法，从简单到进阶）

### 玩法一：直接把话说给 AI 听（最常用，强烈推荐）

**不用记任何命令，不用学任何参数。** 你就当 AI 是个会记笔记的助理，直接说人话就行。

比如你在跟 AI 讨论"登录用什么东西做"，最后定了用 JWT。你就说：

```
记一下：登录用 JWT 不用 session cookie
```

就这么一句话。AI 听完会自己去调工具，把它写进项目文件里。你会看到它回你类似这样的话：

```
决策已记录到 D:\work\myproject\.dsh\DECISIONS.md（当前共 3 条）
- 用 JWT 不用 session cookie（accepted）
- 理由：跨端无状态，避免 session 同步
```

再举几个例子，都是**原样说人话就行**：

- `把刚才选 X 方案的决定记下来`
- `记住，缓存用 Redis 不用 Memcached，因为持久化更强`
- `我们定好了，数据库用 PostgreSQL，记一下`
- `刚刚那个选型记个档：图表库用 ECharts 不用 AntV`

**什么时候该说这句话？** 直觉判断就行——凡是"我们最终选了哪个"这种话说完，补一句"记一下"就对了。花两秒钟，省未来两小时。

---

### 玩法二：在输入框敲命令（适合你已经明确要记啥）

如果你不想等 AI 来记，自己直接敲命令最快。在输入框里打：

```
/log-decision 用 Redis 不用 Memcached
```

想写详细点，后面可以挂上"背景"和"理由"：

```
/log-decision 用 Redis 不用 Memcached --context 缓存层选型 --reason 持久化更强
```

这几样参数都是**可选的**，不写也行：

| 参数 | 是啥意思 | 举个例子 |
|---|---|---|
| `--context` | 这个决定是在什么背景下做的 | `--context 缓存层选型` |
| `--reason` | 为什么这么选（最重要，建议写） | `--reason 持久化更强` |
| `--status` | 这条决定的当前状态 | `--status accepted`（默认，不用管） |

**如果后来改主意了**，比如从 Redis 换成了 Memcached，别删旧的，补记两条：

```
/log-decision 缓存方案改为 Memcached --reason 团队更熟
/log-decision 用 Redis 不用 Memcached --reason 已换方案 --status superseded
```

第二条那个 `superseded` 的意思是"这条已经被推翻了"。这样以后翻记录，能完整看到"先用了 Redis，后来换成 Memcached，为什么换"的完整故事。

---

### 玩法三：让 AI 帮你记全（进阶，信息量大）

如果你想让 AI 把一次选择记得特别完整，可以这么对它说：

```
把刚才的选型记一下，要带上备选方案和理由
```

AI 就会自动带全所有信息调用工具，效果等于它自己填了这么一张表：

| 字段 | 填的内容 |
|---|---|
| 决策 | 用 JWT 不用 session cookie |
| 背景 | 登录模块改造 |
| 备选方案 | session cookie、OAuth |
| 理由 | 跨端无状态，避免 session 同步 |
| 涉及文件 | src/auth/session.ts |

记完之后，你随时可以问它：

- `查一下我们定过哪些事`（它会列出所有决策）
- `关于登录有没有什么决定？`（按关键词搜）
- `审计一下决策记录`（帮你看有没有记重了、记乱了）
- `把决策文档导出来看看`（查看完整内容）

---

## 换了新对话，它还记得吗？（自动注入）

这是这个插件最省心的地方——**不用你手动去"喂"新对话**。

每次开新对话、或者对话进入新的一轮，插件都会**自动**把"已经定过的事"塞给 AI 看。你会看到对话里多了一段类似这样的内容：

```
决策记录(历史已定，勿重复讨论，如需推翻请先说明理由)：
- [accepted] 用 JWT 不用 session cookie — 跨端无状态，避免 session 同步
- [accepted] 缓存用 Redis 不用 Memcached — 持久化更强
(... 其余 1 条见 .dsh/DECISIONS.md)
```

也就是说：**新对话里的 AI，天生就知道你之前定过什么**，不会傻乎乎再问你一遍。要是它想推翻旧决定，你得让它先说明理由——这正好防止"随手就把之前定的推翻了"。

怕占上下文？放心，它只显示**最新几条 + 总共有几条**，想看全部再去翻文件。

---

## 记下来的东西在哪？长什么样？

文件在**你这个项目文件夹里**：`.dsh/DECISIONS.md`

（每个项目一份，不会串。你在这个项目记的，不会跑到别的项目去。）

打开大概长这样：

```markdown
---
schema: dsh-decision-log/v1
updated_at: 2026-08-24T16:00:00+08:00
count: 2
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

它就是一份普通的 Markdown 文件，你可以：

- **提交到 git**：`git add .dsh/DECISIONS.md && git commit`，跟代码一起管版本
- **发给同事**：交接的时候直接把这份文件甩过去，比嘴说清楚多了
- **回看历史**：用 git 看这个文件的历史，能看出"决定是怎么一步步演变的"

---

## 常见问题（FAQ）

**Q：装好了但没反应？**
A：三步检查：① 启动命令有没有带 `--patch` ② 有没有重启 ③ 输入 `/log-decision 测试` 看有没有返回。

**Q：我明明说了"记一下"，AI 没记？**
A：先确认插件装好了（看上面）。如果装好了还是不记，直接说"用 decision_log 工具记录"来引导它。

**Q：记错了能改吗？**
A：不用改文件。再记一条新的，把旧的标成 `superseded`（已推翻）就行，保留完整历史。

**Q：两个项目会记混吗？**
A：不会。每个项目自己的 `.dsh/DECISIONS.md`，完全隔离。

**Q：这会让我多花钱吗（token）？**
A：基本不花。每轮只注入最新几条摘要（默认上限 2000 字符），占用量极小。

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
