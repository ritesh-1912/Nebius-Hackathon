# Devpost Project Submission: Upgrade Pilot

## Project Tagline
Autonomous Python dependency migration agent powered by NVIDIA Nemotron MoE on Nebius Token Factory and grounded by real-time Tavily search.

---

## Inspiration
Every engineering organization has a graveyard of technical debt marked by deferred dependency upgrades. Upgrading major libraries like **Pydantic v1 to v2** or **SQLAlchemy 1.4 to 2.0** often takes teams days or weeks of tedious manual refactoring:
- Foundational APIs are renamed or removed entirely (e.g., `Field(regex=...)` removed in favor of `Field(pattern=...)`, or `engine.execute(...)` direct string execution removed).
- Breaking changes ripple across dozens of models and services.
- Developers waste hours cross-referencing GitHub release notes, scattered migration guides, and failing pytest traces.
- Standard LLM chat interfaces hallucinate deprecated methods or confuse version APIs because their training data blends v1 and v2 documentation.

We built **Upgrade Pilot** to transform breaking major dependency migrations into an **autonomous, closed-loop workflow** verified by actual pytest test suites inside an isolated sandbox.

---

## What It Does
Upgrade Pilot is a closed-loop agentic engineer that autonomously upgrades Python repositories across breaking major versions:

1. **Deterministic Sandbox Isolation**: Provisions an ephemeral virtual environment, installs upgraded dependencies from a pre-built offline wheelhouse, and runs `pytest` to capture exact baseline failure tracebacks.
2. **Architectural Planning (Nemotron 3 Ultra 550B)**: Analyzes the codebase AST and pytest failure traces to formulate an ordered, multi-step refactoring plan.
3. **Live Documentation Grounding (Tavily + Nemotron 3 Nano 30B)**: Generates targeted queries against official documentation domains (`docs.pydantic.dev`, `docs.sqlalchemy.org`) via the Tavily Search API. Nemotron 3 Nano synthesizes these excerpts into crisp, 1-sentence migration rules with source URLs.
4. **AST Code Patching (Nemotron 3 Super 120B)**: Applies targeted code modifications using a resilient parser supporting Search/Replace diff markers and full-file code blocks.
5. **Continuous Verification Loop**: Re-executes `pytest` after each patch attempt. If any tests fail, the new tracebacks are fed back to Nemotron 3 Super (capped at 5 iterations or 60,000 tokens).
6. **PR-Ready Deliverables (Nemotron 3 Ultra 550B)**: Once all tests pass, Nemotron 3 Ultra performs a deep diff review specifically inspecting potential runtime behavioral changes not exercised by unit tests, and formats a production-grade GitHub Pull Request description with source documentation links.
7. **Real-Time Telemetry & Cost Dashboard**: Streams the entire execution lifecycle via Server-Sent Events (SSE), calculating exact token usage (prompt, completion, and reasoning) and live USD costs across Ultra, Super, and Nano tiers.

---

## How We Built It

- **Tri-Tier Model Specialization via Nebius Token Factory**:
  - `nvidia/Nemotron-3-Ultra-550b-a55b`: High-level architectural planning and final Pull Request review.
  - `nvidia/nemotron-3-super-120b-a12b`: Precision code patching and syntax self-repair.
  - `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`: Low-latency, cost-effective Tavily search summarization.
  - Connecting via Nebius Token Factory (`https://api.studio.nebius.ai/v1`) using the standard `openai` Python SDK with exponential backoff and timeout guards.
- **FastAPI Backend & SSE Streaming**: A non-blocking asynchronous Python web service delivering structured `AgentEvent` payloads over Server-Sent Events (`/api/upgrade/stream`).
- **Offline Wheelhouse Sandbox**: Ephemeral run environments created using `tempfile.mkdtemp` and populated strictly from a local wheelhouse (`--no-index --find-links=wheelhouse`). Tests run via `subprocess.Popen` with POSIX `rlimit` process-group boundaries and hard per-run timeouts to prevent hung processes.
- **Glassmorphism Single-Page Dashboard**: Built with vanilla JavaScript, Tailwind CSS, Marked.js for markdown rendering, a live syntax-colored unified diff viewer, and an instant deliverables toolbar (Copy Diff, Copy PR Summary, and Download `.diff` patch file).

