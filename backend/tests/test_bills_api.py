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


def test_ledger_metrics_only_show_own_team(client):
    h, other = headers(), headers()
    client.post("/bills/chatgpt/sample", headers=h)
    events = client.get("/metrics/events", headers=h).json()
    assert {e["user_email"] for e in events} == {"alice@company.com", "bob@company.com"}
    assert client.get("/metrics/events", headers=other).json() == []
    assert client.get("/metrics/active-users", headers=other).json()["active_users_this_week"] == 0
    assert client.get("/metrics/cost-by-tool", headers=other).json() == []
    assert client.get("/metrics/events").status_code == 422  # no team header, no data


def test_manual_compare_counts_toward_quota(client):
    h = headers()
    r = client.post("/compare/manual", headers=h, json={"plan_id": "cursor-teams", "seats": 10})
    assert r.status_code == 200
    comparison = r.json()["comparison"]
    assert comparison["current_monthly_cents"] == 10 * 4000
    assert comparison["recommendation"]["plan_id"] == "copilot-business"
    assert all(o["pricing"] == "seat" for o in comparison["options"])
    assert client.get("/team", headers=h).json()["remaining"] == 1


def test_manual_compare_uses_entered_spend_and_rejects_bad_input(client):
    h = headers()
    r = client.post("/compare/manual", headers=h,
                    json={"plan_id": "chatgpt-business", "seats": 4, "monthly_spend_cents": 8000})
    assert r.json()["comparison"]["current_monthly_cents"] == 8000
    assert client.post("/compare/manual", headers=h, json={"plan_id": "openai-api-luna", "seats": 4}).status_code == 400
    assert client.post("/compare/manual", headers=h, json={"plan_id": "cursor-teams", "seats": 0}).status_code == 422
    compare_id = r.json()["manual"]["id"]
    assert client.get(f"/compare/manual/{compare_id}", headers=headers()).status_code == 404


def test_switch_records_server_computed_savings(client):
    h = headers()
    mc = client.post("/compare/manual", headers=h, json={"plan_id": "cursor-teams", "seats": 10}).json()
    r = client.post("/switches", headers=h, json={"kind": "manual", "ref_id": mc["manual"]["id"], "plan_id": "copilot-business"})
    assert r.status_code == 200
    assert r.json()["team"]["monthly_savings_cents"] == 10 * (4000 - 1900)
    # Re-marking replaces rather than double-counting
    client.post("/switches", headers=h, json={"kind": "manual", "ref_id": mc["manual"]["id"], "plan_id": "copilot-business"})
    assert client.get("/team", headers=h).json()["switches"] == 1
    assert client.get(f"/compare/manual/{mc['manual']['id']}", headers=h).json()["switch"]["plan_id"] == "copilot-business"
    undone = client.delete(f"/switches/manual/{mc['manual']['id']}", headers=h).json()
    assert undone["team"]["monthly_savings_cents"] == 0


def test_switch_rejects_other_teams_and_unknown_plans(client):
    h = headers()
    bill_id = client.post("/bills/cursor/sample", headers=h).json()["bill"]["id"]
    body = {"kind": "bill", "ref_id": bill_id, "plan_id": "copilot-business"}
    assert client.post("/switches", headers=headers(), json=body).status_code == 404
    assert client.post("/switches", headers=h, json={**body, "plan_id": "claude-team-standard"}).status_code == 400
    assert client.post("/switches", headers=h, json=body).status_code == 200
