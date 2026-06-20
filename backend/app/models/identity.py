from sqlmodel import SQLModel, Field
from typing import Optional
from datetime import datetime

class Identity(SQLModel, table=True):
    """A resolved human. Created only when we have a proof-backed anchor (email)."""
    id: Optional[int] = Field(default=None, primary_key=True)
    primary_email: str = Field(index=True, unique=True)
    display_name: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)


class IdentityEdge(SQLModel, table=True):
    """
    A proven link between a raw identifier seen in an event and an Identity.
    'proof_type' records WHY we believe this link — never silent inference.
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    identity_id: int = Field(foreign_key="identity.id")
    raw_identifier: str = Field(index=True)          # e.g. the email string from the event
    proof_type: str                                   # "exact_email_match" | "sso_verified" | etc
    source: str                                        # which vendor this identifier came from
    created_at: datetime = Field(default_factory=datetime.utcnow)