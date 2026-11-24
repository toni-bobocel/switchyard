# 3. Route by heuristics, not by a classifier model

Date: 2026-11-24
Status: accepted

## Context

Most enterprise LLM traffic is triage: classify, extract, translate,
summarise. A frontier model costs one to two orders of magnitude more per token than a
small one for those tasks, with no measurable gain. A smaller share is
real reasoning, where the small model is a false economy.

The obvious design is to ask a small LLM which tier a prompt needs. It
adds a round trip and a bill to every request to save money on some of
them, and its decisions cannot be explained.

## Decision

`classify()` scores free signals: context length, reasoning cues, triage
cues, code or stack traces, conversation depth, requested answer length.
The score maps to `fast`, `balanced` or `reasoning`. Every point is listed
in the `x-switchyard-route` response header.

Callers who know better pass a tier or a model name, and win.

## Consequences

- Zero added latency, deterministic, trivially testable.
- Misroutes happen. The ledger records tier and model per feature, which
  is the data needed to tune thresholds, or to justify replacing this with
  a learned router later. That replacement would run in shadow mode first,
  logging its choice next to this one.
- The cue lists are English and French. Other languages fall back to
  length and structure signals.
