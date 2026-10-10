from datetime import datetime, timezone
from typing import Optional

from sqlmodel import Field, SQLModel


class Team(SQLModel, table=True):
    id: str = Field(primary_key=True, max_length=64)   # random id the browser generates; no auth in Phase 1
    plan: str = "free"                                  # "free" | "paid"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class Bill(SQLModel, table=True):
    """One uploaded export. Its events live in AIUsageEvent, linked through BillEvent."""
    id: Optional[int] = Field(default=None, primary_key=True)
    team_id: str = Field(index=True, foreign_key="team.id")
    source: str
    filename: str
    is_sample: bool = False                             # sample bills don't use up the free quota
    event_count: int = 0
    uploaded_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class BillEvent(SQLModel, table=True):
    bill_id: int = Field(primary_key=True, foreign_key="bill.id")
    dedup_key: str = Field(primary_key=True)


class ManualCompare(SQLModel, table=True):
    """A compare without an export: the plan the team says it's on. Counts toward the free quota like a bill."""
    id: Optional[int] = Field(default=None, primary_key=True)
    team_id: str = Field(index=True, foreign_key="team.id")
    plan_id: str
    seats: int
    monthly_spend_cents: Optional[int] = None          # what they say they pay; None = use list price
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class SwitchDecision(SQLModel, table=True):
    """A team marked a recommendation as acted on. One per analysis; marking again replaces it."""
    id: Optional[int] = Field(default=None, primary_key=True)
    team_id: str = Field(index=True, foreign_key="team.id")
    kind: str                                           # "bill" | "manual"
    ref_id: int                                         # Bill.id or ManualCompare.id
    plan_id: str
    from_monthly_cents: int
    to_monthly_cents: int
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
