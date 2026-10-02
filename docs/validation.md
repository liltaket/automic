# Validation

This file distinguishes software tests, model evidence and live meeting acceptance. Test fixtures cannot prove compatibility with the current Google Meet DOM.

## Evidence collected

Validation is in progress. Final command results are recorded here after integration.

## Model evidence

The actual Ollaya 0.8.0 runtime and laya:multilingual checkpoint were downloaded into an ignored project-local directory and executed on CPU. Runtime archive SHA-256 matched the publisher's checksum. Three final direct-question/handoff probes produced UNMUTE probabilities of approximately 0.41–0.49; the base model does not establish useful automatic-unmute recall at the conservative 0.97 threshold.

No probabilities were inflated and no lower threshold was used to make the demo pass. Rules demonstrations and mocked policy tests must not be described as measured Laya performance. Model scores need task-specific evaluation/calibration before ordinary automatic-microphone use.

## Pending acceptance

- Current Google Meet DOM and captions with this account/rollout.
- Real microphone state and cancellation in a consenting test meeting.
- Representative model recall and false-unmute rate on real caption distributions.
- Chrome Web Store packaging/review and distribution (not part of this unpacked extension MVP).

The small synthetic raw probe set is available in [model-probes.json](model-probes.json). These rows came through the full candidate gate; non-candidate rows used rules and are explicitly labeled with source `rules`. All three positive probes stayed below the 0.97 action threshold (0/3 eligible automatic actions). This is a development probe, not a population accuracy estimate.

The [12-case pipeline evaluation](model-evaluation.json) produced 11/12 matching top-label decisions (four positive examples), including one generic second-person false UNMUTE label. The separate deterministic action gate blocks generic unnamed captions. At the 0.97 probability floor, automatic-action recall was 0/4 and false automatic actions were 0/8. This tiny synthetic suite does not establish useful real-meeting performance.

## Software checks

- TypeScript check and production bundle build passed.
- 35 unit/policy/DOM fixture tests passed.
- 8 Playwright tests passed, including a packaged Manifest V3 extension in Chromium against a synthetic Meet page. Auto-action cases used explicitly mocked model responses, not a real meeting or physical microphone.
- The delayed-inference regression proves that a newer negative caption cancels an earlier invitation before a fixture mic click.
- 12/12 rules regression cases matched their curated labels; no representative-dataset claim.
- `npm audit` reported zero known dependency vulnerabilities at validation time.
- Desktop/mobile screenshots were reviewed; all four identified usability issues were resolved. Independent code-review findings were resolved by concurrent caption delivery and explicit in-memory retention disclosure.

## Repository state

The public `liltaket/automic` repository was created as requested. Source publication is pending explicit push permission under Bruno's supplied AGENTS.md external-Git boundary. Local tests do not establish GitHub CI success; CI will run after an authorized push.

A separate packaged-extension probe used the real local Ollaya/Laya runtime through the actual service worker on a synthetic Meet page, in shadow mode. It displayed `UNMUTE · 45% · 101 ms · shadow` after warm-up, and the fixture microphone remained muted. This verifies the local extension-to-model transport and display, not model quality, live Meet compatibility or physical microphone behavior. The local runtime was configured with the exact extension origin; unapproved origins returned HTTP 403.
