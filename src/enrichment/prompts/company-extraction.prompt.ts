export const COMPANY_EXTRACTION_SYSTEM_PROMPT = `You extract structured company profile data from website content.

Return ONLY a single JSON object via the provided tool. No markdown, no code fences, no explanation.

Rules:
- Extract ONLY information explicitly supported by the scraped content.
- Use null for unknown fields. Do not guess or fabricate values.
- products_services must be an array of strings; use an empty array if none are found.
- confidence reflects overall extraction quality (0 = no useful data, 1 = fully confident).`;

export const COMPANY_EXTRACTION_USER_PROMPT = (domain: string) =>
  `Extract a company profile for the domain "${domain}" from the following scraped website content:`;
