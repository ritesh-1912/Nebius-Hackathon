"""Tavily search client wrapper for real-time documentation & changelog grounding."""

import logging
from typing import List, Optional
from tavily import TavilyClient

from upgrade_pilot.config import Settings, get_settings
from upgrade_pilot.models import TavilySearchResponse, TavilySearchResultItem

logger = logging.getLogger(__name__)


# Curated offline fallback knowledge base in case TAVILY_API_KEY is not set or network fails
OFFLINE_MIGRATION_KNOWLEDGE = {
    "pydantic": [
        TavilySearchResultItem(
            title="Pydantic V2 Migration Guide - Deprecated Methods",
            url="https://docs.pydantic.dev/2.0/migration/",
            content=(
                "In Pydantic V2, `.dict()` is deprecated and replaced by `.model_dump()`. "
                "`.parse_obj()` is replaced by `.model_validate()`. "
                "The `@validator` decorator is replaced by `@field_validator(..., mode='after')` "
                "and must be decorated with `@classmethod`. "
                "Inner `class Config:` is replaced by `model_config = ConfigDict(...)`. "
                "Regex in Field() is now `pattern=` instead of `regex=`."
            ),
            score=0.99,
        ),
        TavilySearchResultItem(
            title="Pydantic V2 Field and Validator Changes",
            url="https://docs.pydantic.dev/latest/concepts/validators/",
            content=(
                "Field validators in V2 require `classmethod` and inspect `info: ValidationInfo` "
                "instead of `values` dict. Use `from pydantic import field_validator, ValidationInfo, ConfigDict`."
            ),
            score=0.95,
        ),
    ],
    "sqlalchemy": [
        TavilySearchResultItem(
            title="SQLAlchemy 2.0 Migration Guide - Query API Changes",
            url="https://docs.sqlalchemy.org/en/20/changelog/migration_20.html",
            content=(
                "In SQLAlchemy 2.0, `session.query(Model)` is legacy. Replace with 2.0 style "
                "`session.scalars(select(Model).where(...)).all()`. "
                "`session.query(Model).get(id)` is replaced by `session.get(Model, id)`. "
                "Raw string executions on engine are removed; use `connection.execute(text('...'))`."
            ),
            score=0.98,
        ),
        TavilySearchResultItem(
            title="SQLAlchemy 2.0 DeclarativeBase Transition",
            url="https://docs.sqlalchemy.org/en/20/orm/quickstart.html",
            content=(
                "`declarative_base()` function is replaced by subclassing `DeclarativeBase` "
                "from `sqlalchemy.orm`. Use `class Base(DeclarativeBase): pass`."
            ),
            score=0.94,
        ),
    ],
}


class TavilySearchClient:
    """Wrapper for Tavily API with graceful error handling and offline fallback."""

    def __init__(self, settings: Optional[Settings] = None):
        self.settings = settings or get_settings()
        self.api_key = self.settings.TAVILY_API_KEY
        self._client: Optional[TavilyClient] = None

        if self.api_key and not self.api_key.startswith("your_"):
            try:
                self._client = TavilyClient(api_key=self.api_key)
            except Exception as e:
                logger.warning(f"Failed to initialize TavilyClient: {e}")
        else:
            logger.info("TAVILY_API_KEY is not configured. Running in offline/fallback mode.")

    def search(
        self,
        query: str,
        max_results: int = 5,
        search_depth: str = "advanced",
    ) -> TavilySearchResponse:
        """Search documentation via Tavily API, falling back to cached knowledge if needed."""
        if self._client:
            try:
                raw = self._client.search(
                    query=query,
                    max_results=max_results,
                    search_depth=search_depth,
                    include_answer=True,
                )
                items: List[TavilySearchResultItem] = []
                for res in raw.get("results", []):
                    items.append(
                        TavilySearchResultItem(
                            title=res.get("title", ""),
                            url=res.get("url", ""),
                            content=res.get("content", ""),
                            score=res.get("score"),
                        )
                    )
                return TavilySearchResponse(
                    query=query,
                    results=items,
                    raw_answer=raw.get("answer"),
                    is_mock=False,
                )
            except Exception as e:
                logger.warning(f"Tavily search API call failed ({e}); falling back to cached knowledge.")

        # Offline fallback
        return self._get_fallback_response(query)

    def _get_fallback_response(self, query: str) -> TavilySearchResponse:
        """Return curated offline documentation results for the query."""
        q_lower = query.lower()
        if "sql" in q_lower or "alchemy" in q_lower:
            items = OFFLINE_MIGRATION_KNOWLEDGE["sqlalchemy"]
        else:
            items = OFFLINE_MIGRATION_KNOWLEDGE["pydantic"]

        return TavilySearchResponse(
            query=query,
            results=items,
            raw_answer="[Fallback Mode: TAVILY_API_KEY missing or inactive. Curated changelog provided.]",
            is_mock=True,
        )
