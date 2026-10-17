"""Measured uptime of the live demo, from the scheduled `uptime` CI job's results.

Each scheduled pipeline (UPTIME_CHECK=1) runs one check of /api/health. This counts how many passed.

    GITLAB_HOST=... GITLAB_REPO_PATH=... GITLAB_TOKEN=... python scripts/uptime_report.py [--since 2026-10-17]

The token needs read_api on the project; it is read from the environment and never printed.
"""

import argparse
import json
import os
import urllib.parse
import urllib.request


def get(path: str, params: dict) -> list:
    base = f"https://{os.environ['GITLAB_HOST']}/api/v4/projects/{urllib.parse.quote(os.environ['GITLAB_REPO_PATH'], safe='')}"
    req = urllib.request.Request(f"{base}{path}?{urllib.parse.urlencode(params)}", headers={"PRIVATE-TOKEN": os.environ["GITLAB_TOKEN"]})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--since", help="ISO date; default: all scheduled checks")
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
                if job["name"] == "uptime" and job["status"] in counts:
                    counts[job["status"]] += 1
                    first = min(first or job["created_at"], job["created_at"])
                    last = max(last or job["created_at"], job["created_at"])
        page += 1
    total = sum(counts.values())
    if not total:
        print("no completed uptime checks yet")
        return
    print(f"{counts['success']}/{total} checks passed ({100 * counts['success'] / total:.2f}%) between {first} and {last}")


if __name__ == "__main__":
    main()
