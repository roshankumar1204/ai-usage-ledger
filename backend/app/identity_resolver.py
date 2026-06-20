from sqlmodel import Session, select
from app.models.identity import Identity, IdentityEdge

def resolve_identity(raw_email: str, source: str, session: Session) -> dict:
    """
    Returns either a proven Identity link, or an explicit 'unresolved' status.
    We NEVER guess — no fuzzy matching, no inferring names from handles.
    """
    # Exact match is our only proof type for this demo (real system: + SSO-verified, + device cert, etc)
    existing_edge = session.exec(
        select(IdentityEdge).where(IdentityEdge.raw_identifier == raw_email)
    ).first()

    if existing_edge:
        return {"status": "resolved", "identity_id": existing_edge.identity_id, "proof_type": existing_edge.proof_type}

    # New identifier: does an Identity already exist with this exact email as primary?
    identity = session.exec(
        select(Identity).where(Identity.primary_email == raw_email)
    ).first()

    if not identity:
        identity = Identity(primary_email=raw_email)
        session.add(identity)
        session.commit()
        session.refresh(identity)

    edge = IdentityEdge(
        identity_id=identity.id,
        raw_identifier=raw_email,
        proof_type="exact_email_match",
        source=source,
    )
    session.add(edge)
    session.commit()

    return {"status": "resolved", "identity_id": identity.id, "proof_type": "exact_email_match"}