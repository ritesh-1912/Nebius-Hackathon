# Deployment Guide: Upgrade Pilot

> **Primary Host**: **Render** (Production-ready Docker Web Service)  
> *Alternate Supported Host*: **Fly.io**  
> *Source Repository*: `https://github.com/ritesh-1912/Nebius-Hackathon`  
> *License*: MIT

---

## 1. Architectural Safeguards for Public Traffic

Upgrade Pilot is pre-configured with multi-layer security and quota guards specifically designed for public hackathon demonstration:

1. **Strict Preset Demo Whitelist**:
   - Only `demo_pydantic` and `demo_sqlalchemy` can be executed.
   - Any arbitrary, uploaded, or non-whitelisted repository paths are immediately rejected with `evt_rejected` and a clear error message.
2. **Per-IP Rate Limiting**:
   - Sliding-window rate limiter restricts clients to **5 upgrade runs per 10 minutes** to eliminate bot spam.
   - Exceeding the limit surfaces the redesigned `Rate Limited (429)` state card offering an instant recorded run.
3. **Concurrency Semaphore**:
   - Max **1 active sandbox upgrade** at a time (`MAX_CONCURRENT_RUNS=1`) to prevent server memory exhaustion and avoid hitting Nebius Token Factory rate limits. Subsequent visitors are shown the `Queued` state card with options to wait or watch a recorded run.
4. **Per-Run Timeout**:
   - Hard **300-second (5-minute) cap** per upgrade run (`PER_RUN_TIMEOUT_SECONDS=300`).
5. **Per-Run Token Cap & Iteration Cap**:
   - Loop terminates if cumulative tokens reach `MAX_TOKEN_BUDGET=60,000` or if repair attempts reach `MAX_ITERATIONS=5`, surfacing clean cap-reached cards with options to inspect partial diffs.
6. **Global Daily Spend Cap**:
   - Caps total platform spend at `DAILY_SPEND_LIMIT_USD=$10.00` and `DAILY_TOKEN_LIMIT=500,000` tokens/day.
   - When reached, new live runs are refused gracefully and the UI offers **"Watch a recorded run"**.
7. **High-Fidelity Recorded Runs (Zero API Calls)**:
   - Each demo contains a pre-recorded, verified real upgrade run (`pydantic_cached.json` and `sqlalchemy_cached.json`).
   - The UI displays a distinct **"Recorded run"** header badge and informational banner.
   - Works with **zero API calls and zero tokens consumed**, even if all API keys are missing.
8. **Sandbox Isolation & Non-Root Execution**:
   - Pytest execution runs in ephemeral virtual environments created from a pre-built offline wheelhouse.
   - Subprocess runs with stripped, sanitized environments—no API keys or credentials can be accessed by sandboxed code.
   - Dropped root privileges to non-root user `pilot` (UID 1000).

---

## 2. Configuration Through Environment Variables

Every setting is configured exclusively through environment variables. No secrets are baked into the Docker image or repository.

