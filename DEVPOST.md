# Devpost Project Submission: Upgrade Pilot

## Tagline
Autonomous Python breaking dependency migration agent powered by NVIDIA Nemotron MoE on Nebius Token Factory and grounded by Tavily Search.

---

## Inspiration
Every engineering organization has a graveyard of technical debt marked by deferred dependency upgrades. Upgrading major libraries like **Pydantic v1 to v2** or **SQLAlchemy 1.4 to 2.0** often takes teams weeks of tedious manual refactoring:
- APIs are silently deprecated or removed entirely.
- Syntax changes are scattered across dozens of service and model files.
- Developers waste hours tab-switching between obscure changelog pages, GitHub issues, and failing pytest traces.
- Generic LLM chat assistants fail because they hallucinate deprecated methods or mix incompatible version APIs.

We built **Upgrade Pilot** to turn multi-day breaking dependency migrations into a **one-click autonomous workflow** verified by actual test suites.

---

## What It Does
Upgrade Pilot is an end-to-end autonomous agent that upgrades Python repositories across breaking major versions:
1. **Sandbox Detection**: Provisions an isolated, offline virtual environment, bumps the target dependency, and runs pytest to capture the exact failure tracebacks.
2. **Architectural Planning (Nemotron 3 Ultra 550B)**: Analyzes the codebase AST and test traces to formulate an ordered, step-by-step refactoring plan.
3. **Live Grounding (Tavily + Nemotron 3 Nano 30B)**: Queries official changelogs via Tavily for the failing symbols, while Nemotron 3 Nano synthesizes concise migration rules with source URLs.
4. **AST Code Patching (Nemotron 3 Super 120B)**: Employs an iterative loop of structured code edits with AST syntax checks and sliding-window fuzzy matching to apply fixes to the sandbox.
5. **Deterministic Verification**: Re-runs pytest after each patch until all tests pass (or max 5 iterations).
6. **PR-Ready Deliverables**: Nemotron 3 Ultra reviews the final unified diff for regressions and writes an exportable GitHub Pull Request description.
7. **Real-Time Telemetry**: Streams every step live over Server-Sent Events (SSE) while calculating real-time token usage and USD costs across Ultra, Super, and Nano tiers.

---

## How We Built It
- **Tri-Tier Model Specialization (Nebius Token Factory)**:
  - `nvidia/Nemotron-3-Ultra-550b-a55b`: High-level migration planning and final PR review.
  - `nvidia/nemotron-3-super-120b-a12b`: Precision code patching and syntax self-repair.
  - `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`: Ultra-fast, low-cost Tavily search summarization.
- **FastAPI Backend & SSE Streaming**: Single-process Python backend delivering asynchronous Server-Sent Events to the frontend without WebSocket overhead.
- **Offline Wheelhouse Sandbox**: Ephemeral run environments provisioned from pre-downloaded `.whl` files in ~0.6 seconds without PyPI rate limits. Subprocesses are guarded with hard 25s timeouts and POSIX `rlimit` constraints.
- **Glassmorphism Single-Page Dashboard**: Built with modern Tailwind CSS, Marked.js, and custom interactive diff rendering.

---

## Challenges We Ran Into
1. **JSON Escaping with Multi-Line Code in LLMs**:
   When asking LLMs to output code patches inside JSON strings, backslashes, docstrings, quotes, and regexes (`r"^\d{5}$"`) frequently trigger `JSONDecodeError`.
   *Solution*: We engineered a multi-format patcher supporting Aider-style Search/Replace blocks (`<<<<<<< SEARCH ... ======= ... >>>>>>> REPLACE`) and full-file blocks alongside JSON, complete with an automatic repair step that prompts the model to correct malformed blocks.
2. **MoE Reasoning Token Budgeting**:
   NVIDIA Nemotron 3 Super and Ultra utilize extensive internal reasoning tokens (often 500–2,000 reasoning tokens per prompt). When completion token caps were tight, reasoning tokens consumed the budget before code was emitted.
   *Solution*: We tuned completion limits to 4,096 tokens, designed targeted prompts that focus on immediate test failures, and extracted `reasoning_tokens` to show users what the models were thinking.
3. **Sandbox Platform Discrepancies**:
   Building wheels on macOS ARM64 produces `.whl` files incompatible with Linux Docker containers.
   *Solution*: We automated `scripts/build_wheelhouse.py` inside the multi-stage `Dockerfile` during image build so the Linux container bakes its own offline wheelhouse.

---

## Accomplishments That We're Proud Of
- **100% Real Runtime Verification**: Not a mock demo. The agent actually launches ephemeral virtual environments, executes real pytest commands, captures echte tracebacks, and applies AST-validated patches.
- **Live Tri-Tier Cost Transparency**: Every call's tokens (prompt, completion, reasoning) and USD costs are tracked in real time, proving that combining Ultra, Super, and Nano achieves enterprise quality at cents per run.
- **Sub-Second Offline Environments**: Using local wheelhouses cut sandbox provisioning from 35 seconds to under 1 second.
- **Production Resilience**: Built with concurrency limits, per-run timeouts, IP rate limits, daily token caps, and an automatic cached fallback mode to ensure uninterrupted judge evaluations.

---

## What We Learned
- Specializing model tiers by task complexity (Ultra for architecture, Super for code, Nano for summarization) drastically improves both output quality and cost-efficiency compared to routing all tasks through a monolithic model.
- Real-time web search grounding (Tavily) is essential for library migrations where training data cutoffs or version confusion would otherwise cause hallucinations.

---

## What's Next for Upgrade Pilot
- **Multi-File Dependency Graphs**: Expanding from single services to multi-service mono-repos with cross-package version constraints.
- **Language Expansion**: Adding TypeScript / Node.js support (e.g., migrating Next.js 12 → 14 App Router, React 17 → 18, or Jest → Vitest).
- **GitHub App Integration**: Direct integration as a GitHub App that automatically opens Pull Requests with green test verification whenever Dependabot or Renovate flags a breaking version bump.
