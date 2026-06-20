import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DbService } from '../db/db.service';
import { AdminService } from './admin.service';

describe('AdminService', () => {
  let service: AdminService;
  let db: jest.Mocked<Pick<DbService, 'query' | 'queryOne'>>;

  beforeEach(async () => {
    db = {
      query: jest.fn(),
      queryOne: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: DbService, useValue: db },
      ],
    }).compile();

    service = module.get(AdminService);
  });

  it('builds dashboard stats from SQL aggregates', async () => {
    db.query.mockResolvedValue([
      { stage: 'new', count: '12' },
      { stage: 'reviewing', count: '3' },
      { stage: 'contacted', count: '5' },
    ]);
    db.queryOne.mockResolvedValue({
      leads_total: '23',
      invoices_total: '40',
      invoices_needs_review: '4',
      avg_extraction_confidence: '0.91',
    });

    const stats = await service.getStats();

    expect(stats.leads_by_stage.new).toBe(12);
    expect(stats.leads_by_stage.reviewing).toBe(3);
    expect(stats.leads_by_stage.qualified).toBe(0);
    expect(stats.leads_total).toBe(23);
    expect(stats.invoices_total).toBe(40);
    expect(stats.invoices_needs_review).toBe(4);
    expect(stats.avg_extraction_confidence).toBe(0.91);
  });

  it('lists leads with optional stage filter', async () => {
    db.query.mockResolvedValue([
      {
        id: 'lead-1',
        from_address: 'client@acme.com',
        request: 'Need a website redesign',
        priority: 'high',
        stage: 'new',
        created_at: new Date('2024-01-15T10:00:00.000Z'),
        has_enrichment: true,
      },
    ]);

    const leads = await service.listLeads('new');

    expect(leads).toHaveLength(1);
    expect(leads[0].has_enrichment).toBe(true);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE l.stage = $1'),
      ['new'],
    );
  });

  it('returns lead details with message and enrichment', async () => {
    db.queryOne.mockResolvedValue({
      lead_id: 'lead-1',
      from_address: 'client@acme.com',
      budget: '$10k',
      deadline: '2024-03-01',
      contact: 'Jane Doe',
      request: 'Need a website redesign',
      requested_action: 'quote',
      priority: 'high',
      stage: 'new',
      created_at: new Date('2024-01-15T10:00:00.000Z'),
      updated_at: new Date('2024-01-15T10:00:00.000Z'),
      subject: 'Project inquiry',
      body: 'Hello, we need help.',
      received_at: new Date('2024-01-15T09:00:00.000Z'),
      company_name: 'Acme Corp',
      industry: 'Technology',
      size_hint: '50-200',
      description: 'Enterprise software',
      products_services: ['SaaS'],
      location: 'San Francisco',
      source_url: 'https://acme.com',
      confidence: '0.88',
      enrichment_lead_id: 'lead-1',
    });

    const details = await service.getLeadDetails('lead-1');

    expect(details.lead.id).toBe('lead-1');
    expect(details.message?.subject).toBe('Project inquiry');
    expect(details.enrichment?.company_name).toBe('Acme Corp');
  });

  it('throws when lead details are missing', async () => {
    db.queryOne.mockResolvedValue(null);

    await expect(service.getLeadDetails('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('updates lead stage and returns the lead', async () => {
    db.queryOne.mockResolvedValue({
      id: 'lead-1',
      from_address: 'client@acme.com',
      budget: null,
      deadline: null,
      contact: null,
      request: 'Need help',
      requested_action: null,
      priority: 'medium',
      stage: 'contacted',
      created_at: new Date('2024-01-15T10:00:00.000Z'),
      updated_at: new Date('2024-01-16T10:00:00.000Z'),
    });

    const lead = await service.updateLeadStage('lead-1', 'contacted');

    expect(lead.stage).toBe('contacted');
    expect(db.queryOne).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE inboxops.leads'),
      ['contacted', 'lead-1'],
    );
  });
});
