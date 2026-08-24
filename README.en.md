<div align="center">

# 📒 dsh-decision-log

### The notebook for your AI's decisions — every call gets written down, so "why did we do it this way" never gets lost.

**Stop re-answering the same questions · Stop guessing why code looks the way it does · Hand off with one file**

`DeepSeek Harness` · Plugin · MIT License

[![DSH](https://img.shields.io/badge/DeepSeek_Harness-0.1.x-6C5CE7?style=flat-square)](https://github.com/deepseek-ai/deepseek-harness)
[![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)](LICENSE)

</div>

---

## ✨ What it is, in one sentence

> **A meeting-minutes book for your AI.** Every time a key decision is made ("use A over B"), you tell the AI to jot it down — it writes into your project's `DECISIONS.md`. No matter if you open a new session, hand off to a teammate, or come back three months later, **"why we did this" is always on record.**

It's not a todo list (that's what todos are for), not chat history (that's what sessions are for). It's your project's **decision memory** — git records *what changed*; this records *why*.

---

## 📌 Read this first (30 seconds)

**Installing this plugin does not add any buttons, windows, or panels.** It's an on-call plugin — you summon it, it works.

- **On first use, it creates a dedicated folder in your project**: `<your-project>/.dsh/`, with a blank `DECISIONS.md` inside. **Don't panic when you see it — that's by design**, not a bug:
  - ✅ Created **once**, never re-created or overwritten;
  - ✅ Just two ordinary files — open, edit, even delete them (it'll recreate a blank one);
  - ✅ Touches nothing else: not your code, not your chat history.
- **Every conversation, the AI reads this notebook** (summary auto-injected), so even with zero entries it knows the book exists.
- **Summon it**: tell the AI "**remember: ...**" or type `/log-decision`. It writes the decision (with context and reasoning) into `DECISIONS.md`.
- **It also does one proactive thing**: at each turn it quietly injects recorded decisions into context so the AI doesn't forget them. That's the *only* automatic action — everything else requires you.

**Where does it live? On your machine, one dedicated MD folder, no cloud:**

```
your-project/
└── .dsh/                  ← auto-created on first use (once)
    └── DECISIONS.md       ← all decisions (plain Markdown, any AI can read, git-friendly)
```

> 💡 **Treat it as your project's shared memory file**: not just the dsh AI reads it — point Claude at it, let Cursor read it, drag it into ChatGPT. It's a portable project decision handbook.

---

## 🌍 Key point: ANY AI can read this file!!!

The `DECISIONS.md` you record is **not tied to dsh or any single AI** — it's the most ordinary Markdown file, on your machine, at a fixed path:

- 🤖 **Claude can read it!** — tell it to read `<project>/.dsh/DECISIONS.md` and it instantly knows the project's decisions.
- 🤖 **Cursor can read it!** — glance at it before coding and it won't contradict settled choices.
- 🤖 **ChatGPT can read it!** — drag the file in and it's up to speed.
- 🤖 **Any AI can read it!** — your decisions are never locked inside one AI ecosystem.

**Why this matters**: your decision memory should follow the *project, the file, and you* — not one AI's chat history. Switch tools, switch AI, switch machines — **the file stays, the memory stays.**

---

## 🚀 Install (one sentence — let the AI do it)

**Copy this whole block to your dsh AI (or any AI assistant) — it will install, restart, and smoke-test for you:**

```
Help me install the dsh-decision-log plugin:
1. Run: dsh plugin --profile web add github:yuyolin/dsh-decision-log
2. Restart the dsh Web UI (start command must include --patch)
3. Smoke-test: open a session, run /log-decision test, confirm it returns "decision recorded"
4. Report back
```

**Want to do it yourself? Three commands:**

```bash
# 1. Install
dsh plugin --profile web add github:yuyolin/dsh-decision-log

# 2. Restart Web UI (must include --patch, or the plugin won't load)
npx @deepseek-ai/dsh web --patch

# 3. Verify: open a session and type
/log-decision test
```

Seeing "decision recorded" means it's alive ✅ (keep or delete the test entry).

---

## 🎯 How to use it — three ways, from easy to advanced

### Way 1: Just talk to the AI (recommended, zero learning)

Treat the AI as an assistant with a notebook. Say, in plain words:

```
remember: login uses JWT, not session cookies
remember: cache uses Redis, not Memcached, because persistence is stronger
write that down: database is PostgreSQL
```

The AI calls `decision_log` automatically and replies:

```
✅ Decision recorded to D:\work\myproject\.dsh\DECISIONS.md (3 entries so far)
- Use JWT not session cookie (accepted)
- Reason: stateless across clients
```

**When to say it**: any time "we've settled on X" is spoken, add "remember that." Two seconds now, two hours saved later.

### Way 2: Type the command (when you know exactly what to record)

```
/log-decision Use Redis not Memcached --context cache layer choice --reason better persistence
```

Optional flags: `--context` (background), `--reason` (why — the most valuable part), `--status` (accepted / superseded / rejected).

**Changed your mind?** Don't delete — append:

```
/log-decision switch cache to Memcached --reason team is more familiar
/log-decision Use Redis not Memcached --reason superseded --status superseded
```

### Way 3: Let the AI record everything (advanced)

```
Record that decision with the alternatives and reasoning
```

Then query anytime:
- 📖 `what decisions have we made?` — list all
- 🔍 `any decisions about login?` — keyword search
- 🧹 `audit the decision log` — check for duplicates & stats
- 📄 `export the decision doc` — full content

---

## 🧠 The best part: new sessions just know

You don't hand-feed new sessions. At every turn the plugin **auto-injects** what's been decided:

```
📌 Decisions (settled — don't re-litigate; to overturn, explain why):
- [accepted] Use JWT not session cookie — stateless across clients
- [accepted] Cache with Redis not Memcached — better persistence
(... N more in .dsh/DECISIONS.md)
```

- ✅ New-session AI knows old decisions — no re-asking;
- ✅ It must justify before overturning — **no accidental reversals**;
- ✅ Only the latest few + a count are injected — **token cost is constant** (~2000 char cap).

### Approval gate: AI can't record anything on its own

**AI-recorded decisions start as `pending`** — you confirm or reject:

- See "1 pending, say confirm or reject" in the summary;
- Say "**confirm**" → `decision_confirm` → becomes accepted;
- Say "**reject**" → `decision_reject` → discarded.

No silent self-serving entries. Every decision is yours.

---

## 📁 What the file looks like

`.dsh/DECISIONS.md` (one per project, isolated):

```markdown
---
schema: dsh-decision-log/v1
updated_at: 2026-08-24T16:00:00+08:00
count: 2
---

## [2026-08-24T15:30:00+08:00] Use JWT not session cookie
- 状态: accepted
- 上下文: login module rework
- 备选: [session cookie, OAuth]
- 理由: stateless across clients
- 涉及文件: [src/auth/session.ts]
- 来源: session-abc123 (seq 42)
```

Plain Markdown, so you can:

- 🤖 **Give it to any AI** — point any tool at this path;
- 🔄 **Commit to git** — decisions versioned with code;
- 📤 **Hand off with one file** — clearer than a verbal debrief;
- 🕰️ **Trace the evolution** — git history of this file shows how decisions changed;
- 🤝 **Cite in code review** — "why this way" is one link away.

---

## 🔬 Honest talk: does it get heavier over time?

**No — the per-turn cost is constant.** The plugin never stuffs the whole file into context. It reads only the *latest batch*, stops at a **2000-character hard cap**, and shows `(... N more in file)`. Full history stays in the file, not in the conversation.

Measured: **100 entries ≈ 1097 tokens/turn; 1000 entries ≈ 1075 tokens/turn.** Ten times the history, same cost — the cap is hit early and stays.

> **The notebook can grow forever; the AI reads a fixed page each time.** Cheap insurance against expensive rework.

---

## ❓ FAQ

**Q: Installed but nothing happens?**
A: Three checks: ① did you start with `--patch` ② did you restart ③ does `/log-decision test` return anything.

**Q: AI didn't record when I said "remember"?**
A: Verify the plugin is installed (above). If it is, be explicit: "use the decision_log tool to record this."

**Q: Can I fix a wrong entry?**
A: Don't edit the file. Append a new one with `--status superseded` to keep the full history.

**Q: Do projects mix together?**
A: No. Each project has its own `.dsh/DECISIONS.md`.

**Q: Will this burn tokens?**
A: No — constant 2000-char cap per turn regardless of history size (~1000-1100 tokens measured).

**Q: How is this different from todos or chat history?**
A: Todos are "what's next", chat is "what was said", this is "**what we settled on and why**" — a versioned, diffable, hand-off-able decision asset.

---

## 🛡️ Permissions & safety

- Reads/writes only **the current workspace's** `.dsh/DECISIONS.md`, under the dsh process's permissions
- **Read-only over source sessions**: reads metadata from `exec.agent.session`, never modifies session logs
- **No auto-persist**: recording requires `decision_log` (model or user explicitly triggers it)
- No deletions, no remote calls, no shell execution

## 📦 Compatibility

- Node.js: ^22.19.0 || >=24.0.0
- dsh: 0.1.x (official APIs: `agent.session`, `ctx.fs`, `agent/pre-step`, `session/event`)
- Pure JS, no native binaries — Windows / Linux / macOS

## 🛠️ Development

```bash
npm install
npm run build     # esbuild → lib/
npm test          # node --test (store/candidate/audit pure logic)
```

## 🗺️ Roadmap

- [x] Phase 1: MVP — record / list / audit / export + approval gate + injection
- [x] Phase 2: visible attribution, trigger guidance, anti-self-pollution, caching
- [x] Phase 3: decision candidate detection (auto-suggest, never auto-record)
- [ ] Phase 4: Web UI projection, cross-project aggregation, ADR interop

## 👋 About the author

Hey — this plugin was built by **yuyolin**, someone who got tired of AI amnesia ("we settled this yesterday!").

Also messing around in the dsh ecosystem: **dsh-task-bootstrap** (pack up mid-task and continue elsewhere) and **dsh-drag-handoff** (drag a task card into a new session).

Questions, ideas, bugs, collabs — reach out:

- 📮 Email: **yuyolin9@gmail.com**
- 🐙 GitHub: [yuyolin](https://github.com/yuyolin)

I read every message. Don't be shy.

## 📄 License

MIT — free to use. PRs, issues, and stars ⭐ welcome.
