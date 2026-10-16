"""Store one secret in Key Vault from an environment variable, without Terraform or the CLI.

    python3 infra/set_secret.py --vault <key-vault-name> --name anthropic-api-key --from-env ANTHROPIC_RIVERSIDE_API_KEY

Authenticates as the deploy service principal (ARM_CLIENT_ID / ARM_CLIENT_SECRET / ARM_TENANT_ID).
The value is read from the environment and sent in a request body, so it never appears in
command-line arguments, Terraform state or logs. Prints the secret name only.
"""

import argparse
import json
import os
import sys
import urllib.parse
import urllib.request


def _token() -> str:
    body = urllib.parse.urlencode(
        {
            "grant_type": "client_credentials",
            "client_id": os.environ["ARM_CLIENT_ID"],
            "client_secret": os.environ["ARM_CLIENT_SECRET"],
            "scope": "https://vault.azure.net/.default",
        }
    ).encode()
    url = f"https://login.microsoftonline.com/{os.environ['ARM_TENANT_ID']}/oauth2/v2.0/token"
    with urllib.request.urlopen(urllib.request.Request(url, data=body, method="POST"), timeout=30) as resp:  # noqa: S310 (fixed https URL)
        return json.load(resp)["access_token"]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--vault", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--from-env", required=True, help="name of the environment variable holding the value")
    args = parser.parse_args()

    value = os.environ.get(args.from_env, "")
    if not value:
        print(f"{args.from_env} is not set; nothing stored.", file=sys.stderr)
        return 1
    url = f"https://{args.vault}.vault.azure.net/secrets/{urllib.parse.quote(args.name)}?api-version=7.4"
    req = urllib.request.Request(
        url,
        data=json.dumps({"value": value}).encode(),
        method="PUT",
        headers={"Authorization": f"Bearer {_token()}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30):  # noqa: S310 (fixed https URL)
            pass
    except urllib.error.HTTPError as exc:
        # Status only: the response body could echo request details.
        print(f"Key Vault returned HTTP {exc.code} for secret '{args.name}'.", file=sys.stderr)
        return 1
    print(f"stored secret '{args.name}' in {args.vault}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
