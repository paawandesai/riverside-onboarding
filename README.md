# Maple Grove onboarding assistant

> **Demo, synthetic data only.** Maple Grove Community Health is fictional. Do not enter real
> personal or health information. This demo is designed with HIPAA in mind but is **not**
> HIPAA compliant, and has not been audited.

A patient sign-up flow for a fictional community clinic. A new patient creates an account,
reads and accepts a consent notice, optionally photographs an ID card so the form fills itself,
confirms or corrects every field, chats with an AI assistant about why they want a visit, and
books an appointment. Supportive content appears when the flow detects distress, repeated
upload failures, low OCR confidence, a booking conflict or a long pause.

## Quick start (local)

Needs Docker, or Python 3.13 + Node 22 + Postgres 16 + Tesseract 5.

```bash
cp .env.example .env        # fill SESSION_SECRET, FIELD_ENCRYPTION_KEY, INVITE_CODES, POSTGRES_PASSWORD
docker compose up --build   # http://localhost:8000, sign up with one of your INVITE_CODES
```

Without Docker: `make setup db seed`, then `make api` and `make web` (http://localhost:5173).
`make test`, `make lint`, `make eval`, `make load INVITE_CODE=...`, `make licenses`.

`ANTHROPIC_RIVERSIDE_API_KEY` is optional. Without it the assistant runs on a rule-based
classifier and says so in the UI; the rest of the flow is unchanged.

Specimen ID images for trying the upload step are in `fixtures/generated-ids/` (see below).

## What it does

| Step | Behaviour |
|---|---|
| Sign-up | Invite code required, adult (18+) self-attestation, argon2 password hash, httpOnly signed session cookie. Every public account is `user` role. |
| Consent | Shown before any upload or question. States what is collected, that chat text goes to Anthropic and how long Anthropic keeps it, that staff review the summary, and how to withdraw. Nothing is stored before the consent click. |
| ID upload | JPEG/PNG/WEBP/HEIC up to 8 MB, magic-byte check, decompression-bomb guard, EXIF/GPS stripped. Tesseract reads name, DOB and address **on the server, in memory**. The image is never stored and never sent to any model. |
| Confirm | Every extracted field is shown for the user to confirm or edit; low-confidence and missing fields are highlighted. Manual entry always works, including when OCR is down. The source of each field (OCR confirmed, OCR edited, manual) is recorded. |
| Assistant | Claude classifies each message into one of five intents and extracts four visit fields with a strict JSON schema. The server validates the output, strips links, and replaces any claim to have booked or cancelled something. Distress keywords force the safety reply (988 / 911) regardless of the model. On timeout or error the rule-based fallback takes over. The AI disclosure is shown at the start. |
| Summary | A deterministic, non-binding summary for staff review. No diagnosis or triage. |
| Booking | Open slots by visit type; a partial unique index makes double-booking impossible even under concurrent requests (409 with a friendly message). Rebooking replaces the existing booking. |
| Privacy | Withdraw consent (purges intake data and bookings), delete data, or delete the account at any time. |

## What it does NOT do

- It does not diagnose, triage, give medical advice or decide care. Staff review everything.
- The assistant cannot book, cancel or change anything; only the scheduling API can.
- It does not store ID images or send them to any AI or vision model.
- It does not take payments, verify identity documents, or check insurance.
- It does not serve minors (adults only, by self-attestation; not verified).
- It is not HIPAA, GDPR or PCI compliant, has no BAA with any provider, and must not hold real data.
- It has no admin UI. Staff access is an audited API endpoint, and the public deployment has no staff account.
- It does not send emails or SMS.

## Stack and why

| Concern | Choice | Why |
|---|---|---|
| API | FastAPI, SQLAlchemy 2, Alembic, Postgres 16 | Typed request validation, simple async I/O for model calls, mainstream for Python ML/OCR work. |
| OCR | Tesseract 5 via pytesseract, Pillow preprocessing | Runs locally (no image leaves the server), Apache-2.0, no GPU. |
| Assistant | Claude API, structured outputs | Schema-constrained JSON is validated server-side; model id is configuration. |
| Frontend | React 19 + TypeScript + Vite | Small SPA served by the API container (one origin, no CORS in production). |
| Auth | Own (argon2 + signed httpOnly cookie) | Keeps identity data in our database; no third-party auth processor for a demo. Plays the role Supabase Auth would. |
| Tests | pytest (+ coverage gate), Jest + Testing Library, ESLint, ruff | The Python/TS equivalents of RSpec and RuboCop. |
| Deploy | Docker, Terraform, Azure Container Apps, Postgres Flexible Server, Key Vault | Matches Riverside's Azure / Terraform / Docker stack. See `infra/README.md`. |
| CI | GitLab CI | gitleaks, lint, tests with coverage gates, license audit, OCR eval, Terraform validate, image build. |

## Measured results

Measured on 2026-10-16 in a Linux x86_64 container with 4 CPUs and 15 GB RAM, Python 3.13,
Tesseract 5.3.4, Postgres 16 on the same machine. Re-run with `make eval` and `make load`.

**Tests.** Backend: 77 tests, 94% line coverage (gate 80%). Frontend: 14 tests, 88% lines (gate 80%).

**OCR field accuracy** (name, DOB, address; 3 fields x 30 images per set):

| Set | Accuracy | Clean | Phone photo | Skew/glare | Hard | p95 | Wrong value shown for review | Left blank |
|---|---|---|---|---|---|---|---|---|
| `generated-ids` (tuned against) | 91.1% | 100% | 93.3% | 90.5% | 55.6% | 1.49 s | 2 | 6 |
| `generated-ids-holdout` (not tuned) | **88.9%** | 96.7% | 90.0% | 100% | 33.3% | 1.33 s | 2 | 8 |

The parser was improved while looking at the first set, so the holdout number is the honest one,
and it is **below the 90% target**. Most misses are left blank for the user rather than filled wrongly.

**Load test** (k6, `k6/load.js`): 20 virtual users for 60 s on chat + slots + intake, with OCR
uploads and bookings running concurrently. 0% failed requests.

| Metric | p95 | Target |
|---|---|---|
| API requests, 20 VUs | 84 ms | < 3 s |
| Chat turn | 86 ms | < 3 s |
| OCR upload | 985 ms | < 8 s |
| Booking | 14.5 ms | < 1 s |

The chat number is the **rule-based fallback only**; no API key was available for this run, so
Claude latency has not been measured. The first run showed booking p95 at 1.78 s because the async
OCR handler blocked the event loop; OCR now runs in a thread pool (commit "Run upload validation
and OCR off the event loop").

**Intents** (`eval/intents.json`, 30 hand-written utterances, 6 per intent): rule-based fallback
30/30. That set was also used to tune the fallback rules, so treat it as a regression check, not
an accuracy estimate. Claude: **not measured yet** (needs the API key; `make eval` runs it when set).

**Adversarial** (`eval/adversarial/`): 7/7 prompt-injection cases pass on the fallback path.
Injected text printed on an ID image comes back as a plain field value for the user to confirm and is
never sent to a model. The Claude path for these cases has not been run yet.

## Known constraints

- OCR holdout accuracy is 88.9%, below the 90% target. The "hard" category (heavy blur, low
  contrast) is the weak spot. A stronger OCR model was not added: several common choices are on the
  project's banned list, and sending ID images to a vision model is not allowed here.
- Claude intent accuracy, Claude latency and Claude adversarial results are not measured yet.
- The ID test sets are generated, not provided (see below), so they are cleaner than real photos.
- The deployment uses a public Postgres endpoint restricted to Azure services (no VNet on the
  free account) and scales to zero, so the first request after idle is slow.
- Age is self-attested; nothing verifies it.

## Data sent to each provider

| Provider | What it receives | Personal fields | Retention |
|---|---|---|---|
| Anthropic (Claude API) | Chat messages about the visit (last 20 turns), system prompt | Free-text the user types, which may describe health concerns. Never name, DOB, address, email or the ID image. | Up to 30 days by default; up to 2 years for messages flagged by safety systems. Deleting data in the app does not delete Anthropic's copy. |
| Microsoft Azure (hosting) | Everything stored by the app | Name, DOB, address (field-encrypted), email (encrypted, plus HMAC for lookup), assessment answers, bookings | Demo data purged after 24 hours by a scheduled job, or immediately on withdrawal/deletion. Postgres backups 7 days. Logs 30 days and contain no personal data. |
| Tesseract (local) | ID image, in memory | Whatever is printed on the card | None; the image is discarded after the request. |

No analytics SDK is used. Funnel events go to a first-party table (step, timestamp, random session id).
A BAA is not needed for synthetic data; a real deployment would need BAAs with Anthropic and Microsoft first.

## API cost

The Claude API is paid per token. With the default `claude-haiku-5-5` ($0.10 per million input
tokens, $0.50 per million output, Anthropic pricing page on 2026-10-16), one chat turn is about
1,000 to 2,000 input tokens and under 200 output tokens, so roughly **$0.0002 to $0.0003 per turn** and about
**$0.001 to $0.002 per completed sign-up**. The worst case per turn (20 long turns, 1,024 output
tokens) is about $0.0011. These are estimates from prompt sizes, not measured usage.

The model is set with `ANTHROPIC_MODEL`. Haiku 5.5 was chosen for the < 3 s latency target; it is
active with retirement not before 2027-10-07. The app checks the model id against the Models API
at startup and fails fast if it is unavailable.

## Security and privacy notes

- Secrets reach the app only via environment variables (locally `.env`, in Azure Key Vault
  references). gitleaks and a staged-diff check run as pre-commit hooks and in CI.
- Identity fields and assessment answers are encrypted at rest with Fernet; emails are looked up by HMAC.
- Logs are JSON with an allow-list of fields: route templates, ids, outcomes, durations. Never
  bodies, user text, names, emails, DOB, addresses, images, auth headers or transcripts.
- `/api/health` reports configuration and last-success timestamps and never calls a model.
- Demo safeguards: invite code, persistent synthetic-data banner, `noindex` header and meta tag,
  scheduled purge, user-role-only demo account with rotation (`infra/README.md`).
- Untrusted text (chat, OCR output) is treated as data: delimited and neutralised in the prompt,
  model output is schema-validated and never executed, no HTML rendering of user or model text.

## Synthetic data

There were no sample ID images to work with, so `scripts/generate_specimen_ids.py` draws them:
`fixtures/generated-ids/` (seed 20261016) and `fixtures/generated-ids-holdout/` (seed 7), 30 cards
each in four categories, with `labels.json` ground truth. They are fictional "Maple Grove Community
Health" member cards with a SPECIMEN watermark, a silhouette face, no real seals and no barcodes.
No model was asked to produce them. `eval/intents.json` and the adversarial cases are hand-written.

## Repository map

```
backend/        FastAPI app, Alembic migrations, tests, seed/purge scripts
frontend/       React SPA and Jest tests
eval/           run_eval.py, intent set, adversarial cases
fixtures/       generated specimen ID images and labels
k6/             load test
infra/          Terraform and deploy script for Azure
scripts/        specimen generator, license audit, staged-secret check
LICENSES.md     third-party license audit
AI_USAGE.md     how AI tools were used to build this
```
