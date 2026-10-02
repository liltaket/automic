# Product
<!-- impeccable:product-schema 1 -->

## Platform
web

## Users
People in Google Meet meetings who want help noticing when they are invited to speak. Initial scope: Swedish and English. Developers need a reproducible simulator without a live meeting.

## Product Purpose
Read live captions, detect a turn explicitly directed at the configured participant, and either show an indication or unmute when enabled.

## Operating Context
Chrome Manifest V3, Google Meet captions enabled, local Ollaya with laya:multilingual. No audio recording and no automatic mute. Shadow mode is the default.

## Capabilities and Constraints
Name and aliases, cheap trigger filter, last four captions, three decisions, a minimum .97 auto threshold, cancellable notification, ephemeral debugging, simulator and evaluation cases. Meet DOM support requires live verification; synthetic tests do not establish compatibility with every Meet rollout. Model probabilities are not accuracy guarantees.

## Product Principles
False unmute is the costly error. Fail closed. Keep inference local. Never persist meeting transcripts by default.

## Open Decisions
Automic is the original preferred working name. The public repository is liltaket/automic. The name is also used by unrelated products; no uniqueness claim is made. Visual assumption: a light, compact operating interface with a prominent mic-state display, based on the attached brief and continued-work instruction.
