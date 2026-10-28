"""FastAPI application entrypoint for Upgrade Pilot."""

import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from upgrade_pilot.config import get_settings
from upgrade_pilot.llm.cost_tracker import CostTracker

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("upgrade_pilot")

settings = get_settings()
cost_tracker = CostTracker(settings)

app = FastAPI(
    title="Upgrade Pilot",
    description="Autonomous Python dependency migration agent powered by NVIDIA Nemotron on Nebius Token Factory",
    version="0.1.0",
)

# CORS middleware for open hosted access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health_check():
    """Health check endpoint confirming API status and configured models."""
    return {
        "status": "healthy",
        "app": "Upgrade Pilot",
        "models": {
            "ultra": settings.MODEL_ULTRA,
            "super": settings.MODEL_SUPER,
            "nano": settings.MODEL_NANO,
        },
        "nebius_base_url": settings.NEBIUS_BASE_URL,
    }


@app.get("/api/demos")
def get_demos():
    """Return list of prepared demo repositories."""
    return [
        {
            "id": "pydantic_v1_to_v2",
            "name": "Pydantic v1 → v2 Migration",
            "description": "Migrates .dict() → .model_dump(), .parse_obj() → .model_validate(), @validator → @field_validator, and Config class.",
            "library": "pydantic",
            "from_version": "1.10.15",
            "to_version": "2.8.2",
            "tests_count": 5,
        },
        {
            "id": "sqlalchemy_v1_to_v2",
            "name": "SQLAlchemy 1.4 → 2.0 Migration",
            "description": "Migrates legacy session.query() → session.scalars(select()), session.query().get() → session.get(), and DeclarativeBase.",
            "library": "sqlalchemy",
            "from_version": "1.4.52",
            "to_version": "2.0.31",
            "tests_count": 4,
        },
    ]


@app.get("/api/pricing")
def get_pricing():
    """Return current configured pricing per 1M tokens."""
    return {
        "ultra": settings.get_tier_pricing("ultra"),
        "super": settings.get_tier_pricing("super"),
        "nano": settings.get_tier_pricing("nano"),
    }
