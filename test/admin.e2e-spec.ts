import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createTestApp } from './helpers/create-test-app';

describe('Admin (e2e)', () => {
  let app: INestApplication<App>;
  let dbQuery: jest.Mock;
  let dbQueryOne: jest.Mock;

  beforeEach(() => {
    dbQuery = jest.fn().mockResolvedValue([]);
    dbQueryOne = jest.fn().mockResolvedValue(null);
  });

  afterEach(async () => {
    await app?.close();
  });

  describe('POST /admin/login', () => {
    beforeEach(async () => {
      app = await createTestApp({
        dbService: { query: dbQuery, queryOne: dbQueryOne },
      });
    });

    it('returns a token for the correct password', async () => {
      const response = await request(app.getHttpServer())
        .post('/admin/login')
        .send({ password: 'admin-test-password' })
        .expect(201);

      expect(response.body.token).toBeDefined();
    });

    it('returns 401 for the wrong password', () => {
      return request(app.getHttpServer())
        .post('/admin/login')
        .send({ password: 'wrong-password' })
        .expect(401);
    });
  });

  describe('protected admin routes', () => {
    let token: string;

    beforeEach(async () => {
      app = await createTestApp({
        dbService: { query: dbQuery, queryOne: dbQueryOne },
      });

      const login = await request(app.getHttpServer())
        .post('/admin/login')
        .send({ password: 'admin-test-password' });

      token = login.body.token;
    });

    it('returns 401 without a bearer token', () => {
      return request(app.getHttpServer()).get('/admin/stats').expect(401);
    });

    it('returns dashboard stats', async () => {
      dbQuery.mockResolvedValue([
        { stage: 'new', count: '2' },
        { stage: 'contacted', count: '1' },
      ]);
      dbQueryOne.mockResolvedValue({
        leads_total: '3',
        invoices_total: '5',
        invoices_needs_review: '1',
        avg_extraction_confidence: '0.9',
      });

      const response = await request(app.getHttpServer())
        .get('/admin/stats')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.leads_total).toBe(3);
      expect(response.body.leads_by_stage.new).toBe(2);
    });

    it('lists leads', async () => {
      dbQuery.mockResolvedValue([
        {
          id: 'lead-1',
          from_address: 'client@acme.com',
          request: 'Need help',
          priority: 'high',
          stage: 'new',
          created_at: new Date('2024-01-15T10:00:00.000Z'),
          has_enrichment: false,
        },
      ]);

      const response = await request(app.getHttpServer())
        .get('/admin/leads')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].id).toBe('lead-1');
    });

    it('updates lead stage', async () => {
      dbQueryOne.mockResolvedValue({
        id: 'lead-1',
        from_address: 'client@acme.com',
        budget: null,
        deadline: null,
        contact: null,
        request: 'Need help',
        requested_action: null,
        priority: 'high',
        stage: 'contacted',
        created_at: new Date('2024-01-15T10:00:00.000Z'),
        updated_at: new Date('2024-01-16T10:00:00.000Z'),
      });

      const response = await request(app.getHttpServer())
        .patch('/admin/leads/lead-1/stage')
        .set('Authorization', `Bearer ${token}`)
        .send({ stage: 'contacted' })
        .expect(200);

      expect(response.body.stage).toBe('contacted');
    });

    it('returns 400 for an invalid stage', () => {
      return request(app.getHttpServer())
        .patch('/admin/leads/lead-1/stage')
        .set('Authorization', `Bearer ${token}`)
        .send({ stage: 'invalid' })
        .expect(400);
    });

    it('returns 404 when updating a missing lead', async () => {
      dbQueryOne.mockResolvedValue(null);

      return request(app.getHttpServer())
        .patch('/admin/leads/missing/stage')
        .set('Authorization', `Bearer ${token}`)
        .send({ stage: 'contacted' })
        .expect(404);
    });
  });
});
