# PRD — Invoice Processing Microservice (NestJS)

## 1. Overview

A stateless NestJS microservice that extracts structured data from invoice PDFs using Claude. It is part of a larger automated inbound-message pipeline for **Lumen Studio** (a fictional digital agency), orchestrated by n8n.

**Role in the system:** n8n owns the workflow and the database. This service is a pure on-demand processor — it receives a PDF, extracts and validates invoice data, and returns a structured result. It does **not** write to any database, does **not** deduplicate, and does **not** know about the broader process. Deduplication and persistence happen in n8n after this service responds.

**Core responsibility:** `PDF in → structured, validated invoice JSON out`.

---

## 2. Goals & Non-Goals

### Goals (this version)
- Accept a PDF (sent by n8n as base64 in the request body).
- Detect whether the PDF has an extractable text layer or is a scan/image.
- Extract invoice data via Claude:
  - Text PDFs → Claude Haiku (cheap, text input).
  - Scanned/image PDFs → Claude Sonnet via vision (render pages to images).
- Validate the extracted data: structural (DTO), arithmetic (line items sum to total), and a confidence score.
- Return a structured response with a `status` that n8n uses to branch.
- Protect the endpoint with a simple API key guard.
- Be deployable on Coolify and reachable by n8n over the internal Docker network.

### Non-Goals (deferred / out of scope for this version)
- **No deduplication** — n8n handles dedup by invoice number against the database.
- **No database access** — the service is stateless.
- **No enrichment/scraping** — `EnrichmentModule` is scaffolded structurally only (see §9), not implemented.
- No handling of non-PDF formats.
- No OCR engine (Tesseract etc.) — scanned PDFs go through Claude vision instead.
- No advanced multi-invoice-per-PDF handling (flag as needs_review if detected; see §8).

---

## 3. Tech Stack

- **Framework:** NestJS (latest stable), TypeScript.
- **LLM:** Anthropic API via the official `@anthropic-ai/sdk`.
  - Text extraction model: Claude Haiku (configurable via env).
  - Vision extraction model: Claude Sonnet (configurable via env).
- **PDF text extraction & text-layer detection:** `pdf-parse` (or `pdfjs-dist` if more control over per-page text is needed).
- **PDF page → image rendering (for vision):** `pdf2pic` or `pdf-to-img` (renders pages to PNG buffers). Choose whichever installs cleanly in the Docker image; document the choice.
- **Validation:** `class-validator` + `class-transformer` with DTOs; plus custom arithmetic validation logic.
- **Config:** `@nestjs/config` for environment variables.

---

## 4. API Contract

### Endpoint
`POST /invoices/process`

**Auth:** Requires header `x-api-key: <SERVICE_API_KEY>`. Requests without a valid key get `401 Unauthorized`. Implemented as a NestJS Guard applied to the controller.

### Request body
```json
{
  "file": "<base64-encoded PDF bytes>",
  "filename": "invoice-123.pdf",
  "source_message_id": "optional string for traceability/logging only"
}
```
- `file` (required): base64 string of the PDF.
- `filename` (optional): original filename, used for logging.
- `source_message_id` (optional): the Gmail/message id, **for logging/tracing only** — the service does not use it for dedup or persistence.

Validate the request body with a DTO. Reject oversized payloads (configurable max, e.g. 15 MB decoded) with `413`.

### Response body
```json
{
  "status": "ok | needs_review | extraction_failed",
  "pdf_type": "text | scanned | unknown",
  "confidence": 0.0,
  "invoice": {
    "invoice_number": "string | null",
    "vendor": "string | null",
    "issue_date": "YYYY-MM-DD | null",
    "due_date": "YYYY-MM-DD | null",
    "currency": "string | null",
    "line_items": [
      { "description": "string", "quantity": 0, "unit_price": 0, "amount": 0 }
    ],
    "subtotal": 0,
    "tax": 0,
    "total": 0
  },
  "validation": {
    "structural_ok": true,
    "arithmetic_ok": true,
    "arithmetic_detail": "string | null",
    "issues": ["string"]
  },
  "meta": {
    "model_used": "string",
    "processing_ms": 0
  }
}
```

### `status` semantics (this is what n8n branches on)
- **`ok`** — extraction succeeded, structural validation passed, arithmetic check passed, and confidence ≥ threshold. n8n may auto-persist.
- **`needs_review`** — extraction succeeded but at least one of: confidence below threshold, arithmetic mismatch, missing critical field, or a suspected multi-invoice PDF. n8n routes to human review (Slack).
- **`extraction_failed`** — could not parse the PDF or Claude returned unusable output after retries. n8n routes to error handling.

