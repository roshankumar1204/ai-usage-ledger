import os
import tempfile

# app.db builds its engine at import time, so point it at a throwaway SQLite file before any test imports it
os.environ.setdefault("DATABASE_URL", f"sqlite:///{tempfile.mkdtemp()}/test.db")
