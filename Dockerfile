# ==============================================================================
# Upgrade Pilot — Production Containerfile
# Designed for Render / Fly.io / Nebius Cloud Deployment
# ==============================================================================

FROM python:3.11-slim

# Set environment defaults (Secrets injected by hosting platform at runtime)
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8000

WORKDIR /app

# Install lightweight build dependencies for compiling any C-extensions if needed
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    python3-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install project Python requirements
COPY requirements.txt pyproject.toml /app/
RUN pip install --no-cache-dir --retries 5 --timeout 60 -r requirements.txt

# Pre-build local wheelhouse inside the Linux container for instant offline sandbox runs
COPY scripts/ /app/scripts/
RUN mkdir -p /app/wheelhouse && \
    python scripts/build_wheelhouse.py

# Copy application code, demos, and static assets
COPY demos/ /app/demos/
COPY static/ /app/static/
COPY src/ /app/src/

# Set python path so upgrade_pilot package is immediately importable
ENV PYTHONPATH="/app/src"

# Create non-root user 'pilot' and configure permissions
RUN useradd -m -u 1000 pilot && \
    mkdir -p /tmp/upgrade_pilot_runs && \
    chown -R pilot:pilot /tmp/upgrade_pilot_runs /app

USER pilot

EXPOSE 8000

# Healthcheck for container orchestrators
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:${PORT:-8000}/health || exit 1

# Start Uvicorn bound to platform PORT
CMD ["sh", "-c", "uvicorn upgrade_pilot.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
