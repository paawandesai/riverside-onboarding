"""Write the API's OpenAPI schema for frontend type generation.

    python -m scripts.export_openapi ../frontend/src/api/openapi.json

The frontend generates src/api/schema.d.ts from it (npm run gen:api); CI fails if either is stale.
"""

import json
import os
import sys

# Importing the app needs settings; placeholder values are fine because nothing connects or signs.
for key in ("SESSION_SECRET", "FIELD_ENCRYPTION_KEY", "DATABASE_URL"):
    os.environ.setdefault(key, "export-only")

from app.main import app  # noqa: E402

if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "../frontend/src/api/openapi.json"
    with open(out, "w") as fh:
        json.dump(app.openapi(), fh, indent=2, sort_keys=True)
        fh.write("\n")
    print(f"wrote {out}")
