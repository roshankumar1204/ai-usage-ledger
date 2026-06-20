from sqlmodel import SQLModel, Field
from datetime import datetime
from typing import Optional

class AIUsageEvent(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    dedup_key: str = Field(index=True, unique=True)   # source + raw_event_id hash
    source: str                                         # "chatgpt" | "copilot" | "cursor"
    user_email: str
    tool_name: str
    event_type: str                                     # "message" | "completion" | "session"
    occurred_at: datetime
    cost_cents: Optional[int] = None                     # nullable on purpose — backfilled later
    tokens: Optional[int] = None
    raw_payload: str                                     # original JSON, for audit/debug
    ingested_at: datetime = Field(default_factory=datetime.utcnow)