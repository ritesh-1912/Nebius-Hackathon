"""Configuration and pricing settings for Upgrade Pilot."""

import os
from functools import lru_cache
from typing import Dict
from pydantic_settings import BaseSettings, SettingsConfigDict

# ==============================================================================
# PRICE CONSTANTS (USD per 1,000,000 tokens)
# Easily edit these rates to reflect Nebius Token Factory pricing tiers.
# ==============================================================================
DEFAULT_PRICE_PER_1M_TOKENS: Dict[str, Dict[str, float]] = {
    "ultra": {
        "input": 2.00,
        "output": 6.00,
    },
    "super": {
        "input": 0.60,
        "output": 1.80,
    },
    "nano": {
        "input": 0.10,
        "output": 0.20,
    },
}


class Settings(BaseSettings):
    """Application settings loaded from environment or .env file."""

    # Nebius Token Factory settings
    NEBIUS_API_KEY: str = ""
    NEBIUS_BASE_URL: str = "https://api.studio.nebius.ai/v1"

    # NVIDIA Nemotron Model IDs (Verified on Nebius Token Factory)
    MODEL_ULTRA: str = "nvidia/Nemotron-3-Ultra-550b-a55b"
    MODEL_SUPER: str = "nvidia/nemotron-3-super-120b-a12b"
    MODEL_NANO: str = "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B"

    # Tavily Search API
    TAVILY_API_KEY: str = ""

    # Subprocess & LLM network limits
    NEBIUS_TIMEOUT_SECONDS: float = 180.0
    NEBIUS_MAX_RETRIES: int = 4
    SANDBOX_TIMEOUT_SECONDS: int = 25
    MAX_ITERATIONS: int = 5
    MAX_TOKEN_BUDGET: int = 60000
    PER_RUN_TIMEOUT_SECONDS: int = 300
    MAX_CONCURRENT_RUNS: int = 1
    DAILY_TOKEN_LIMIT: int = 500000

    # Optional price overrides (USD per 1M tokens)
    PRICE_ULTRA_INPUT: float = DEFAULT_PRICE_PER_1M_TOKENS["ultra"]["input"]
    PRICE_ULTRA_OUTPUT: float = DEFAULT_PRICE_PER_1M_TOKENS["ultra"]["output"]
    PRICE_SUPER_INPUT: float = DEFAULT_PRICE_PER_1M_TOKENS["super"]["input"]
    PRICE_SUPER_OUTPUT: float = DEFAULT_PRICE_PER_1M_TOKENS["super"]["output"]
    PRICE_NANO_INPUT: float = DEFAULT_PRICE_PER_1M_TOKENS["nano"]["input"]
    PRICE_NANO_OUTPUT: float = DEFAULT_PRICE_PER_1M_TOKENS["nano"]["output"]

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    def get_tier_pricing(self, tier: str) -> Dict[str, float]:
        """Return input and output price per 1M tokens for a given tier."""
        tier = tier.lower()
        if tier == "ultra":
            return {"input": self.PRICE_ULTRA_INPUT, "output": self.PRICE_ULTRA_OUTPUT}
        elif tier == "super":
            return {"input": self.PRICE_SUPER_INPUT, "output": self.PRICE_SUPER_OUTPUT}
        elif tier == "nano":
            return {"input": self.PRICE_NANO_INPUT, "output": self.PRICE_NANO_OUTPUT}
        return {"input": 0.0, "output": 0.0}


@lru_cache()
def get_settings() -> Settings:
    """Return cached application settings."""
    return Settings()
