"""Rate limiting and global daily token budget management."""

import datetime
import logging
import threading
import time
from typing import Dict, List, Tuple
from upgrade_pilot.config import get_settings

logger = logging.getLogger(__name__)


class BudgetAndRateLimiter:
    """Thread-safe rate limiter and daily token budget accumulator."""

    def __init__(self):
        self.settings = get_settings()
        self._lock = threading.Lock()

        # Daily token budget state
        self._current_date: str = self._get_utc_date_str()
        self._daily_tokens_used: int = 0
        self._daily_token_limit: int = getattr(self.settings, "DAILY_TOKEN_LIMIT", 500000)

        # Sliding window rate limiter: IP -> list of timestamps
        self._ip_requests: Dict[str, List[float]] = {}
        self._max_requests_per_window: int = 5
        self._window_seconds: int = 600  # 10 minutes

    @staticmethod
    def _get_utc_date_str() -> str:
        return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")

    def _reset_if_new_day(self) -> None:
        today = self._get_utc_date_str()
        if today != self._current_date:
            logger.info(f"New UTC day ({today}). Resetting daily token counter from {self._daily_tokens_used} to 0.")
            self._current_date = today
            self._daily_tokens_used = 0

    def check_rate_limit(self, client_ip: str) -> Tuple[bool, str]:
        """Check if client IP has exceeded the sliding window rate limit."""
        with self._lock:
            now = time.time()
            timestamps = self._ip_requests.setdefault(client_ip, [])

            # Prune timestamps older than window
            cutoff = now - self._window_seconds
            timestamps = [ts for ts in timestamps if ts > cutoff]
            self._ip_requests[client_ip] = timestamps

            if len(timestamps) >= self._max_requests_per_window:
                retry_after = int(self._window_seconds - (now - timestamps[0]))
                return False, f"Rate limit exceeded (max 5 runs per 10 min). Please retry in {retry_after}s."

            # Record this attempt
            timestamps.append(now)
            return True, ""

    def check_daily_budget(self) -> Tuple[bool, str]:
        """Check if global daily token budget has been exhausted."""
        with self._lock:
            self._reset_if_new_day()
            if self._daily_tokens_used >= self._daily_token_limit:
                return False, (
                    f"Daily evaluation token budget reached ({self._daily_tokens_used:,} / {self._daily_token_limit:,} tokens). "
                    f"Showing high-fidelity cached demonstration run."
                )
            return True, ""

    def record_tokens(self, tokens: int) -> None:
        """Accumulate consumed tokens into the daily budget."""
        with self._lock:
            self._reset_if_new_day()
            self._daily_tokens_used += tokens

    def get_status(self) -> dict:
        """Return budget and rate limiting status for health checks."""
        with self._lock:
            self._reset_if_new_day()
            return {
                "utc_date": self._current_date,
                "daily_tokens_used": self._daily_tokens_used,
                "daily_token_limit": self._daily_token_limit,
                "budget_exhausted": self._daily_tokens_used >= self._daily_token_limit,
                "active_tracked_ips": len(self._ip_requests),
            }


# Global singleton instance
budget_limiter = BudgetAndRateLimiter()
