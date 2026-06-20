import json

def flatten_keys(obj, prefix="") -> set[str]:
    """Get all key-paths in a nested structure, e.g. 'usage.total_tokens'"""
    keys = set()
    if isinstance(obj, dict):
        for k, v in obj.items():
            path = f"{prefix}.{k}" if prefix else k
            keys.add(path)
            keys |= flatten_keys(v, path)
    elif isinstance(obj, list) and obj:
        keys |= flatten_keys(obj[0], prefix)
    return keys

# In-memory baseline for the demo (would be a DB table in production)
BASELINES: dict[str, set[str]] = {}

def check_drift(source: str, sample_record: dict) -> dict:
    current_keys = flatten_keys(sample_record)

    if source not in BASELINES:
        BASELINES[source] = current_keys
        return {"status": "baseline_set", "keys": list(current_keys)}

    baseline = BASELINES[source]
    missing = baseline - current_keys
    new = current_keys - baseline

    if missing:
        return {"status": "DRIFT_DETECTED", "missing_keys": list(missing), "new_keys": list(new)}
    return {"status": "ok", "new_keys": list(new)}