# Upgrade Pilot 🚀
### Autonomous Python Dependency Migration Agent
**Nebius x NVIDIA Global AI Hackathon — Coding and Agentic Engineering Track**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.11+](https://img.shields.io/badge/python-3.11+-blue.svg)](https://www.python.org/downloads/)
[![NVIDIA Nemotron](https://img.shields.io/badge/NVIDIA-Nemotron%20MoE-76B900.svg)](https://www.nvidia.com)
[![Nebius Token Factory](https://img.shields.io/badge/Nebius-Token%20Factory-38BDF8.svg)](https://nebius.com)

---

## Pitch

Every software engineering team dreads major dependency upgrades. When foundational libraries like **Pydantic** (v1 → v2) or **SQLAlchemy** (1.4 → 2.0) introduce breaking changes, codebases break across dozens of files, documentation is scattered across sprawling changelogs, and developers lose days to tedious manual syntax refactoring. Generic coding assistants frequently fail because their training data cutoffs or prompt limits cause them to hallucinate deprecated methods or confuse version-specific APIs.

**Upgrade Pilot** is an autonomous, closed-loop agentic engineer that migrates Python services across breaking major library versions. It provisions an isolated execution sandbox, reproduces failing tests, formulates an architectural migration plan with **NVIDIA Nemotron 3 Ultra**, grounds its fixes in live official changelogs via **Tavily Search** summarized by **Nemotron 3 Nano**, generates AST-validated code patches with **Nemotron 3 Super**, and iterates in a deterministic sandbox until the test suite is 100% green—streaming real-time diffs, token telemetry, and an exportable GitHub Pull Request description.

---

## Architecture & Agent Pipeline

```mermaid
flowchart TD
    subgraph UI["Frontend (Single-Page App)"]
        Browser["Modern Dashboard\n(Vanilla JS + Tailwind + SSE)"]
        DiffUI["Interactive Diff & PR Viewer"]
        CostGauge["Real-Time Token & Cost Meter"]
    end

    subgraph Server["FastAPI Backend (Python 3.11 / 3.13)"]
        Streamer["SSE Event Streamer\n(/api/upgrade/stream)"]
        BudgetGuard["Rate Limiter & Daily Token Budget\n(budget.py)"]
        Patcher["AST Patcher & Robust Multi-Regex Parser\n(patcher.py)"]
    end

    subgraph NebiusTF["Nebius Token Factory (OpenAI API)"]
        Ultra["Nemotron 3 Ultra 550B\n(Plan & PR Review)"]
        Super["Nemotron 3 Super 120B\n(Targeted Code Patching)"]
        Nano["Nemotron 3 Nano 30B\n(Fast Search Summarization)"]
    end

    subgraph Grounding["Real-Time Documentation"]
        Tavily["Tavily Search API\n(Official Changelogs)"]
    end

    subgraph Sandbox["Isolated Execution Sandbox"]
        TempVenv["Ephemeral Run Dir\n(/tmp/upgrade_pilot_runs/...)"]
        Wheelhouse["Local Wheelhouse\n(wheelhouse/*.whl)"]
        PytestProc["Subprocess Pytest Runner\n(rlimit + timeout)"]
    end

    Browser -->|1. Select Demo & Run| Streamer
    Streamer --> BudgetGuard
    BudgetGuard --> TempVenv
    Wheelhouse -->|2. Offline pip install| TempVenv
    TempVenv -->|3. Run Pytest Baseline| PytestProc

    PytestProc -->|4. Failure Tracebacks| Ultra
    Ultra -->|5. Migration Plan| Streamer

    PytestProc -->|Targeted Keywords| Tavily
    Tavily -->|Official Docs| Nano
    Nano -->|6. Synthesized Rules & URLs| Streamer

    Streamer -->|7. Plan + Rules + Code| Super
    Super -->|8. Structured Edits| Patcher
    Patcher -->|9. AST Validate & Write| TempVenv
    TempVenv -->|10. Re-run Pytest| PytestProc

    PytestProc -->|11. All Green (or Max Iterations)| Ultra
    Ultra -->|12. GitHub PR Summary & Risk Review| Streamer

    Streamer --> Browser
    Streamer --> CostGauge
    Streamer --> DiffUI
```

---

## How We Use NVIDIA Nemotron

Upgrade Pilot implements a **tri-tier model specialization strategy** via Nebius Token Factory, matching each agent task to the ideal model size, reasoning depth, and latency characteristics:

| Model Tier | Model Identifier | Role | Why This Model? |
|---|---|---|---|
| **Nemotron 3 Ultra** | `nvidia/Nemotron-3-Ultra-550b-a55b` | Architectural Migration Planning & Final PR Review | 550B MoE with deep chain-of-thought reasoning tokens. Analyzes full codebase ASTs, cross-file relationships, and generates comprehensive GitHub PR descriptions with breaking-change risk analyses and documentation citations. |
| **Nemotron 3 Super** | `nvidia/nemotron-3-super-120b-a12b` | Targeted Code Patching & Error Repair | 120B MoE with high code-generation precision. Generates concise Search/Replace blocks or full-file replacements. Auto-repairs malformed syntax when prompted. |
| **Nemotron 3 Nano** | `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | Real-Time Documentation Summarization | 30B MoE with near-instantaneous time-to-first-token (TTFT). Condenses dense 800-word documentation pages from Tavily into precise 1-sentence actionable migration rules at negligible cost ($0.10/1M input). |

### Granular Reasoning Token Extraction
Both Nemotron 3 Ultra and Nemotron 3 Super generate deep internal reasoning chains (often 500–2,500 tokens). Upgrade Pilot inspects completion payloads to extract `usage.completion_tokens_details.reasoning_tokens`, providing transparent insight into model reasoning time and accurate cost calculations on the live telemetry dashboard.

---

## Where Nebius Token Factory Helped

In this project, our primary Nebius service integration was **Nebius Token Factory** (`https://api.studio.nebius.ai/v1`). It provided:

1. **Standard OpenAI-Compatible API**:
   Allowed us to interact with 30B, 120B, and 550B NVIDIA Nemotron models through the standard `openai` Python SDK simply by setting `base_url="https://api.studio.nebius.ai/v1"`. No proprietary client wrappers or low-level CUDA drivers were needed.
2. **High-Throughput MoE Inference**:
   Running a 550B parameter model like Nemotron 3 Ultra and a 120B model like Nemotron 3 Super with multi-thousand token reasoning chains delivered the low latency required to keep the live web UI responsive.
3. **Transparent Per-Call Token Accounting**:
   Nebius passes granular usage statistics in the completion payload (including `prompt_tokens`, `completion_tokens`, and `completion_tokens_details.reasoning_tokens`), enabling live USD cost calculation.
4. **Other Nebius Services**:
   Outside of Token Factory, the web server and sandbox runtime can deploy as a standard container onto **Nebius Cloud Compute**. For the hackathon submission, all model inference runs strictly through Nebius Token Factory endpoints.

---

## How Tavily Search Is Used

General LLMs frequently hallucinate deprecated methods or confuse v1 vs v2 syntaxes (e.g., mixing up Pydantic's `pattern=` with regex flags or guessing SQLAlchemy 2.0 query methods).

Upgrade Pilot grounds its agent in live, ground-truth documentation:
1. When baseline tests fail, the agent analyzes the breaking symbols and error messages.
2. It generates 2 to 4 targeted documentation queries (e.g., `pydantic v2 migration guide regex pattern Field replacement`).
3. It calls the **Tavily Search API** (`POST https://api.tavily.com/search`) with `include_domains` restricted to official documentation domains (`docs.pydantic.dev`, `pydantic.dev`, `docs.sqlalchemy.org`, `sqlalchemy.org`).
4. **Nemotron 3 Nano** summarizes each search result into a concise, actionable migration rule.
5. All source URLs and titles are retained and rendered as hyperlinked citations in the live timeline and final PR description.
6. **Fault Tolerance**: If a network error occurs, the Tavily client retries with exponential backoff. If the API request still fails or if no API key is provided, the agent surfaces a visible warning in the UI and continues with a clearly labeled `"no external docs available"` note. It never silently substitutes fake or hardcoded mock documentation.

---

## Prepared Demo Repositories

For security and deterministic evaluation, Upgrade Pilot includes two realistic demo services under `demos/`:

1. **[`demo_pydantic`](demos/demo_pydantic/) (Pydantic 1.10.17 → 2.14.1)**:
   - Real-world e-commerce order and customer service (~170 LOC).
   - 10 pytest tests (100% pass on v1; fails collection on v2 before patch).
   - Upgrades breaking `Field(regex=...)`, `@validator`, `class Config (orm_mode, anystr_strip_whitespace)`, `.dict()`, `.parse_obj()`, and assignment validation recursion guards.
2. **[`demo_sqlalchemy`](demos/demo_sqlalchemy/) (SQLAlchemy 1.4.54 → 2.0.55)**:
   - Project task management service (~140 LOC).
   - 8 pytest tests (100% pass on 1.4; 2 tests fail on 2.0 before patch).
   - Upgrades breaking `engine.execute(...)` string execution removal, legacy `session.query().get()`, and `declarative_base`.

---

## Local Setup & Run Instructions

### Prerequisites
- Python 3.11+
- Virtual environment tool (`venv`)
- Git

### Quickstart (Local Virtualenv)

```bash
# 1. Clone the repository
git clone https://github.com/ritesh-1912/Nebius-Hackathon.git
cd Nebius-Hackathon

# 2. Create virtual environment
python3 -m venv .venv
source .venv/bin/activate

# 3. Install dependencies
pip install -r requirements.txt
pip install -e . --no-deps

# 4. Configure environment variables
cp .env.example .env
# Edit .env with your NEBIUS_API_KEY and TAVILY_API_KEY

# 5. Populate local offline wheelhouse
python scripts/build_wheelhouse.py

# 6. Verify sandbox execution proof (all-green on old version, red on new version)
python scripts/verify_sandbox.py

# 7. Run CLI directly
python -m upgrade_pilot.cli demo_pydantic

# 8. Or start the web application
uvicorn upgrade_pilot.main:app --host 0.0.0.0 --port 8000 --reload
```
Open **`http://localhost:8000`** in your browser.

---

## Docker Setup & Deployment

### Run with Docker Locally

```bash
# Build production image (pre-builds Linux wheelhouse inside image)
docker build -t upgrade-pilot .

# Run with environment secrets mounted at runtime
docker run --rm -it -p 8000:8000 --env-file .env upgrade-pilot
```

### Production Deployment (Render)
Upgrade Pilot is pre-configured for 1-click deployment on **Render** via [`render.yaml`](render.yaml). See [`DEPLOY.md`](DEPLOY.md) for full instructions.

---

## Limitations

- **Language Scope**: Currently optimized for Python codebases using `pytest`.
- **Sandbox Security**: For the public hosted demo, code uploads are disabled; execution is strictly restricted to the two preset demo repositories to prevent arbitrary remote code execution on the host.
- **Iteration & Token Caps**: Patches are capped at 5 iterations or a 60,000 token budget per run to prevent runaway API spending.

---

## License

This project is open-source under the [MIT License](LICENSE).