---

## Challenges We Ran Into

1. **Pydantic v2 Validator Signatures & Recursion Traps**:
   - In Pydantic v2, `@model_validator(mode='after')` passes the model instance `self`, not a dictionary `values`. Accessing `values.get(...)` raised an `AttributeError`.
   - Additionally, when `validate_assignment=True` is enabled, directly mutating `self.total_amount = round(...)` inside a validator or helper triggers recursive assignment validation indefinitely, causing a `RecursionError`.
   - *Solution*: We tuned Super's task prompts and error handlers to mandate `def compute_and_verify_total(self) -> 'Order':` and bypass recursive validation hooks using `object.__setattr__(self, 'total_amount', ...)`.
2. **LLM Code Output Parsing Resilience**:
   - Nemotron 3 Super naturally generates full Python files or diff blocks. Strict regexes or strict JSON parsing frequently broke when models omitted the closing ```` code fence or outputted subtle markdown markers.
   - *Solution*: We built a multi-tiered parser in `engine.py` that handles lenient search/replace markers, unclosed code blocks, and fallback AST validation, paired with a specialized repair step that dynamically tailors prompt instructions to the specific library being upgraded.
3. **MoE Reasoning Token Budgets**:
   - Both Nemotron 3 Ultra and Super generate extensive chain-of-thought reasoning tokens (often 500–2,500 tokens). Setting conservative completion token caps caused the models to exhaust their budget during reasoning before emitting code.
   - *Solution*: We expanded completion limits to 4,096 tokens, tuned prompts to focus on actionable code changes, and extracted `reasoning_tokens` from completion details to display reasoning metrics on the frontend.
4. **Cross-Platform Wheelhouse Compilation**:
   - Pre-downloading wheels on macOS ARM64 produces platform-tagged `.whl` files incompatible with Linux containers.
   - *Solution*: We automated `scripts/build_wheelhouse.py` inside the multi-stage `Dockerfile` during image build so the Linux container builds its own native offline wheelhouse.

---

## Accomplishments That We're Proud Of

- **100% Genuine Runtime Verification**: Nothing is simulated or mocked. The agent provisions real virtual environments, installs real packages from a wheelhouse, executes real `pytest` subprocesses, and proves 100% test pass rates on real code.
- **Enterprise Multi-Tier Cost Efficiency**: Demonstrating that combining Ultra (architecture), Super (code generation), and Nano (summarization) achieves production-grade migration quality for **$0.04 to $0.07 per run**.
- **Real-Time Documentation Grounding**: Verified integration with the Tavily Search API with domain filtering, ensuring the agent uses up-to-date documentation and cites real URLs in the generated PR.
- **Robustness Under Budget Limits**: Enforced hard caps on iterations (5) and token budgets (60,000) with clear amber UI alerts (`Execution Limit Enforced`), alongside a pre-recorded cached sample run mode for zero-credit demonstrations.

---

## What We Learned

- Task-matching across model tiers (Ultra for planning, Super for code, Nano for search summaries) drastically reduces cost while outperforming monolithic models that try to do everything in a single prompt.
- Grounding agents in real-time official documentation via Tavily prevents the subtle version-confusion errors that typically plague LLMs on breaking library upgrades.
- Ephemeral sandboxes with offline wheelhouses provide the speed (~0.6s provisioning) and reliability needed for production agentic evaluation without relying on external network dependencies.

---

## What's Next for Upgrade Pilot

- **Multi-File Dependency Graphs**: Extending beyond isolated services to orchestrate multi-file refactoring across large monorepos with interdependent packages.
- **Language Expansion**: Adding support for TypeScript / Node.js migrations (e.g., Next.js Pages to App Router, React 17 to 18, or Jest to Vitest).
- **GitHub App & CI Integration**: Packaging Upgrade Pilot as a GitHub App that automatically opens ready-to-merge Pull Requests with passing test suites whenever Dependabot or Renovate flags a breaking version bump.