The HTTP status code should be `200` for all three `status` values (they are valid business outcomes, not transport errors). Reserve non-2xx codes for actual request/transport failures (`401`, `413`, `400` malformed body, `500` unexpected).

---

## 5. Module Structure

```
src/
  app.module.ts
  main.ts
  common/
    guards/api-key.guard.ts        # validates x-api-key header
    config/                        # env config schema
  invoice/
    invoice.module.ts
    invoice.controller.ts          # POST /invoices/process
    invoice.service.ts             # ORCHESTRATOR — drives the steps
    dto/
      process-invoice.dto.ts       # request body validation
      invoice-result.dto.ts        # response shape
      extracted-invoice.dto.ts     # the invoice object (class-validator rules)
  pdf/
    pdf.module.ts
    pdf.service.ts                 # text-layer detection, text extraction, page->image rendering
  claude/
    claude.module.ts
    claude.service.ts              # wraps Anthropic SDK; extractFromText() & extractFromImages()
    prompts/                       # system prompts for extraction
  validation/
    validation.module.ts
    validation.service.ts          # structural + arithmetic + confidence checks
  enrichment/                      # FUTURE — scaffold only, do NOT implement (see §9)
    enrichment.module.ts           # empty module placeholder
```

### Responsibilities

**InvoiceModule (orchestrator)**
- `invoice.controller.ts`: exposes `POST /invoices/process`, applies the API key guard, validates the request DTO, calls `invoice.service`.
- `invoice.service.ts`: orchestrates the pipeline (no heavy logic itself):
  1. Decode base64 → buffer.
  2. Ask `PdfService` to classify the PDF (text vs scanned).
  3. Branch: text path → `ClaudeService.extractFromText()`; scanned path → render pages to images → `ClaudeService.extractFromImages()`.
  4. Pass extracted data to `ValidationService`.
  5. Assemble the final response with the correct `status`.
  6. Wrap everything in try/catch → on failure return `extraction_failed` with details.

**PdfModule**
- `detectType(buffer): 'text' | 'scanned'` — extract text; if the extracted text length exceeds a configurable threshold (e.g. `PDF_TEXT_MIN_CHARS`, default 100), classify as `text`; otherwise `scanned`.
- `extractText(buffer): string`.
- `renderPagesToImages(buffer): Buffer[]` — render each page to PNG for vision. Cap the number of pages sent to vision (configurable `PDF_MAX_VISION_PAGES`, default e.g. 5) to control cost/latency.

**ClaudeModule**
- `extractFromText(text): RawExtraction` — calls Haiku with the extraction system prompt, requests strict JSON, parses and returns.
- `extractFromImages(images: Buffer[]): RawExtraction` — calls Sonnet with images as vision input + extraction prompt.
- Both must:
  - Instruct the model to return STRICT JSON matching the invoice schema (no markdown, no prose).
  - Ask the model to include a `confidence` (0–1) reflecting how sure it is about the extraction.
  - Implement a retry (e.g. up to 2 retries with exponential backoff) on transient API errors and on invalid/unparseable JSON.
  - Keep all prompts in `claude/prompts/` so they're versioned and easy to edit.
- Model names come from env (`CLAUDE_TEXT_MODEL`, `CLAUDE_VISION_MODEL`).

