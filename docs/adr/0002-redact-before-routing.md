# 2. Redact personal data before routing, restore it after

Date: 2026-11-24
Status: accepted

## Context

Prompts carry customer emails, phone numbers, IBANs and social security
numbers because the work is about customers. Sending them to a US vendor
is a GDPR transfer; logging them is a retention problem. Asking every team
to scrub their own prompts does not survive the first deadline.

Blanking values (`[REDACTED]`) breaks the task: "reply to the customer"
cannot be answered without a customer.

## Decision

- Detection runs in the gateway, on every message, before a model is
  chosen. Nothing downstream, logs included, sees the original values.
- Values are replaced with stable tokens (`⟦EMAIL_1⟧`). The same value gets
  the same token within a request, so the model still knows that two
  mentions are the same person. The answer is rehydrated before it is
  returned, including when a token is split across streamed chunks.
- Structured identifiers are only flagged when their checksum holds (Luhn,
  IBAN mod 97, NIR key). False positives on order numbers erode trust in
  the feature faster than misses do.
- Policy is per team: `redact`, `block` (refuse with 422), or `off`.

## Consequences

- Names and free-text addresses are not detected. That needs an NER model,
  which belongs in a separate service with its own latency budget; the
  `Vault` interface does not change when it arrives.
- The token map lives in memory for one request and is never persisted.
- A model that paraphrases a token (`EMAIL 1` instead of `⟦EMAIL_1⟧`) leaves
  it unresolved. In practice current models copy them verbatim.
