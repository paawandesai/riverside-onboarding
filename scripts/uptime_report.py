"""Measured uptime of the live demo, from the scheduled `uptime` CI job's results.

Each scheduled pipeline (UPTIME_CHECK=1) runs one check of /api/health. This counts how many passed,
and compares the number of checks that ran with the number the 15-minute schedule should have run,
so missed runs (runner down, schedule paused) show up as unknown instead of disappearing.

    GITLAB_HOST=... GITLAB_REPO_PATH=... GITLAB_TOKEN=... python scripts/uptime_report.py [--since 2026-10-17]

The token needs read_api on the project; it is read from the environment and never printed.
"""

import argparse
import json
import os
import urllib.parse
import urllib.request
from datetime import UTC, datetime


def get(path: str, params: dict) -> list:
    base = f"https://{os.environ['GITLAB_HOST']}/api/v4/projects/{urllib.parse.quote(os.environ['GITLAB_REPO_PATH'], safe='')}"
    req = urllib.request.Request(f"{base}{path}?{urllib.parse.urlencode(params)}", headers={"PRIVATE-TOKEN": os.environ["GITLAB_TOKEN"]})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--since", help="ISO date; default: all scheduled checks")
    parser.add_argument("--every-minutes", type=int, default=15, help="the schedule's interval")
    args = parser.parse_args()
    counts = {"success": 0, "failed": 0}
    first = last = None
    page = 1
    while True:
        params = {"source": "schedule", "per_page": 100, "page": page}
        if args.since:
            params["updated_after"] = args.since
        pipelines = get("/pipelines", params)
        if not pipelines:
            break
        for p in pipelines:
            for job in get(f"/pipelines/{p['id']}/jobs", {"per_page": 100}):
                if job["name"] != "uptime":
                    continue
                counts[job["status"]] = counts.get(job["status"], 0) + 1
                if job["status"] in ("success", "failed"):
                    first = min(first or job["created_at"], job["created_at"])
                    last = max(last or job["created_at"], job["created_at"])
        page += 1
    total = counts["success"] + counts["failed"]
    if not total:
        print("no completed uptime checks yet")
        return
    print(f"{counts['success']}/{total} completed checks passed ({100 * counts['success'] / total:.2f}%) between {first} and {last}")
    start = datetime.fromisoformat(args.since).replace(tzinfo=UTC) if args.since else datetime.fromisoformat(first)
    expected = int((datetime.now(UTC) - start).total_seconds() // (args.every_minutes * 60))
    other = {k: v for k, v in counts.items() if k not in ("success", "failed") and v}
    print(f"expected about {expected} scheduled checks since {start:%Y-%m-%d %H:%M} UTC; {max(expected - total, 0)} unknown (missed, canceled or still running)")
    if other:
        print(f"not completed: {other}")


if __name__ == "__main__":
    main()
