# PRD Addendum — Enrichment Module (`/enrich`)

This extends the existing invoice service. Implement the previously-scaffolded `EnrichmentModule` as a real feature. Same architectural rules as the invoice flow: **stateless** — the service does NOT touch the database, does NOT cache, does NOT persist. n8n owns persistence and caching. The service only takes a domain, enriches it, and returns structured data.

---

## 1. Purpose

Given a company domain (extracted by n8n from a lead's sender email), scrape the company's website via Firecrawl and use Claude to extract a structured company profile. Returns the profile to n8n, which persists it to the `enrichment` table and links it to the lead.

---

## 2. Endpoint

`POST /enrich`

**Auth:** same `x-api-key` guard as `/invoices/process`.

### Request
```json
{
  "domain": "acme.com",
  "source_message_id": "optional string, logging/tracing only"
}
```
- `domain` (required): the company domain to enrich (no protocol, e.g. `acme.com`).
- `source_message_id` (optional): for logging only.

### Response
```json
{
  "status": "ok | skipped | enrichment_failed",
  "domain": "acme.com",
  "company": {
    "name": "string | null",
    "description": "string | null",
    "industry": "string | null",
    "size_hint": "string | null",
    "products_services": ["string"],
    "location": "string | null",
    "tone": "string | null"
  },
  "confidence": 0.0,
  "source_url": "https://acme.com",
  "meta": { "model_used": "string", "processing_ms": 0 }
}
```

### `status` semantics
- **`ok`** — successfully scraped and extracted a profile.
- **`skipped`** — the domain is a public email provider (gmail.com, outlook.com, yahoo.com, proton.me, icloud.com, etc.) or there was nothing meaningful to scrape. `company` may be null/empty. n8n will not persist enrichment for `skipped`.
- **`enrichment_failed`** — Firecrawl failed, the site was unreachable, or Claude returned unusable output after retries.

All three return HTTP `200` (valid business outcomes). Reserve non-2xx for transport/auth/validation errors.

---

## 3. Internal Flow (EnrichmentService)

1. **Public-domain check.** Maintain a configurable list of public email providers. If `domain` is in the list → return immediately with `status: "skipped"`. (This avoids wasting Firecrawl credits and tokens on personal emails.)
2. **Scrape via Firecrawl.** Use Firecrawl's `/scrape` endpoint (NOT `/crawl`). Scrape the homepage (`https://{domain}`). Then attempt the about page (try common paths like `/about`, `/about-us`); if it 404s or fails, ignore and proceed with the homepage only. Combine the retrieved markdown.
   - Cap the combined content length sent to Claude (configurable, e.g. `ENRICH_MAX_CHARS`) to control token cost.
3. **Extract via Claude.** Use the tool-use structured-output pattern (same approach as invoice extraction): define a single tool whose `input_schema` matches the `company` object + `confidence`, force it with `tool_choice`, read the structured result from the `tool_use` block. Model: Haiku (`CLAUDE_TEXT_MODEL`) — this is text extraction, not heavy reasoning. Instruct the model to extract ONLY what's supported by the scraped content and to use `null` for unknown fields rather than guessing.
4. **Assemble response** with the correct `status`, `confidence`, and `source_url`.
5. Wrap in try/catch → `enrichment_failed` on any unrecoverable error. Never crash. Retry transient Firecrawl/Anthropic errors (up to 2x, exponential backoff), consistent with the ClaudeService retry logic.

---

## 4. Module Structure (add to existing service)

```
src/
  enrichment/
    enrichment.module.ts          # replace the empty scaffold with real wiring
    enrichment.controller.ts      # POST /enrich, x-api-key guard
    enrichment.service.ts         # orchestrates: public-check -> Firecrawl -> Claude -> assemble
    firecrawl/
      firecrawl.service.ts        # wraps the Firecrawl API (scrape)
    dto/
      enrich-request.dto.ts
      enrich-result.dto.ts
    prompts/
      company-extraction.prompt.ts
```
Reuse the existing `ClaudeService` for the Claude call if practical (add an `extractCompanyProfile(markdown)` method), or create a focused method — keep all Anthropic calls going through one place. Reuse the existing API-key guard.

---

## 5. New Environment Variables

```
FIRECRAWL_API_KEY=          # required for enrichment
ENRICH_MAX_CHARS=12000      # cap scraped content sent to Claude
ENRICH_ABOUT_PATHS=/about,/about-us   # paths to try for the about page
PUBLIC_EMAIL_DOMAINS=gmail.com,outlook.com,hotmail.com,yahoo.com,icloud.com,proton.me,protonmail.com,gmx.com,web.de,mail.ru,yandex.ru
```
Add these to the config validation schema and `.env.example`.

---

## 6. NOT in the service (handled by n8n — do not implement)

- **Caching:** n8n checks the `enrichment` table for a recent record for the domain BEFORE calling `/enrich`. If a fresh record exists, n8n skips the call entirely. The service does no caching and is unaware of cache state.
- **Domain extraction from email:** n8n extracts the domain from the lead's sender address before calling.
- **Persistence:** n8n writes the returned profile to `inboxops.enrichment` and links it to the lead.

---

## 7. Acceptance Criteria

1. `POST /enrich` with a corporate domain returns `status: "ok"` and a populated `company` profile.
2. `POST /enrich` with a public email domain (e.g. `gmail.com`) returns `status: "skipped"` without calling Firecrawl or Claude.
3. An unreachable domain / Firecrawl failure returns `status: "enrichment_failed"` (HTTP 200), never crashes.
4. Unknown company fields are `null`, not fabricated.
5. The service performs no database access and no caching.
6. Requests without a valid `x-api-key` return `401`.
