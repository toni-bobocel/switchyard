# 4. An integer ledger on SQLite, for now

Date: 2026-11-24
Status: accepted

## Context

Finance needs spend per team and per feature, reconciled against vendor
invoices. Budgets need the current month's spend before each request.

## Decision

- Every request appends one row: team, feature, tier, model, tokens, cost,
  latency, status, redaction and fallback counts.
- Money is stored as integer micro-dollars. Prices are configured in USD
  per million tokens, which is numerically micro-dollars per token, so
  costing a request is one multiplication and a round.
- Storage is `node:sqlite` in WAL mode: no dependency, no server, and
  reads for budget checks hit an index on `(team, month)`.

## Consequences

- One gateway instance owns one ledger. Running several replicas means
  moving the ledger to Postgres (same schema) or emitting rows to a queue
  that feeds ClickHouse or the warehouse. The `Ledger` class is the only
  code that changes.
- Budget enforcement is soft at the edges: concurrent requests from one
  team can overshoot by the cost of the requests in flight. Pre-reserving
  an estimate per request fixes it, at the price of a write per request.
- Streams without vendor usage data are costed from a character estimate
  and flagged `estimated` so finance can tell them apart.
