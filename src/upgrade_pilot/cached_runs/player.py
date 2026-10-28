"""Player for cached sample demonstration runs."""

import json
import logging
import time
from pathlib import Path
from typing import Generator, Optional
from upgrade_pilot.models import AgentEvent

logger = logging.getLogger(__name__)

CACHED_DIR = Path(__file__).resolve().parent


def is_cached_available(demo_name: str) -> bool:
    """Check if a pre-recorded cached run exists for the demo."""
    target_file = get_cache_filepath(demo_name)
    return target_file is not None and target_file.is_file()


def get_cache_filepath(demo_name: str) -> Optional[Path]:
    """Resolve file path to cached JSON."""
    clean = demo_name.lower()
    if "pydantic" in clean:
        return CACHED_DIR / "pydantic_cached.json"
    elif "sql" in clean or "alchemy" in clean:
        return CACHED_DIR / "sqlalchemy_cached.json"
    return None


def stream_cached_run(
    demo_name: str,
    step_delay: float = 0.35,
) -> Generator[AgentEvent, None, None]:
    """Yield pre-recorded AgentEvents with a paced delay for live presentation."""
    path = get_cache_filepath(demo_name)
    if not path or not path.exists():
        logger.warning(f"No cached run available for {demo_name}")
        return

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        for item in data:
            event = AgentEvent.model_validate(item)
            yield event
            time.sleep(step_delay)
    except Exception as e:
        logger.error(f"Error streaming cached run: {e}", exc_info=True)