**ValidationModule**
- **Structural validation:** map the raw extraction into `ExtractedInvoiceDto` and run `class-validator`. Required-field presence (at minimum: total, and either invoice_number or vendor), correct types, valid dates, currency in an allowed set (or null).
- **Arithmetic validation:** check that the sum of `line_items[].amount` (plus tax, minus discounts if present) reconciles with `total` within a small tolerance (e.g. ±0.02 for rounding). On mismatch, set `arithmetic_ok=false` and populate `arithmetic_detail` (e.g. "sum of line items (950.00) + tax (0.00) != total (1200.00)").
- **Sanity checks:** total not negative; issue_date not absurdly in the future; due_date not before issue_date (warn, don't fail).
- Returns a `validation` object plus a derived recommendation that the orchestrator uses to pick `status`.

**Common / Guard**
- `ApiKeyGuard`: compares `x-api-key` header to `SERVICE_API_KEY` env. Reject with `401` if missing/invalid. Use a constant-time comparison.

---

## 6. Status Decision Logic (in InvoiceService)

```
if (extraction threw / JSON unparseable after retries) -> "extraction_failed"
else if (!structural_ok) -> "needs_review"
else if (!arithmetic_ok) -> "needs_review"
else if (confidence < CONFIDENCE_THRESHOLD) -> "needs_review"   // default threshold e.g. 0.7
else if (suspected multiple invoices in one PDF) -> "needs_review"
else -> "ok"
```
`CONFIDENCE_THRESHOLD` is configurable via env.

---

## 7. Environment Variables

```
SERVICE_API_KEY=            # required, the key n8n must send
ANTHROPIC_API_KEY=          # required
CLAUDE_TEXT_MODEL=          # e.g. the current Haiku model string
CLAUDE_VISION_MODEL=        # e.g. the current Sonnet model string
PDF_TEXT_MIN_CHARS=100      # threshold to classify text vs scanned
PDF_MAX_VISION_PAGES=5      # cap pages sent to vision
CONFIDENCE_THRESHOLD=0.7    # below this -> needs_review
MAX_UPLOAD_MB=15            # reject larger decoded payloads
PORT=3000
```
Use `@nestjs/config` with a validation schema so the app fails fast on missing required vars.

---

## 8. Error Handling & Edge Cases

- **Corrupt / unreadable PDF:** return `extraction_failed` with a clear message in `validation.issues`; never crash.
- **Claude returns invalid JSON:** retry; if still invalid, `extraction_failed`.
- **Empty / not actually an invoice:** if the model cannot find invoice fields (low confidence, no total), return `needs_review` (or `extraction_failed` if nothing parseable). Do not fabricate values.
- **Multi-page invoice:** treat as one invoice spanning pages. Send all (capped) pages to vision together.
- **Multiple invoices in one PDF:** if the model signals more than one invoice, set `status=needs_review` and note it in `issues`. Do not attempt to split in this version.
- **Vision page cap exceeded:** if PDF has more pages than `PDF_MAX_VISION_PAGES`, process the cap and add a note to `issues`.
- **Transient Anthropic API errors (429/5xx):** exponential backoff retry; if exhausted, `extraction_failed`.

---

## 9. Future Module (scaffold only — DO NOT IMPLEMENT NOW)

Create `enrichment/enrichment.module.ts` as an **empty placeholder module** (registered in `app.module.ts` but with no controllers/providers logic), so the structure is ready for phase 2. Add a short comment in the file describing the planned design:

> Planned: `POST /enrich` endpoint. Phase 2a = Firecrawl (managed API) to enrich sender/company data from a domain. Phase 2b = custom Playwright scraper with Firecrawl as fallback. n8n will call this endpoint; the service performs the scraping/enrichment and returns normalized data. Stateless, like the invoice flow.

Do not add Firecrawl, Playwright, HTTP scraping, or any enrichment logic in this version.

---

## 10. Deployment (Coolify)

- Provide a **Dockerfile** (multi-stage: build with full deps, run on a slim Node image, e.g. `node:22-slim`). Expose `PORT`.
- The service will be deployed on Coolify on the same VPS as n8n and Supabase.
- **Networking:** the container must be reachable by the n8n container over an internal Docker network by container name. In the Coolify compose for this service, declare and join the shared external Docker network used by n8n (do not rely on a manual `docker network connect`, which does not survive redeploys). Document the network name as a deployment step (it must match the network n8n is attached to).
- Provide a `.env.example` listing all variables from §7.
- Add a `GET /health` endpoint (no auth) returning `200` for Coolify health checks.

---

## 11. Testing

- Unit tests for `ValidationService` (arithmetic reconciliation, threshold logic) — these are pure and high-value.
- Unit test for `ApiKeyGuard` (valid/invalid/missing key).
- A test fixture set: one text-based invoice PDF and one scanned invoice PDF (or image-only PDF) to exercise both paths. Mock the Anthropic SDK in tests so they don't hit the real API.
- An integration test for `POST /invoices/process` covering the three `status` outcomes (mock Claude to return: a clean invoice, an arithmetic-mismatch invoice, and an unparseable response).

---

## 12. Acceptance Criteria

1. `POST /invoices/process` with a valid API key and a text-based invoice PDF returns `status: "ok"` with correctly extracted fields and `arithmetic_ok: true` when the invoice is internally consistent.
2. The same endpoint with a scanned/image invoice PDF routes through the vision path (Sonnet) and returns extracted data.
3. An invoice whose line items don't sum to the total returns `status: "needs_review"` with a populated `arithmetic_detail`.
4. A request without a valid `x-api-key` returns `401`.
5. A corrupt PDF returns `status: "extraction_failed"` (HTTP 200) and never crashes the service.
6. `GET /health` returns `200`.
7. The service holds no database connection and performs no persistence or deduplication.
8. `enrichment.module.ts` exists as an empty scaffold and is not wired to any logic.
9. The service builds into a Docker image and runs with the documented env vars.



# Implementation Order — Invoice Service


## Step 1 — Scaffold

**Build:**
- NestJS project (TypeScript).
- `@nestjs/config` with a validation schema that fails fast on missing required env vars (see PRD §7).
- `ApiKeyGuard` (`common/guards/api-key.guard.ts`) — validates the `x-api-key` header against `SERVICE_API_KEY` using constant-time comparison.
- `GET /health` endpoint (no auth) returning `200`.
- `InvoiceController` with a stubbed `POST /invoices/process` (guard applied, returns a placeholder response for now).
- `.env.example` with all variables from PRD §7.

**Check:**
- App boots.
- `GET /health` returns `200`.
- `POST /invoices/process` without a valid `x-api-key` returns `401`; with the key, returns the placeholder.

---

## Step 2 — PdfModule

**Build:**
- `pdf/pdf.service.ts` with:
  - `detectType(buffer): 'text' | 'scanned'` — extract text; if length > `PDF_TEXT_MIN_CHARS` → `text`, else `scanned`.
  - `extractText(buffer): string`.
  - `renderPagesToImages(buffer): Buffer[]` — render pages to PNG, capped at `PDF_MAX_VISION_PAGES`.

**Check:**
- A text-based invoice PDF → classified `text`, text extracted correctly.
- A scanned/image PDF → classified `scanned`, pages render to image buffers.
- **Watch for Docker build issues:** the page→image library (`pdf2pic` / `pdf-to-img`) may need system deps (GraphicsMagick/ImageMagick). If render fails, this is the first suspect — handle it in the Dockerfile later (Step 6) or pick a pure-JS renderer now.

---

## Step 3 — ClaudeModule

**Build:**
- `claude/claude.service.ts` wrapping `@anthropic-ai/sdk`:
  - `extractFromText(text): RawExtraction` — Haiku (`CLAUDE_TEXT_MODEL`).
  - `extractFromImages(images): RawExtraction` — Sonnet vision (`CLAUDE_VISION_MODEL`).
  - Both: strict-JSON system prompt (no markdown/prose), include `confidence` (0–1), retry up to 2x with exponential backoff on transient errors and on invalid JSON.
- Keep prompts in `claude/prompts/`.

**Check:**
- On a real extracted text, Claude returns valid JSON matching the invoice schema.
- Invalid-JSON path triggers retry.
- **Verify the model strings yourself** — Cursor will likely insert outdated model names. Put the current Haiku/Sonnet strings in env.

---

## Step 4 — ValidationModule

**Build:**
- DTOs: `extracted-invoice.dto.ts` with `class-validator` rules.
- `validation/validation.service.ts`:
  - Structural validation (required fields, types, valid dates, currency in allowed set or null).
  - Arithmetic validation (sum of line items + tax reconciles with total within ±0.02).
  - Sanity checks (total ≥ 0, dates plausible).
  - Returns the `validation` object + a recommendation the orchestrator uses for `status`.

**Check:**
- Pure logic — cover with unit tests: arithmetic reconciliation (match + mismatch), threshold logic. No API needed.

---

## Step 5 — InvoiceService (Orchestrator)

**Build:**
- `invoice/invoice.service.ts` wiring the pipeline:
  1. Decode base64 → buffer.
  2. `PdfService.detectType` → branch.
  3. Text path → `extractFromText`; scanned path → render → `extractFromImages`.
  4. `ValidationService`.
  5. Assemble response + pick `status` (PRD §6 decision logic).
  6. Wrap in try/catch → `extraction_failed` on failure, never crash.
- Real `POST /invoices/process` now returns the full structured response.

**Check:**
- Clean consistent invoice → `status: "ok"`.
- Line items not summing to total → `status: "needs_review"` with `arithmetic_detail`.
- Corrupt PDF → `status: "extraction_failed"` (HTTP 200), no crash.

---

## Step 6 — Dockerfile, Deploy, Tests

**Build:**
- Multi-stage Dockerfile (build with full deps → run on `node:22-slim`), expose `PORT`. Add any system deps the PDF→image library needs.
- Coolify deploy: container joins the **same external Docker network as n8n** (declare the network in compose — do not rely on manual `docker network connect`, it doesn't survive redeploys). Network name must match n8n's.
- Integration test for `POST /invoices/process` covering all three `status` outcomes (mock Claude: clean / arithmetic-mismatch / unparseable).
- Guard unit test (valid/invalid/missing key).

**Check:**
- Image builds and runs with the documented env vars.
- n8n container can reach the service by container name over the internal network.

---

## Scaffold note (do during Step 1 or 5, not a separate step)

Create `enrichment/enrichment.module.ts` as an **empty placeholder** registered in `app.module.ts`, with a comment describing the planned phase-2 design (Firecrawl now, custom Playwright scraper with fallback later). **Do not implement any enrichment logic.**


## AdminModule (added to existing NestJS service)

### Database access
- Add a `pg` Pool, configured from env (host, port, db, user, password — the same Postgres the service's network can reach).
- Create a small `DbModule`/`DbService` wrapping the pool with a `query(sql, params)` helper. Use parameterized queries (`$1, $2`) — never string-interpolate input.
- This is the first time the service touches the DB; keep it isolated in its own module so the stateless invoice/enrichment flows are unaffected.

### Auth
- `AdminAuthGuard`: validates a bearer token on all `/admin/*` routes except `/admin/login`.
- Token: on login, compare the submitted password (constant-time) to `ADMIN_PASSWORD` env. If valid, issue a signed token (JWT signed with `ADMIN_JWT_SECRET`, or a simple signed token) with a reasonable expiry (e.g. 12h). No user records — the token just proves "the operator logged in".

### Endpoints

**`POST /admin/login`**
- Body: `{ "password": "..." }`
- Returns `{ "token": "..." }` on success, `401` on wrong password.
- No auth guard on this route.

**`GET /admin/stats`** (dashboard numbers)
- Returns aggregate counts. Example shape:
```json
{
  "leads_by_stage": { "new": 12, "reviewing": 3, "contacted": 5, "qualified": 2, "rejected": 1 },
  "leads_total": 23,
  "invoices_total": 40,
  "invoices_needs_review": 4,
  "avg_extraction_confidence": 0.91
}
```
- Implement with SQL aggregates: `select stage, count(*) from inboxops.leads group by stage`, `count(*)` on invoices, `avg(confidence)` on invoices, etc. One or a few queries — do not pull all rows and count in JS.

**`GET /admin/leads`** (list)
- Optional query param `stage` to filter (`?stage=new`).
- Returns an array of leads with the fields needed for a table: `id, from_address, request (or summary), priority, stage, created_at, has_enrichment` (boolean — whether an enrichment row exists for this lead).
- SQL: select from `inboxops.leads`, left join `inboxops.enrichment` to compute `has_enrichment`. Order by `created_at desc`.

**`GET /admin/leads/:id`** (details)
- Returns one lead joined with its source message and enrichment:
```json
{
  "lead": { "id": "...", "from_address": "...", "budget": "...", "deadline": "...", "contact": "...", "request": "...", "requested_action": "...", "priority": "...", "stage": "...", "created_at": "..." },
  "message": { "subject": "...", "body": "...", "received_at": "..." },
  "enrichment": { "company_name": "...", "industry": "...", "size_hint": "...", "description": "...", "products_services": [...], "location": "...", "source_url": "...", "confidence": 0.0 }
}
```
- `message` and `enrichment` may be null if not present. JOIN `leads` → `messages` (via `message_id`) → `enrichment` (via `lead_id`).

**`PATCH /admin/leads/:id/stage`** (the core action)
- Body: `{ "stage": "contacted" }`
- Validate `stage` is one of `new | reviewing | contacted | qualified | rejected` (reject others with `400`).
- `update inboxops.leads set stage = $1, updated_at = now() where id = $2`.
- Returns the updated lead. `404` if the lead doesn't exist.

### Module structure
```
src/
  admin/
    admin.module.ts
    admin.controller.ts          # all /admin routes
    admin.service.ts             # SQL queries for stats/leads/details/stage
    auth/
      admin-auth.guard.ts
      admin-auth.service.ts      # login + token issue/verify
    dto/
      login.dto.ts
      update-stage.dto.ts
  db/
    db.module.ts
    db.service.ts                # pg Pool + query helper
```

### New env vars
```
DB_HOST=                  # Postgres host reachable from the service (internal)
DB_PORT=5432
DB_NAME=postgres
DB_USER=postgres
DB_PASSWORD=
ADMIN_PASSWORD=           # the single admin login password
ADMIN_JWT_SECRET=         # secret for signing the admin token
```

---