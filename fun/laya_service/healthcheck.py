"""Quick healthcheck CLI utility for Laya Decision Service."""
import json
import sys
import urllib.request

DEFAULT_URL = "http://127.0.0.1:20129/health"

def check(url=DEFAULT_URL):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "LayaHealthcheck/1.0"})
        with urllib.request.urlopen(req, timeout=3.0) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            if data.get("status") == "ok" and data.get("model_loaded") is True:
                print(f"[OK] Laya service healthy: {data}")
                return 0
            else:
                print(f"[WARN] Laya service running but degraded: {data}")
                return 2
    except Exception as exc:
        print(f"[FAIL] Laya service unreachable at {url}: {exc}")
        return 1

if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_URL
    sys.exit(check(target))
