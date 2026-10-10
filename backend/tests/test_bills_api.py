import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c


def headers():
    return {"X-Team-Id": str(uuid.uuid4())}


def upload(client, h, source, path):
    return client.post(f"/bills/{source}", headers=h, files={"file": (path.name, path.read_bytes())})


def test_first_two_analyses_are_free_then_402(client):
    h = headers()
    assert client.get("/team", headers=h).json()["remaining"] == 2
    assert upload(client, h, "chatgpt", FIXTURES / "chatgpt" / "sample.json").status_code == 200
    assert upload(client, h, "cursor", FIXTURES / "cursor" / "sample.jsonl").status_code == 200
    blocked = upload(client, h, "copilot", FIXTURES / "copilot" / "sample.csv")
    assert blocked.status_code == 402
    assert blocked.json()["detail"]["code"] == "free_limit_reached"


def test_samples_do_not_use_quota(client):
    h = headers()
    r = client.post("/bills/chatgpt/sample", headers=h)
    assert r.status_code == 200
    assert r.json()["comparison"]["options"]
    assert client.get("/team", headers=h).json()["remaining"] == 2


def test_report_shows_overlap_across_bills(client):
    h = headers()
    client.post("/bills/chatgpt/sample", headers=h)
    cursor = client.post("/bills/cursor/sample", headers=h).json()
    # alice and bob appear on both the ChatGPT and Cursor sample bills
    assert set(cursor["report"]["overlap"]) == {"alice@company.com", "bob@company.com"}


def test_bills_are_private_to_their_team(client):
    h = headers()
    bill_id = client.post("/bills/chatgpt/sample", headers=h).json()["bill"]["id"]
    assert client.get(f"/bills/{bill_id}", headers=h).status_code == 200
    assert client.get(f"/bills/{bill_id}", headers=headers()).status_code == 404
    assert [b["id"] for b in client.get("/bills", headers=h).json()] == [bill_id]


def test_bad_file_and_bad_team_id(client):
    h = headers()
    bad = client.post("/bills/chatgpt", headers=h, files={"file": ("x.json", b"not json")})
    assert bad.status_code == 400
    assert client.get("/team", headers=h).json()["remaining"] == 2
    assert client.get("/team", headers={"X-Team-Id": "../.."}).status_code == 400
