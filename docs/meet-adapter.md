# Meet adapter

The adapter uses accessible microphone and leave-call controls instead of hashed CSS classes. Supported microphone labels are English and Swedish. It returns an unknown state when controls are missing, ambiguous, disabled or unsupported.

Captions use known Meet caption data attributes and live regions, with bounded speaker/text extraction and mutation debouncing. Caption IDs track revisions. No entire-page transcript scraping is used. Existing captions at startup must not cause automatic action.

Google does not publish a stable captions DOM contract. Fixture tests establish behavior on the supported markup; they are not evidence of live Google Meet compatibility. Before enabling auto mode, verify:

1. Join a test meeting, enable captions and keep shadow mode selected.
2. Ask another participant to say a direct question and a third-person mention.
3. Confirm that the caption and speaker appear once, revisions replace the current line, and direct questions reach the classifier.
4. Confirm microphone status while manually muted and unmuted.
5. Verify notification cancellation in a consenting test meeting before enabling microphone control in an ordinary call.

If captions are not detected, enable debug mode, inspect the accessible caption region and adapt the selectors with an anonymized DOM fixture. Do not export real meeting transcripts into public issues.
