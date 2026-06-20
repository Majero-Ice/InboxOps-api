import { Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../db/db.service';
import {
  AdminLead,
  AdminLeadDetails,
  AdminLeadListItem,
  AdminStats,
  LEAD_STAGES,
  LeadStage,
} from './admin.types';

@Injectable()
export class AdminService {
  constructor(private readonly db: DbService) {}

  async getStats(): Promise<AdminStats> {
    const [stageRows, aggregateRow] = await Promise.all([
      this.db.query<{ stage: string; count: string }>(
        `SELECT stage, COUNT(*)::text AS count
         FROM inboxops.leads
         GROUP BY stage`,
      ),
      this.db.queryOne<{
        leads_total: string;
        invoices_total: string;
        invoices_needs_review: string;
        avg_extraction_confidence: string | null;
      }>(
        `SELECT
           (SELECT COUNT(*)::text FROM inboxops.leads) AS leads_total,
           (SELECT COUNT(*)::text FROM inboxops.invoices) AS invoices_total,
           (SELECT COUNT(*)::text FROM inboxops.invoices WHERE status = 'needs_review') AS invoices_needs_review,
           (SELECT AVG(confidence)::text FROM inboxops.invoices) AS avg_extraction_confidence`,
      ),
    ]);

    const leadsByStage = Object.fromEntries(
      LEAD_STAGES.map((stage) => [stage, 0]),
    ) as Record<LeadStage, number>;

    for (const row of stageRows) {
      if (row.stage in leadsByStage) {
        leadsByStage[row.stage as LeadStage] = Number(row.count);
      }
    }

    return {
      leads_by_stage: leadsByStage,
      leads_total: Number(aggregateRow?.leads_total ?? 0),
      invoices_total: Number(aggregateRow?.invoices_total ?? 0),
      invoices_needs_review: Number(aggregateRow?.invoices_needs_review ?? 0),
      avg_extraction_confidence: Number(
        aggregateRow?.avg_extraction_confidence ?? 0,
      ),
    };
  }

  async listLeads(stage?: LeadStage): Promise<AdminLeadListItem[]> {
    const params: unknown[] = [];
    let whereClause = '';

    if (stage) {
      whereClause = 'WHERE l.stage = $1';
      params.push(stage);
    }

    const rows = await this.db.query<{
      id: string;
      from_address: string;
      request: string | null;
      priority: string | null;
      stage: LeadStage;
      created_at: Date;
      has_enrichment: boolean;
    }>(
      `SELECT
         l.id,
         l.from_address,
         l.request,
         l.priority,
         l.stage,
         l.created_at,
         (e.lead_id IS NOT NULL) AS has_enrichment
       FROM inboxops.leads l
       LEFT JOIN inboxops.enrichment e ON e.lead_id = l.id
       ${whereClause}
       ORDER BY l.created_at DESC`,
      params,
    );

    return rows.map((row) => ({
      id: row.id,
      from_address: row.from_address,
      request: row.request,
      priority: row.priority,
      stage: row.stage,
      created_at: row.created_at.toISOString(),
      has_enrichment: row.has_enrichment,
    }));
  }

  async getLeadDetails(id: string): Promise<AdminLeadDetails> {
    const row = await this.db.queryOne<{
      lead_id: string;
      from_address: string;
      budget: string | null;
      deadline: string | null;
      contact: string | null;
      request: string | null;
      requested_action: string | null;
      priority: string | null;
      stage: LeadStage;
      created_at: Date;
      updated_at: Date;
      subject: string | null;
      body: string | null;
      message_id: string | null;
      message_created_at: Date | null;
      company_name: string | null;
      industry: string | null;
      size_hint: string | null;
      description: string | null;
      products_services: string[] | null;
      location: string | null;
      source_url: string | null;
      confidence: string | null;
      enrichment_lead_id: string | null;
    }>(
      `SELECT
         l.id AS lead_id,
         l.from_address,
         l.budget,
         l.deadline,
         l.contact,
         l.request,
         l.requested_action,
         l.priority,
         l.stage,
         l.created_at,
         l.updated_at,
         m.subject,
         m.body,
         m.id AS message_id,
         m.created_at AS message_created_at,
         e.company_name,
         e.industry,
         e.size_hint,
         e.description,
         e.products_services,
         e.location,
         e.source_url,
         e.confidence::text AS confidence,
         e.lead_id AS enrichment_lead_id
       FROM inboxops.leads l
       LEFT JOIN inboxops.messages m ON m.id = l.message_id
       LEFT JOIN inboxops.enrichment e ON e.lead_id = l.id
       WHERE l.id = $1`,
      [id],
    );

    if (!row) {
      throw new NotFoundException();
    }

    return {
      lead: {
        id: row.lead_id,
        from_address: row.from_address,
        budget: row.budget,
        deadline: row.deadline,
        contact: row.contact,
        request: row.request,
        requested_action: row.requested_action,
        priority: row.priority,
        stage: row.stage,
        created_at: row.created_at.toISOString(),
        updated_at: row.updated_at.toISOString(),
      },
      message:
        row.message_id === null
          ? null
          : {
              subject: row.subject,
              body: row.body,
              received_at: row.message_created_at!.toISOString(),
            },
      enrichment:
        row.enrichment_lead_id === null
          ? null
          : {
              company_name: row.company_name,
              industry: row.industry,
              size_hint: row.size_hint,
              description: row.description,
              products_services: row.products_services ?? [],
              location: row.location,
              source_url: row.source_url,
              confidence: Number(row.confidence ?? 0),
            },
    };
  }

  async updateLeadStage(id: string, stage: LeadStage): Promise<AdminLead> {
    const row = await this.db.queryOne<{
      id: string;
      from_address: string;
      budget: string | null;
      deadline: string | null;
      contact: string | null;
      request: string | null;
      requested_action: string | null;
      priority: string | null;
      stage: LeadStage;
      created_at: Date;
      updated_at: Date;
    }>(
      `UPDATE inboxops.leads
       SET stage = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING
         id,
         from_address,
         budget,
         deadline,
         contact,
         request,
         requested_action,
         priority,
         stage,
         created_at,
         updated_at`,
      [stage, id],
    );

    if (!row) {
      throw new NotFoundException();
    }

    return {
      id: row.id,
      from_address: row.from_address,
      budget: row.budget,
      deadline: row.deadline,
      contact: row.contact,
      request: row.request,
      requested_action: row.requested_action,
      priority: row.priority,
      stage: row.stage,
      created_at: row.created_at.toISOString(),
      updated_at: row.updated_at.toISOString(),
    };
  }
}