| Environment Variable | Default Value | Description | Required? |
| :--- | :--- | :--- | :--- |
| `NEBIUS_API_KEY` | *(None)* | Nebius Token Factory API key for calling NVIDIA Nemotron models. If omitted, the app automatically serves recorded runs. | Yes (for live runs) |
| `NEBIUS_BASE_URL` | `https://api.studio.nebius.ai/v1` | OpenAI-compatible endpoint URL for Nebius Token Factory. | No |
| `MODEL_ULTRA` | `nvidia/Nemotron-3-Ultra-550b-a55b` | Model ID for Ultra tier: migration planning and PR review generation. | No |
| `MODEL_SUPER` | `nvidia/nemotron-3-super-120b-a12b` | Model ID for Super tier: structured search/replace code patching and syntax correction. | No |
| `MODEL_NANO` | `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | Model ID for Nano tier: fast 1-sentence summarization of documentation search snippets. | No |
| `TAVILY_API_KEY` | *(None)* | Tavily Search API key for official migration guide lookup. If omitted, agent operates in offline fallback mode. | Optional |
| `DAILY_SPEND_LIMIT_USD` | `10.0` | Global daily spend budget in USD across all visitors. When reached, live runs halt and offer recorded runs. | No |
| `DAILY_TOKEN_LIMIT` | `500000` | Global daily token budget across all visitors. | No |
| `MAX_CONCURRENT_RUNS` | `1` | Maximum simultaneous live upgrade pipelines. | No |
| `PER_RUN_TIMEOUT_SECONDS`| `300` | Hard timeout per upgrade run in seconds. | No |
| `MAX_TOKEN_BUDGET` | `60000` | Per-run token ceiling before halting the repair loop. | No |
| `MAX_ITERATIONS` | `5` | Maximum repair and pytest verification iterations. | No |
| `SANDBOX_TIMEOUT_SECONDS`| `25` | Per-pytest execution timeout in sandbox. | No |
| `PORT` | `8000` | HTTP port for the Uvicorn web server (Render and Fly set this dynamically). | No |

---

## 3. Step-by-Step Deployment on Render (Primary Target)

Render is our primary deployment platform because of its native Docker support, automatic HTTPS, Blueprint repository syncing, and built-in health check routing.

### Option A: 1-Click Blueprint Deployment via `render.yaml` (Recommended)

1. Push your repository to GitHub: `https://github.com/ritesh-1912/Nebius-Hackathon`.
2. Navigate to [Render Dashboard](https://dashboard.render.com).
3. Click **New +** → **Blueprint**.
4. Connect the repository `ritesh-1912/Nebius-Hackathon`.
5. Render detects [`render.yaml`](file:///Users/riteshgarg/Downloads/Nebius%20Hackathon/render.yaml) automatically.
6. Provide the environment values when prompted:
   - `NEBIUS_API_KEY`: Enter your Nebius Token Factory key (`v1.CmQK...`).
   - `TAVILY_API_KEY`: Enter your Tavily API key (`tvly-...`, optional).
7. Click **Apply**. Render will automatically build the container, configure health checks on `/health`, and deploy to a live URL (`https://<app-name>.onrender.com`).

---

### Option B: Manual Web Service Setup on Render

1. Go to [Render Dashboard](https://dashboard.render.com).
2. Click **New +** → **Web Service**.
3. Select **Build and deploy from a Git repository** and connect `ritesh-1912/Nebius-Hackathon`.
4. Configure service fields:
   - **Name**: `upgrade-pilot`
   - **Region**: Oregon (US West) or Frankfurt (EU Central)
   - **Branch**: `main`
   - **Runtime**: **Docker**
   - **Dockerfile Path**: `./Dockerfile`
   - **Instance Type**: Starter ($7/mo) or Free instance
5. In **Environment Variables**, enter the variables listed in Section 2:
   - `NEBIUS_API_KEY`: `v1.CmQK...`
   - `NEBIUS_BASE_URL`: `https://api.studio.nebius.ai/v1`
   - `TAVILY_API_KEY`: `tvly-...`
   - `DAILY_SPEND_LIMIT_USD`: `10.0`
   - `MAX_CONCURRENT_RUNS`: `1`
   - `PER_RUN_TIMEOUT_SECONDS`: `300`
6. Under **Health Check Path**, enter: `/health`.
7. Click **Create Web Service**.

---

## 4. Alternative Deployment on Fly.io

To deploy to Fly.io instead:

```bash
# 1. Install flyctl
brew install flyctl

# 2. Authenticate
fly auth login

# 3. Launch the app (uses existing Dockerfile)
fly launch --name upgrade-pilot --region sea --no-deploy

# 4. Set platform secrets securely (never baked into Docker image)
fly secrets set \
  NEBIUS_API_KEY="v1.CmQK..." \
  NEBIUS_BASE_URL="https://api.studio.nebius.ai/v1" \
  TAVILY_API_KEY="tvly-..." \
  DAILY_SPEND_LIMIT_USD="10.0"

# 5. Deploy the application
fly deploy
```

---

## 5. Local Docker Verification & Testing

Verify the container build and runtime behavior locally before pushing to production:

```bash
# 1. Build the production Docker image
docker build -t upgrade-pilot:latest .

# 2. Run with environment variables (or mount .env)
docker run --rm -it \
  -p 8000:8000 \
  -e NEBIUS_API_KEY="your-key" \
  -e NEBIUS_BASE_URL="https://api.studio.nebius.ai/v1" \
  -e TAVILY_API_KEY="your-tavily-key" \
  upgrade-pilot:latest

# 3. Verify health endpoint
curl -s http://localhost:8000/health | jq .
```

---

## 6. Verification Checklist

1. **Health Check**:
   ```bash
   curl -s http://localhost:8000/health
   ```
   Confirm `status == "healthy"`, `nebius_key_present: true`, and `cached_runs_available` are `true`.
2. **Landing Page**:
   Open `http://localhost:8000/`. Verify top wordmark, 4 numbered steps, demo cards with before → after versions, and "Under the hood" table.
3. **Pydantic v2 Migration Flow**:
   Run live or recorded upgrade. Verify 10 passing tests, `order_service.py` modified, and zero test files touched.
4. **SQLAlchemy 2.0 Migration Flow**:
   Run upgrade. Verify 8 passing tests, `task_service.py` modified, and `test_task_service.py` untouched.
5. **Zero API Key Fallback**:
   Run container without `NEBIUS_API_KEY`. Verify the UI seamlessly streams the recorded run with full diffs and review summaries.
