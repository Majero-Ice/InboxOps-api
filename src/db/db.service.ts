import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, QueryResultRow } from 'pg';

@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DbService.name);
  private pool!: Pool;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    this.pool = new Pool({
      host: this.configService.getOrThrow<string>('DB_HOST'),
      port: this.configService.get<number>('DB_PORT', 5432),
      database: this.configService.getOrThrow<string>('DB_NAME'),
      user: this.configService.getOrThrow<string>('DB_USER'),
      password: this.configService.getOrThrow<string>('DB_PASSWORD'),
    });
  }

  async query<T extends QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const result = await this.pool.query<T>(sql, params);
    return result.rows;
  }

  async queryOne<T extends QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
    this.logger.log('Postgres pool closed');
  }
}
