# 1. One OpenAI-compatible surface

Date: 2026-11-24
Status: accepted

## Context

Teams already call LLMs through whatever SDK they picked first. A gateway
that asks them to rewrite that code will not be adopted; a gateway that is
optional will be bypassed the first time someone is in a hurry.

The OpenAI chat completions shape is the closest thing the industry has to
a lingua franca: Mistral, Ollama, vLLM, LiteLLM, Groq and most SDKs speak it
natively.

## Decision

Switchyard exposes `POST /v1/chat/completions` in that shape. Adopting it is
a base URL and an API key change. `model` accepts a concrete model name, a
tier (`fast`, `balanced`, `reasoning`), or `auto`.

Vendor dialects are translated at the edge, in adapters. Clients never see
Anthropic's event names or stop reasons.

## Consequences

- Leaving a vendor is a config change, not a migration.
- Features that only one vendor has (tool use, vision, prompt caching) are
  not exposed yet. Each one needs a deliberate decision about what happens
  when the request falls back to a vendor without it.
- Responses carry `x-switchyard-*` headers (model, tier, cost, redactions,
  fallbacks) so callers can see the routing without a dashboard.
