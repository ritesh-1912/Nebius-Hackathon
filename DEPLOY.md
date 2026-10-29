# Deployment Guide: Upgrade Pilot

> **Chosen Platform**: **Render** (Recommended for Hackathon Web Services)  
> *Alternate Supported Platform*: **Fly.io**  
> *Source Repository*: `https://github.com/ritesh-1912/Nebius-Hackathon`

---

## 1. Architectural Safeguards Built for Public Deployment

Upgrade Pilot includes production-grade security and quota guards tailored for public hackathon evaluation:

1. **Strict Preset Demo Whitelist**:
   - Only `demo_pydantic` and `demo_sqlalchemy` can be executed.
   - Any user-supplied, uploaded, or arbitrary repository paths are blocked with an immediate 400 rejection.
2. **Per-IP Rate Limiting**:
   - Sliding-window rate limiter restricts clients to **5 upgrade runs per 10 minutes** to eliminate bot spam.
3. **Concurrency Semaphore**:
   - Max **1 active sandbox upgrade** at a time to prevent server memory or Nebius Token Factory rate limits from exhausting. Additional visitors receive a polite waiting notice.
4. **Per-Run Timeout**:
   - Hard **300-second (5-minute) cap** per upgrade run.
5. **Global Daily Token Budget**:
   - Caps total token consumption at **500,000 tokens/day** (configurable via `DAILY_TOKEN_LIMIT`).
6. **Cached Fallback Mode**:
   - If Nebius API credits run low, or the daily token budget is reached, the application **automatically switches to a verified cached demonstration run**. The UI streams realistic paced steps, rendered diffs, and PR summaries so judges always experience the full product.
7. **Zero Secrets in Docker Images**:
   - `.dockerignore` excludes all `.env` files and local binaries. All credentials (`NEBIUS_API_KEY`, `TAVILY_API_KEY`) are injected exclusively by the hosting platform at runtime.

---

## 2. Step-by-Step Deployment on Render (Primary Target)

### Option A: 1-Click Blueprint Deployment (Fastest)

1. Fork or push changes to your GitHub repo: `https://github.com/ritesh-1912/Nebius-Hackathon`.
2. Log in to [Render.com](https://render.com).
3. Click **New +** → **Blueprint**.
4. Connect the repository `ritesh-1912/Nebius-Hackathon`.
5. Render detects [`render.yaml`](file:///Users/riteshgarg/Downloads/Nebius%20Hackathon/render.yaml) automatically.
6. Provide the required secrets when prompted:
   - `NEBIUS_API_KEY`: `v1.CmQK...`
   - `TAVILY_API_KEY`: `tvly-...` *(optional; defaults to offline cache if omitted)*
7. Click **Apply**. Render will build the Docker container and deploy the web app.

---

### Option B: Manual Web Service Setup on Render

1. Log in to [Render Dashboard](https://dashboard.render.com).
2. Click **New +** → **Web Service**.
3. Select **Build and deploy from a Git repository** and connect `ritesh-1912/Nebius-Hackathon`.
4. Configure the service settings:
   - **Name**: `upgrade-pilot`
   - **Region**: Oregon (US West) or Frankfurt (EU Central)
   - **Branch**: `main`
   - **Runtime**: **Docker**
   - **Dockerfile Path**: `./Dockerfile`
   - **Instance Type**: Starter ($7/mo) or Free instance
5. Under **Environment Variables**, add:
   | Key | Value | Description |
   |---|---|---|
   | `NEBIUS_API_KEY` | `v1.CmQK...` | Nebius Token Factory API Key |
   | `NEBIUS_BASE_URL` | `https://api.studio.nebius.ai/v1` | Nebius Studio endpoint |
   | `MODEL_ULTRA` | `nvidia/Nemotron-3-Ultra-550b-a55b` | Ultra reasoning model |
   | `MODEL_SUPER` | `nvidia/nemotron-3-super-120b-a12b` | Super code patcher |
   | `MODEL_NANO` | `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | Nano search summarizer |
   | `TAVILY_API_KEY` | `tvly-...` | Web search API key |
   | `DAILY_TOKEN_LIMIT`| `500000` | Global daily token budget |
   | `DAILY_SPEND_LIMIT_USD`| `10.0` | Global daily spend budget ($ USD) |
   | `MAX_CONCURRENT_RUNS`| `1` | Max concurrent sandbox runs |
   | `PER_RUN_TIMEOUT_SECONDS` | `300` | Max run duration |
6. Under **Health Check Path**, enter: `/health`.
7. Click **Create Web Service**.

---

## 3. Alternative Deployment on Fly.io

If deploying to Fly.io instead:

```bash
# 1. Install flyctl if not present
brew install flyctl

# 2. Authenticate
fly auth login

# 3. Launch the app (select Dockerfile)
fly launch --name upgrade-pilot --region sea --no-deploy

# 4. Set platform secrets (never baked into image)
fly secrets set \
  NEBIUS_API_KEY="v1.CmQK..." \
  NEBIUS_BASE_URL="https://api.studio.nebius.ai/v1" \
  MODEL_ULTRA="nvidia/Nemotron-3-Ultra-550b-a55b" \
  MODEL_SUPER="nvidia/nemotron-3-super-120b-a12b" \
  MODEL_NANO="nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B" \
  TAVILY_API_KEY="tvly-..."

# 5. Deploy
fly deploy
```

---

## 4. Local Container Testing (Pre-Deployment Validation)

You can build and test the production Docker container locally using:

```bash
# Build the container (pre-downloads Linux wheelhouse)
docker build -t upgrade-pilot .

# Run with local .env secrets mounted at runtime
docker run --rm -it -p 8000:8000 --env-file .env upgrade-pilot
```

Visit `http://localhost:8000` to verify the UI.

---

## 5. Post-Deployment Verification Checklist

Once deployed, verify the public URL:

1. **Health Check**:
   ```bash
   curl -s https://<your-app>.onrender.com/health | jq .
   ```
   *Expected response*:
   ```json
   {
     "status": "healthy",
     "app": "Upgrade Pilot",
     "models": { ... },
     "max_concurrent_runs": 1,
     "per_run_timeout_seconds": 300,
     "allowed_demos": ["demo_pydantic", "demo_sqlalchemy"],
     "budget_telemetry": {
       "daily_tokens_used": 0,
       "daily_token_limit": 500000,
       "budget_exhausted": false
     }
   }
   ```

2. **UI & SSE Stream Check**:
   - Open `https://<your-app>.onrender.com/` in your browser.
   - Click **Run Upgrade Pilot** for Demo 1.
   - Observe live event stream, progress bar, real-time token/cost gauge, and the final generated Pull Request review.
