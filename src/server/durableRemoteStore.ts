import type Database from 'better-sqlite3';

export class ServerlessPersistenceError extends Error {
  public readonly statusCode = 503;
  constructor(message: string) {
    super(message);
    this.name = 'ServerlessPersistenceError';
  }
}

interface TursoArg {
  type: 'text' | 'integer' | 'float' | 'null';
  value?: string;
}

interface TursoStmt {
  sql: string;
  args?: TursoArg[];
}

function normalizeTursoHttpBaseUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, '');
  if (trimmed.startsWith('libsql://')) {
    return `https://${trimmed.slice('libsql://'.length)}`;
  }
  return trimmed;
}

export function isRemoteDurableStoreConfigured(): boolean {
  const url = process.env.TURSO_DATABASE_URL?.trim() || '';
  const token = process.env.TURSO_AUTH_TOKEN?.trim() || '';
  return url.length > 0 && token.length > 0;
}

export function isServerlessRuntime(): boolean {
  return Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
}

/**
 * Enforces DPDP & clinical durability in serverless environments:
 * Refuses to silently write PHI or audit logs to ephemeral `/tmp` on Vercel/Lambda
 * unless a durable remote database (`TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`) is configured
 * (or `ALLOW_EPHEMERAL_SERVERLESS_DB === 'true'` is explicitly set for isolated CI tests).
 */
export function assertServerlessPersistenceSafety(dbPath: string): void {
  if (dbPath === ':memory:') return;
  if (!isServerlessRuntime()) return;
  if (isRemoteDurableStoreConfigured()) return;
  if (process.env.ALLOW_EPHEMERAL_SERVERLESS_DB === 'true') return;

  throw new ServerlessPersistenceError(
    'Serverless Persistence Guard: Local SQLite files on Vercel/Lambda (/tmp) are ephemeral and lose patient records across cold starts. Configure TURSO_DATABASE_URL and TURSO_AUTH_TOKEN for durable serverless SQL persistence, or deploy as a stateful service with a persistent volume.'
  );
}

function toTursoArgs(params: Array<string | number | null | undefined>): TursoArg[] {
  return params.map((val) => {
    if (val === null || val === undefined) {
      return {type: 'null'};
    }
    if (typeof val === 'number') {
      if (Number.isInteger(val)) {
        return {type: 'integer', value: String(val)};
      }
      return {type: 'float', value: String(val)};
    }
    return {type: 'text', value: String(val)};
  });
}

export class TursoDurableReplicator {
  private readonly pipelineUrl: string;
  private readonly authToken: string;
  private pendingChain: Promise<void> = Promise.resolve();

  constructor(rawUrl: string, authToken: string) {
    this.pipelineUrl = `${normalizeTursoHttpBaseUrl(rawUrl)}/v2/pipeline`;
    this.authToken = authToken.trim();
  }

  public static fromEnv(): TursoDurableReplicator | null {
    if (!isRemoteDurableStoreConfigured()) return null;
    return new TursoDurableReplicator(
      process.env.TURSO_DATABASE_URL!,
      process.env.TURSO_AUTH_TOKEN!
    );
  }

  public async executeBatch(statements: TursoStmt[]): Promise<
    Array<{
      cols: Array<{name: string}>;
      rows: Array<Array<{type: string; value?: string}>>;
    }>
  > {
    if (statements.length === 0) return [];
    const requests = [
      ...statements.map((stmt) => ({
        type: 'execute',
        stmt: {
          sql: stmt.sql,
          ...(stmt.args && stmt.args.length > 0 ? {args: stmt.args} : {}),
        },
      })),
      {type: 'close'},
    ];

    const resp = await fetch(this.pipelineUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({requests}),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`Remote LibSQL/Turso HTTP ${resp.status}: ${text.slice(0, 240)}`);
    }

    const body = (await resp.json()) as {
      results?: Array<{
        type: 'ok' | 'error';
        error?: {message?: string};
        response?: {
          type: string;
          result?: {
            cols: Array<{name: string}>;
            rows: Array<Array<{type: string; value?: string}>>;
          };
        };
      }>;
    };

    const output: Array<{
      cols: Array<{name: string}>;
      rows: Array<Array<{type: string; value?: string}>>;
    }> = [];

    for (const item of body.results || []) {
      if (item.type === 'error') {
        throw new Error(`Remote LibSQL statement error: ${item.error?.message || 'Unknown'}`);
      }
      if (item.response?.type === 'execute' && item.response.result) {
        output.push(item.response.result);
      }
    }
    return output;
  }

  public enqueueWrite(sql: string, params: Array<string | number | null | undefined>): void {
    const stmt: TursoStmt = {sql, args: toTursoArgs(params)};
    this.pendingChain = this.pendingChain
      .then(async () => {
        await this.executeBatch([stmt]);
      })
      .catch((err) => {
        console.error('[HealthSync Remote DB] Durable write replication error:', err);
      });
  }

  public async flush(): Promise<void> {
    await this.pendingChain;
  }

  public async hydrateIntoLocalSqlite(localDb: Database.Database, schemaDDL: string): Promise<void> {
    const ddlStatements = schemaDDL
      .split(';\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => ({sql: s.endsWith(';') ? s : `${s};`}));

    await this.executeBatch(ddlStatements);

    const tablesToHydrate: Array<{table: string; orderBy: string}> = [
      {table: 'vault_metadata', orderBy: 'key ASC'},
      {table: 'users', orderBy: 'created_at_ms ASC'},
      {table: 'sessions', orderBy: 'created_at_ms ASC'},
      {table: 'triage_records', orderBy: 'created_at_ms ASC'},
      {table: 'consent_records', orderBy: 'created_at_ms ASC'},
      {table: 'incentive_entries', orderBy: 'created_at_ms ASC'},
      {table: 'sms_dispatches', orderBy: 'created_at_ms ASC'},
      {table: 'security_breach_reports', orderBy: 'created_at_ms ASC'},
      {table: 'audit_logs', orderBy: 'seq ASC'},
    ];

    const selectResults = await this.executeBatch(
      tablesToHydrate.map((t) => ({sql: `SELECT * FROM ${t.table} ORDER BY ${t.orderBy}`}))
    );

    const tx = localDb.transaction(() => {
      tablesToHydrate.forEach((meta, idx) => {
        const res = selectResults[idx];
        if (!res || res.rows.length === 0) return;
        const colNames = res.cols.map((c) => c.name);
        const placeholders = colNames.map(() => '?').join(', ');
        const insertSql =
          meta.table === 'audit_logs'
            ? `INSERT OR IGNORE INTO ${meta.table} (${colNames.join(', ')}) VALUES (${placeholders})`
            : `INSERT OR REPLACE INTO ${meta.table} (${colNames.join(', ')}) VALUES (${placeholders})`;
        const prepared = localDb.prepare(insertSql);
        for (const row of res.rows) {
          const values = row.map((cell) => {
            if (cell.type === 'null' || cell.value === undefined) return null;
            if (cell.type === 'integer') return Number(cell.value);
            if (cell.type === 'float') return Number(cell.value);
            return cell.value;
          });
          prepared.run(...values);
        }
      });
    });
    tx();
  }
}
