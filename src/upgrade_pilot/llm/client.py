"""Nebius Token Factory client using the OpenAI Python SDK."""

import logging
import time
from typing import Any, Dict, List, Optional
import httpx
import openai
from openai import APIConnectionError, APIStatusError, APITimeoutError, OpenAI, RateLimitError
from tenacity import (
    before_sleep_log,
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)

from upgrade_pilot.config import Settings, get_settings
from upgrade_pilot.llm.cost_tracker import CostTracker
from upgrade_pilot.models import LLMResponse, TokenUsage

logger = logging.getLogger(__name__)


class NebiusClient:
    """OpenAI-compatible client for Nebius Token Factory with per-tier helpers."""

    def __init__(
        self,
        settings: Optional[Settings] = None,
        cost_tracker: Optional[CostTracker] = None,
    ):
        self.settings = settings or get_settings()
        self.cost_tracker = cost_tracker or CostTracker(self.settings)

        if not self.settings.NEBIUS_API_KEY:
            logger.warning("NEBIUS_API_KEY is not set. API calls will fail.")

        # Initialize OpenAI client with Nebius base_url and custom timeout
        timeout = httpx.Timeout(
            timeout=self.settings.NEBIUS_TIMEOUT_SECONDS,
            connect=30.0,
            read=self.settings.NEBIUS_TIMEOUT_SECONDS,
            write=30.0,
            pool=30.0,
        )
        self.client = OpenAI(
            base_url=self.settings.NEBIUS_BASE_URL,
            api_key=self.settings.NEBIUS_API_KEY,
            timeout=timeout,
            max_retries=0,  # We manage retries explicitly with tenacity for precise backoff
        )

    def _execute_completion_with_retry(
        self,
        model: str,
        messages: List[Dict[str, str]],
        max_tokens: int,
        temperature: float,
    ) -> Any:
        """Call Nebius Token Factory chat completions with exponential retry on 429/5xx."""

        @retry(
            reraise=True,
            stop=stop_after_attempt(self.settings.NEBIUS_MAX_RETRIES),
            wait=wait_exponential(multiplier=1.5, min=2, max=15),
            retry=retry_if_exception_type((RateLimitError, APIConnectionError, APITimeoutError, APIStatusError)),
            before_sleep=before_sleep_log(logger, logging.WARNING),
        )
        def _call() -> Any:
            return self.client.chat.completions.create(
                model=model,
                messages=messages,
                max_tokens=max_tokens,
                temperature=temperature,
            )

        return _call()

    def call_model(
        self,
        tier: str,
        model_id: str,
        prompt: str,
        system_prompt: Optional[str] = None,
        max_tokens: int = 2048,
        temperature: float = 0.2,
    ) -> LLMResponse:
        """Execute a completion on any model tier, extracting token usage and cost."""
        messages: List[Dict[str, str]] = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        completion = self._execute_completion_with_retry(
            model=model_id,
            messages=messages,
            max_tokens=max_tokens,
            temperature=temperature,
        )

        choice = completion.choices[0]
        content = choice.message.content or ""

        # Extract reasoning content if present (common in Nemotron MoE models)
        reasoning = (
            getattr(choice.message, "reasoning_content", None)
            or getattr(choice.message, "reasoning", None)
        )
        if not reasoning and hasattr(choice.message, "model_extra") and choice.message.model_extra:
            reasoning = choice.message.model_extra.get("reasoning_content") or choice.message.model_extra.get("reasoning")

        # Extract detailed token usage
        prompt_tokens = getattr(completion.usage, "prompt_tokens", 0) or 0
        completion_tokens = getattr(completion.usage, "completion_tokens", 0) or 0
        total_tokens = getattr(completion.usage, "total_tokens", prompt_tokens + completion_tokens) or 0

        reasoning_tokens = 0
        details = getattr(completion.usage, "completion_tokens_details", None)
        if details:
            reasoning_tokens = getattr(details, "reasoning_tokens", 0) or 0

        usage = TokenUsage(
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            reasoning_tokens=reasoning_tokens,
            total_tokens=total_tokens,
        )

        cost_usd = self.cost_tracker.record_usage(tier=tier, usage=usage)

        return LLMResponse(
            text=content.strip(),
            tier=tier.lower(),
            model=model_id,
            usage=usage,
            estimated_cost_usd=cost_usd,
            reasoning=str(reasoning).strip() if reasoning else None,
        )

    def call_ultra(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        max_tokens: int = 4096,
        temperature: float = 0.2,
    ) -> LLMResponse:
        """Call Nemotron 3 Ultra for planning migrations and PR reviews."""
        return self.call_model(
            tier="ultra",
            model_id=self.settings.MODEL_ULTRA,
            prompt=prompt,
            system_prompt=system_prompt,
            max_tokens=max_tokens,
            temperature=temperature,
        )

    def call_super(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        max_tokens: int = 4096,
        temperature: float = 0.1,
    ) -> LLMResponse:
        """Call Nemotron 3 Super for code patching and syntax correction."""
        return self.call_model(
            tier="super",
            model_id=self.settings.MODEL_SUPER,
            prompt=prompt,
            system_prompt=system_prompt,
            max_tokens=max_tokens,
            temperature=temperature,
        )

    def call_nano(
        self,
        prompt: str,
        system_prompt: Optional[str] = None,
        max_tokens: int = 1536,
        temperature: float = 0.1,
    ) -> LLMResponse:
        """Call Nemotron 3 Nano for fast Tavily search summarization."""
        return self.call_model(
            tier="nano",
            model_id=self.settings.MODEL_NANO,
            prompt=prompt,
            system_prompt=system_prompt,
            max_tokens=max_tokens,
            temperature=temperature,
        )
