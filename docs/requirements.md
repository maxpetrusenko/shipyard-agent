# Shipyard: Building an Autonomous Coding Agent

> There is no prescribed architecture. There is a defensible one. Finding it, justifying it, and building it is the assignment.

---

## Project Overview

One-week sprint. Build a coding agent from scratch, use it to rebuild Ship, then analyze what it produces.

### Deadlines

| Checkpoint | Deadline | Focus |
|---|---|---|
| Pre-Search | 4 hours after assignment | Open source research, architecture design, file editing strategy locked |
| MVP | Tuesday, 11:59 PM | Running agent, surgical edits working, context injection functional, tracing enabled |
| Early Submission | Thursday, 11:59 PM | Ship rebuild complete, comparative analysis drafted, multi-agent coordination working |
| Final Submission | Sunday, 11:59 PM | All deliverables submitted, documentation complete, deployed |

Project completion is required to move onto the next week.

---

## MVP Requirements (36 Hours)

Hard gate. All items required to pass:

- [ ] Agent runs in a persistent loop and accepts new instructions without restarting
- [ ] Surgical file editing implemented (targeted changes without rewriting entire files)
- [ ] Context injection functional (accepts injected context at runtime, uses it in generation)
- [ ] Tracing enabled (at least two shared trace links showing different execution paths)
- [ ] `PRESEARCH.md` submitted with research notes and all architecture artifacts
- [ ] Accessible via GitHub (runs locally, no deployment required at this stage)
- [ ] `CODEAGENT.md` submitted with Agent Architecture and File Editing Strategy sections complete

> A focused agent that surgical edits and runs continuously beats a feature-rich agent that rewrites files and crashes.

---

## Core Agent Requirements

| Requirement | Definition |
|---|---|
| **Continuous operation** | Persistent loop, accepts new instructions without restarting. Fire-and-forget does not count. |
| **Surgical file editing** | Targeted changes to specific lines or blocks without rewriting entire files. |
| **Multi-agent coordination** | Spawn and coordinate multiple agents (parallel or sequential), merge outputs correctly. |
| **Context injection** | External context (spec, schema, previous output, test result) injected at runtime and used in next action. |

---

## File Editing Strategy

Most commonly skipped or faked requirement. An agent that rewrites entire files on every change is a code generator with a filesystem wrapper.

### Strategy Options (pick one, justify in PRESEARCH.md)

| Strategy | Mechanism | Tradeoffs |
|---|---|---|
| **Unified diff** | Generate git-style patches, apply with standard patch tooling | Precise, auditable. Requires LLM to produce well-formed diffs consistently. |
| **Line-range replacement** | Identify start/end line numbers, replace only that range | Simple to implement. Fragile if line numbers drift. |
| **AST-based editing** | Parse to AST, modify target node, serialize back | Maximally precise. Language-specific, complex to implement. |
| **Anchor-based replacement** | Use unique string anchors to locate and replace specific blocks | More robust than line numbers, less complex than AST. |

Switching strategies mid-week because you did not think it through is a planning failure.

---

## Multi-Agent Coordination

- Spawn and coordinate at least two agents
- Document orchestration model: how agents communicate, how outputs are merged, how conflicts are resolved
- LangGraph recommended; any framework permitted if you produce equivalent run traces

---

## Ship App Rebuild

Use the functional agent to rebuild the Ship app (all current features) from scratch.

**Purpose:**
1. Integration test: if the agent cannot complete a real build task, the agent is not done
2. Generates data for the comparative analysis

**Rules:**
- You are directing your agent to build it, not building a clone by hand
- Document every human intervention (interventions are data, not failures)

---

## Comparative Analysis (7 Sections Required)

Most heavily weighted deliverable. Honest, specific analysis of a flawed agent scores higher than vague praise of a polished one.

| Section | What to Cover |
|---|---|
| **Executive Summary** | One paragraph: what you built and how the rebuild went overall |
| **Architectural Comparison** | How the agent-built version differs structurally from the original. Choices the agent made that a human would not. |
| **Performance Benchmarks** | Measurable comparisons: code complexity, test coverage, load time, lines of code, etc. |
| **Shortcomings** | Where the agent failed, produced incorrect output, or required intervention. List every intervention from rebuild log. |
| **Advances** | Where the agent outperformed or moved faster than manual development. |
| **Trade-off Analysis** | For each major architecture decision: was it the right call? What would you change? |
| **If You Built It Again** | What would differ about architecture, file editing strategy, or context management? |

Vague analysis will be penalized. Specific claims with evidence from the rebuild log are required.

---

## Observability

Every agent run must be traceable. After any run, you must be able to answer:
- What did the agent do?
- In what order?
- With what inputs?
- What did it produce at each step?

LangSmith tracing recommended for LangGraph. If using a different framework, produce equivalent traces.

---

## AI-First Development Requirements

### AI Development Log (Required, 1 page)

| Section | Content |
|---|---|
| Tools & Workflow | Which AI coding tools you used and how you integrated them |
| Effective Prompts | 3-5 prompts that worked well (include actual prompts, not descriptions) |
| Code Analysis | Rough percentage of AI-generated vs. hand-written code |
| Strengths & Limitations | Where the tools excelled and where they fell short on this project |
| Key Learnings | What you would do differently when using coding agents on your next project |

### AI Cost Analysis (Required)

**Ledger template (two meters):** Use **`docs/AI-COST.md`** so **Shipyard `/api/run` spend** (agent product) is not mixed with **Cursor / Claude Code / IDE** spend (building the repo).

**Development and Testing Costs:**
- Claude API costs (input and output token breakdown)
- Number of agent invocations during development
- Total development spend

**Production Cost Projections:**

| 100 Users | 1,000 Users | 10,000 Users |
|---|---|---|
| $___/month | $___/month | $___/month |

