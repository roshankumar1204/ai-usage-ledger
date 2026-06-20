import json
import pytest
from pathlib import Path
from app.parsers import chatgpt_enterprise, copilot_export, cursor_jsonl

FIXTURES_DIR = Path(__file__).parent / "fixtures"

PARSER_MAP = {
    "chatgpt": (chatgpt_enterprise.parse, "sample.json"),
    "copilot": (copilot_export.parse, "sample.csv"),
    "cursor": (cursor_jsonl.parse, "sample.jsonl"),
}

@pytest.mark.parametrize("source", PARSER_MAP.keys())
def test_parser_replay_against_fixture(source):
    parse_fn, filename = PARSER_MAP[source]
    raw_text = (FIXTURES_DIR / source / filename).read_text()

    events = parse_fn(raw_text)

    # Structural guarantees that must NEVER break, no matter which vendor changes
    for ev in events:
        assert ev["dedup_key"], "every event must have a dedup key"
        assert ev["user_email"], "every event must resolve to a user"
        assert ev["source"] == source
        assert ev["occurred_at"] is not None
        # cost_cents can be None (late billing) but must not be a string/garbage
        assert ev["cost_cents"] is None or isinstance(ev["cost_cents"], int)
        assert isinstance(ev["tokens"], int)

@pytest.mark.parametrize("source", PARSER_MAP.keys())
def test_parser_output_snapshot(source, tmp_path):
    """Catches SILENT drift: if output shape/values change unexpectedly, this fails."""
    parse_fn, filename = PARSER_MAP[source]
    raw_text = (FIXTURES_DIR / source / filename).read_text()
    events = parse_fn(raw_text)

    snapshot_path = FIXTURES_DIR / source / "expected_output.json"

    if not snapshot_path.exists():
        # first run: write the snapshot (commit this to git as the "known good" baseline)
        snapshot_path.write_text(json.dumps(events, default=str, indent=2))
        pytest.skip("snapshot created, re-run to verify")

    expected = json.loads(snapshot_path.read_text())
    actual = json.loads(json.dumps(events, default=str))
    assert actual == expected, f"Parser output for '{source}' changed unexpectedly — possible regression"