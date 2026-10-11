import os
from sqlmodel import create_engine, Session
from dotenv import load_dotenv

load_dotenv()


def _database_url() -> str:
    # SQLAlchemy 2.1 maps a bare postgresql:// URL to the psycopg (v3) driver; we ship psycopg2-binary
    url = os.getenv("DATABASE_URL", "")
    for prefix in ("postgresql://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql+psycopg2://" + url[len(prefix):]
    return url


engine = create_engine(_database_url(), echo=False)

def get_session():
    with Session(engine) as session:
        yield session