Assumptions to include: average agent invocations per user per day, average tokens per invocation (input/output breakdown), cost per invocation.

---

## Open Source Research (Pre-Search)

Study at least two before writing code. Read source, understand architecture, document in PRESEARCH.md.

| Agent | Why Study It | Source |
|---|---|---|
| **OpenCode** | Modern TypeScript coding agent. Tool design, context window management, agent loop structure. | github.com/opencode-ai/opencode |
| **LangChain Open Engineer** | Multi-agent orchestration, memory management, tool composition across agents. | github.com/langchain-ai/open-engineer |
| **Claude Code (docs)** | Architecture overview, permission model, sub-agent coordination, human-in-the-loop design. | docs.anthropic.com/claude-code |

---

## Technical Stack

| Layer | Technology |
|---|---|
| Agent Framework | LangGraph (recommended), LangChain, or custom loop |
| LLM | Claude (Anthropic SDK required) |
| Observability | LangSmith, Langfuse, or custom structured logging |
| Backend | Python/FastAPI or Node.js/Express |
| Deployment | Runs locally for MVP; deployed for Final Submission |

---

## Build Strategy (Priority Order)

1. **Persistent loop** -- agent accepts instructions and runs continuously
2. **Basic tool calls** -- `read_file` and `edit_file` working end-to-end
3. **Surgical file editing** -- implement and verify chosen strategy
4. **Context injection** -- external context accepted and used
5. **Multi-agent coordination** -- spawn two agents, merge outputs
6. **Ship rebuild** -- direct agent at Ship, document everything
7. **Comparative analysis** -- write the full seven-section report

### Critical Guidance

- Get surgical file editing working completely before moving to multi-agent
- Test edit strategy against files of varying size (behavior often breaks above 200 lines)
- Document every intervention during Ship rebuild (this is your analysis data)
- Add tracing early (you need visibility to debug agent behavior)
- Do not mock responses at any stage (run against real code)

---

## Submission Requirements

| Deliverable | Requirements |
|---|---|
| **GitHub Repository** | Setup guide, architecture overview; another engineer can clone and run without asking questions |
| **Demo Video (3-5 min)** | Show: surgical edit, multi-agent task, at least one Ship rebuild example |
| **PRESEARCH.md** | Completed pre-search checklist (see appendix) |
| **CODEAGENT.md** | All sections complete (see appendix) |
| **AI Development Log** | 1-page breakdown using template |
| **AI Cost Analysis** | Dev spend + projections for 100/1K/10K users |
| **Deployed Application** | Agent and agent-built Ship app both publicly accessible |
| **Social Post** | X or LinkedIn: description, features, demo/screenshots, tag @GauntletAI |

---

## Appendix A: Pre-Search Checklist

Complete before writing any code. Save AI conversation as reference.

### Phase 1: Open Source Research

**1. For each agent studied:**
- Which agent, and which parts of the source code you read
- How it handles file editing (mechanism, tradeoffs, failure modes)
- How it manages context across turns
- How it handles failed tool calls and unexpected output
- What you would take from it
- What you would do differently, and why

**2. File editing strategy:** Which strategy are you adopting? What are its failure modes? How will you handle them?

### Phase 2: Architecture Design

**3.** System diagram: full flow from user instruction through agent loop to output, including at least one error branch (Mermaid or image)

**4.** File editing strategy: mechanism step by step. What does the agent do when it gets the location wrong?

**5.** Multi-agent design: orchestration model, how agents communicate, how outputs are merged

**6.** Context injection spec: what types of context, in what format, at what point in the loop

**7.** Any additional tools your agent will need (list with one-sentence description each)

### Phase 3: Stack and Operations

**8.** What framework for the agent loop and multi-agent coordination? Why?

**9.** Where does your persistent loop run? How is it kept alive between instructions?

**10.** What is your token budget per invocation? Where are the cost cliffs?

**11.** What does your agent do when it makes a bad edit? How does it detect and recover?

**12.** What gets logged? Describe what a complete run trace looks like for a typical edit.

---

## Appendix B: CODEAGENT.md Template

Fill in each section as you build. Do not write this at the end.

| Section | Due |
|---|---|
| Agent Architecture | MVP |
| File Editing Strategy | MVP |
| Multi-Agent Design | MVP |
| Trace Links | MVP |
| Architecture Decisions | Final Submission |
| Ship Rebuild Log | Final Submission |
| Comparative Analysis | Final Submission |
| Cost Analysis | Final Submission |

### Agent Architecture (MVP)
Diagram or written description of full agent architecture: loop design, tool calls, state management, entry and exit conditions for normal runs and error branches.

### File Editing Strategy (MVP)
Describe exactly how your agent makes surgical edits, step by step. Mechanism, block location, error handling when location is wrong.

### Multi-Agent Design (MVP)
Orchestration model, communication, parallel output merging. Include diagram if helpful.

### Trace Links (MVP)
- Trace 1 (normal run): `[link]`
- Trace 2 (different execution path): `[link]`

### Architecture Decisions (Final Submission)
Key decisions, what you considered, why you made the call.

### Ship Rebuild Log (Final Submission)
Running log. For every human intervention: what broke, what you did, what it reveals about agent limitations.

### Comparative Analysis (Final Submission)
All seven sections required. Specific claims with evidence.

### Cost Analysis (Final Submission)

| Item | Amount |
|---|---|
| Claude API input tokens | |
| Claude API output tokens | |
| Total invocations during development | |
| Total development spend | |

| 100 Users | 1,000 Users | 10,000 Users |
|---|---|---|
| $___/month | $___/month | $___/month |

**Assumptions:**
- Average agent invocations per user per day:
- Average tokens per invocation (input/output):
- Cost per invocation:
