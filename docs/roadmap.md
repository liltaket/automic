# Roadmap

## v0.1 implementation

Google Meet adapter, short caption context, participant aliases, cheap lexical gate, local Laya integration, shadow/notify/guarded auto modes, cancellable notification, ephemeral diagnostic logs, rules simulator, evaluation and CI.

## Acceptance still needed

Current live Meet adapter verification and real microphone-state confirmation. A specialized, calibrated turn model with useful recall at a low false-unmute rate. The default base Laya checkpoint did not reach the 0.97 auto threshold on the synthetic positive examples tested; auto mode is therefore an experimental action path, not a demonstrated reliable assistant.

## Next

Opt-in feedback and representative Swedish/English labeled examples. Benchmark the entire candidate gate and action policy, separating top-label accuracy from actions taken. Only after model acceptance: package distribution and consider Teams/Zoom adapters. Local audio transcription and bundled inference are later projects.
