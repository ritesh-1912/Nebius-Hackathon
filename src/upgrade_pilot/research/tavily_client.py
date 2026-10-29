"""Tavily search client for real-time documentation and changelog grounding.

Makes real runtime HTTP calls to the Tavily Search API (POST https://api.tavily.com/search)
with Bearer authentication, retries, and domain filtering. Never uses fake/hardcoded data.
"""

import logging
from typing import List, Optional
import requests
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from upgrade_pilot.config import Settings, get_settings
from upgrade_pilot.models import TavilySearchResponse, TavilySearchResultItem

logger = logging.getLogger(__name__)

TAVILY_SEARCH_ENDPOINT = "https://api.tavily.com/search"


class TavilySearchError(Exception):
    """Raised when Tavily search fails after retries or when credentials are missing."""
    pass


class TavilySearchClient:
    """Production client for Tavily Search API with Bearer authentication and retries."""

    def __init__(self, settings: Optional[Settings] = None):
        self.settings = settings or get_settings()
        self.api_key = (self.settings.TAVILY_API_KEY or "").strip()
        if not self.api_key or self.api_key.startswith("your_"):
            logger.warning("TAVILY_API_KEY is not configured or is a placeholder.")

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=4),
        retry=retry_if_exception_type((requests.RequestException, TimeoutError)),
        reraise=True,
    )
    def _execute_search(self, payload: dict) -> dict:
        """Execute HTTP POST request to Tavily Search endpoint with Bearer auth."""
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        response = requests.post(
            TAVILY_SEARCH_ENDPOINT,
            headers=headers,
            json=payload,
            timeout=15,
        )
        response.raise_for_status()
        return response.json()

    def search(
        self,
        query: str,
        max_results: int = 4,
        search_depth: str = "advanced",
        include_domains: Optional[List[str]] = None,
    ) -> TavilySearchResponse:
        """Call Tavily Search API via POST with Bearer auth, retries, and domain filtering.

        Never silently substitutes fake or hardcoded documentation.
        Raises TavilySearchError if the key is missing or request fails after retries.
        """
        if not self.api_key or self.api_key.startswith("your_"):
            raise TavilySearchError(
                "TAVILY_API_KEY environment variable is not configured or invalid."
            )

        payload = {
            "query": query,
            "search_depth": search_depth,
            "max_results": max_results,
            "include_answer": True,
        }
        if include_domains:
            payload["include_domains"] = include_domains

        try:
            data = self._execute_search(payload)
            raw_results = data.get("results", [])

            # If domain filtering was applied and returned 0 hits, retry without domain restriction
            if not raw_results and include_domains:
                logger.info(
                    f"No results with include_domains={include_domains}. Retrying open web search for '{query}'."
                )
                payload.pop("include_domains", None)
                data = self._execute_search(payload)
                raw_results = data.get("results", [])

            items: List[TavilySearchResultItem] = []
            for res in raw_results:
                items.append(
                    TavilySearchResultItem(
                        title=res.get("title") or query,
                        url=res.get("url") or "",
                        content=res.get("content") or "",
                        score=res.get("score"),
                    )
                )

            return TavilySearchResponse(
                query=query,
                results=items,
                raw_answer=data.get("answer"),
                is_mock=False,
            )
        except Exception as e:
            logger.error(f"Tavily search API failed for query '{query}': {e}")
            raise TavilySearchError(f"Tavily search request failed: {e}") from e
