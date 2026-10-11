import json
from functools import lru_cache
from pathlib import Path

CATALOG_PATH = Path(__file__).parent / "catalog.json"

# Which catalog category and vendor each ingest source belongs to
SOURCE_PROFILE = {
    "chatgpt": {"category": "assistant", "vendor": "OpenAI", "product_type": "chat_assistant"},
    "copilot": {"category": "coding", "vendor": "GitHub", "product_type": "ide_plugin"},
    "cursor": {"category": "coding", "vendor": "Cursor", "product_type": "ai_editor"},
}

# Which product types can stand in for each other. A recommendation never crosses these lines:
# an office suite is not a drop-in for a chat assistant, even when it's cheaper.
COMPATIBLE_TYPES = {
    "chat_assistant": {"chat_assistant"},
    "office_suite": {"office_suite"},
    "ide_plugin": {"ide_plugin", "ai_editor"},
    "ai_editor": {"ide_plugin", "ai_editor"},
}

TYPE_LABELS = {
    "chat_assistant": "chat assistant",
    "office_suite": "office suite with AI",
    "ide_plugin": "coding assistant",
    "ai_editor": "coding assistant",
    "api": "pay-per-token API",
}

# Model names that mean "cheap tier" across vendors; anything else counts as premium
LOW_TIER_MARKERS = ("mini", "nano", "lite", "flash", "haiku", "luna")


@lru_cache
def load_catalog() -> dict:
    return json.loads(CATALOG_PATH.read_text())


def model_tier(model_name: str) -> str:
    name = model_name.lower()
    return "low" if any(m in name for m in LOW_TIER_MARKERS) else "high"
