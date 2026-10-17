# AI usage

## How AI was used to build this

The repository was written with Claude Code, Anthropic's coding agent, working from a written
brief and guardrails supplied by the author. The exact model and version for each change are
recorded in that commit's `Co-Authored-By` trailer. Every commit in the history is real; nothing
was squashed or rewritten.

Claude Code wrote the code, tests, eval harness, Terraform and documentation, ran the test suites,
evals, load test, license audit and secret scans, and reported the measured numbers in the README
from those runs. The author chose the stack, the domain (healthcare intake) and the hosting
(Azure), and set the compliance guardrails the agent followed.

## AI inside the product

| Where | Model | What it does | Guardrails |
|---|---|---|---|
| Assistant chat | Claude via the Claude API, model from `ANTHROPIC_MODEL` (default `claude-haiku-5-5`) | Classifies intent, extracts four visit fields, writes a short reply | Strict JSON schema, server-side validation, link stripping, no booking claims, fixed reschedule reply, server-signed history, email and phone removal, one-way distress override, rule-based fallback, AI disclosure shown to the user |

No other model is used. OCR is Tesseract (not a generative model). The staff summary is a template,
not model output. No ID image is sent to any model.

## Artifacts generated with AI and not yet independently verified

These were produced by the coding agent. They pass the automated checks listed, but no human
domain expert has reviewed them.

| Artifact | Automated check | Still needs |
|---|---|---|
| Consent text (`backend/app/services/privacy.py`) | Tests assert it is shown before upload and mentions retention | Legal / privacy review |
| Supportive content and crisis wording (`backend/app/content/support.json`, `SAFETY_REPLY` in `chat.py`), now worded after the UI design spec | Tests for triggers and distress override | Clinical review of wording and resources |
| UI design spec and screen copy (`frontend/src/i18n/en.json`), also drafted by an AI design session | Unit, end-to-end and axe accessibility tests | Review by the author and by patients or a plain-language reviewer |
| Assistant system prompt and output schema (`backend/app/services/llm.py`) | Claude path of `make eval` (2026-10-17): 30/30 and 40/40 intents, 5/5 scripted conversations, 10/10 injection cases | Review by someone other than its author, and cases written by real patients |
| Intent test sets (`eval/intents.json`, `eval/intents-holdout.json`), scripted conversations (`eval/conversations.json`) and injection cases (`eval/adversarial/`) | Used by the eval harness | Review for coverage and realism |
| Specimen ID generator (`scripts/generate_specimen_ids.py`) and its images in `fixtures/generated-*` | Labels checked by the OCR eval | Comparison against real photo conditions |
| Rule-based fallback classifier and crisis-language pattern (`backend/app/services/chat.py`) | 30/30 and 38/40 on sets it was tuned against; 8/8 crisis messages, no false alarms on the other 62 | Accuracy on unseen phrasing |
| Terraform (`infra/terraform`) | `terraform validate`, and applied to the demo subscription with `infra/deploy.sh` | Review by someone who runs Azure in production (network isolation, Key Vault hardening) |
| Security fixes from the final audit (rate limits, sessions, upload limits, database role, CSP nonce) | Backend and end-to-end tests for each | An independent security review |
| HEIC test sample (`fixtures/generated-heic-sample.heic`) | Decoded by the upload test | Nothing further: it only checks that HEIC decodes |
