import json
from functools import lru_cache
from pathlib import Path

CATALOG_PATH = Path(__file__).parent / "catalog.json"

# Which catalog category and vendor each ingest source belongs to
SOURCE_PROFILE = {
    "chatgpt": {"category": "assistant", "vendor": "OpenAI"},
    "copilot": {"category": "coding", "vendor": "GitHub"},
    "cursor": {"category": "coding", "vendor": "Cursor"},
}

# Model names that mean "cheap tier" across vendors; anything else counts as premium
LOW_TIER_MARKERS = ("mini", "nano", "lite", "flash", "haiku", "luna")


@lru_cache
def load_catalog() -> dict:
    return json.loads(CATALOG_PATH.read_text())


def model_tier(model_name: str) -> str:
    name = model_name.lower()
    return "low" if any(m in name for m in LOW_TIER_MARKERS) else "high"
