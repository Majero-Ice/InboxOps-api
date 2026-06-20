export const LEAD_STAGES = [
  'new',
  'reviewing',
  'contacted',
  'qualified',
  'rejected',
] as const;

export type LeadStage = (typeof LEAD_STAGES)[number];

export interface AdminStats {
  leads_by_stage: Record<LeadStage, number>;
  leads_total: number;
  invoices_total: number;
  invoices_needs_review: number;
  avg_extraction_confidence: number;
}

export interface AdminLeadListItem {
  id: string;
  from_address: string;
  request: string | null;
  priority: string | null;
  stage: LeadStage;
  created_at: string;
  has_enrichment: boolean;
}

export interface AdminLead {
  id: string;
  from_address: string;
  budget: string | null;
  deadline: string | null;
  contact: string | null;
  request: string | null;
  requested_action: string | null;
  priority: string | null;
  stage: LeadStage;
  created_at: string;
  updated_at: string;
}

export interface AdminMessage {
  subject: string | null;
  body: string | null;
  received_at: string;
}

export interface AdminEnrichment {
  company_name: string | null;
  industry: string | null;
  size_hint: string | null;
  description: string | null;
  products_services: string[];
  location: string | null;
  source_url: string | null;
  confidence: number;
}

export interface AdminLeadDetails {
  lead: AdminLead;
  message: AdminMessage | null;
  enrichment: AdminEnrichment | null;
}

export interface LoginResult {
  token: string;
}
