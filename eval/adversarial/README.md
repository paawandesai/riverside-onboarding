# Adversarial cases

One file per untrusted channel that reaches a model or a parser:

| Channel | Reaches a model? | File | How it is checked |
|---|---|---|---|
| Patient chat message | Yes (Claude) | `chat_injection.json` | API result checked deterministically: valid intent enum, no booking/cancel claims, no URLs or images, distress still handled, no system-prompt leak |
| Prior chat turns sent by the browser | Yes (Claude) | `chat_injection.json` (inj-03 closes the data tag) | Patient text is wrapped as data and `<`/`>` are neutralized so it cannot close the tag |
| Text printed on an uploaded ID | No (Tesseract + regex only) | generated on the fly by `eval/run_eval.py` | Injected text is returned as a plain field value for the user to confirm and is never sent to a model |

Run with `make eval` (or `python eval/run_eval.py`). Results print as a scorecard and are written to `eval/results/latest.json`.
