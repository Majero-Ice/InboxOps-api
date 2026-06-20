# PRD Addendum — `not_an_invoice` status

Extends the existing invoice service. Adds a new outcome to distinguish "the PDF couldn't be recognized as an invoice at all" from "an invoice was extracted but needs human review."

## Problem

Currently, when a PDF that isn't really an invoice gets sent (e.g. the classifier misrouted it), the service extracts nothing usable — all critical fields are null/empty, `structural_ok` is false — but it still returns `status: "needs_review"`. This is wrong: there's nothing for a human to review (no data), and downstream n8n tries to insert an all-null row into the invoices table, which fails (e.g. `invalid input syntax for type date: "null"`).

## Change

Add a fourth status value: **`not_an_invoice`**.

### New status set
`ok | needs_review | not_an_invoice | extraction_failed`

### Decision logic (in the status-determination step, e.g. InvoiceService / ValidationService)

Apply this BEFORE the existing ok/needs_review logic:

```
if (extraction threw / unparseable after retries):
    -> "extraction_failed"

else if (no critical fields present):
    # "no critical fields" = ALL of these are missing/empty:
    #   - invoice_number is null or empty string
    #   - vendor is null or empty string
    #   - total is null or 0
    -> "not_an_invoice"

else if (!structural_ok) -> "needs_review"
else if (!arithmetic_ok) -> "needs_review"
else if (confidence < CONFIDENCE_THRESHOLD) -> "needs_review"
else if (multiple invoices detected) -> "needs_review"
else -> "ok"
```

Key point: `not_an_invoice` means the document doesn't look like an invoice at all (none of invoice_number / vendor / total could be extracted). `needs_review` is reserved for cases where real data WAS extracted but is uncertain (arithmetic mismatch, low confidence, missing one non-critical field). This ensures `needs_review` rows always have enough data to persist and to review.

### Response

Same response shape. For `not_an_invoice`:
- `status: "not_an_invoice"`
- `invoice` object may contain whatever little was extracted (likely mostly nulls) — that's fine, n8n won't persist it.
- `validation.issues` should explain why (e.g. "No invoice number, vendor, or total could be extracted — document does not appear to be an invoice").
- HTTP 200 (valid business outcome, like the others).

## Acceptance Criteria
1. A PDF with no extractable invoice_number, vendor, or total returns `status: "not_an_invoice"` (not `needs_review`).
2. A PDF with real data but a failed arithmetic check still returns `status: "needs_review"`.
3. A clean, consistent invoice still returns `status: "ok"`.
4. A corrupt/unparseable PDF still returns `status: "extraction_failed"`.
5. The status set is exactly: `ok | needs_review | not_an_invoice | extraction_failed`.

## Note on n8n side (not part of the service change)
After this ships, the n8n invoice branch must handle `not_an_invoice`: do NOT insert into the invoices table; instead log to `processing_log` (step `invoice_unrecognized`) and optionally notify Slack ("a PDF was flagged as an invoice but couldn't be recognized — possibly not an invoice"). The Switch on `status` gains a fourth branch.
