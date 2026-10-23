/**
 * Postgres real (PGlite, Postgres 17 em WebAssembly) com um "stub" mínimo
 * do schema `auth` do Supabase, para executar as MESMAS migrações que vão
 * para produção e testar constraints, triggers, função de saldos e RLS.
 */
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SUPABASE_AUTH_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  grant usage on schema auth to anon, authenticated;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant execute on function auth.uid() to anon, authenticated;
  grant usage on schema public to anon, authenticated;
`;

export const USER_A = "11111111-1111-1111-1111-111111111111";
export const USER_B = "22222222-2222-2222-2222-222222222222";

export const MIGRATIONS_DIR = join(__dirname, "..", "..", "supabase", "migrations");
export const migrationFiles = () => readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();

/** Cria o banco aplicando as migrações (todas, ou só as `upTo` primeiras). */
export async function createDb(opts: { upTo?: number } = {}) {
  const db = new PGlite();
  await db.exec(SUPABASE_AUTH_STUB);
  for (const file of migrationFiles().slice(0, opts.upTo ?? Infinity)) {
    await applyMigration(db, file);
  }
  await db.exec(`insert into auth.users (id, email) values ('${USER_A}', 'a@x.com'), ('${USER_B}', 'b@x.com');`);
  return db;
}

export async function applyMigration(db: PGlite, file: string) {
  await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
}

export type Db = Awaited<ReturnType<typeof createDb>>;

/** Executa como um usuário autenticado (RLS ativo), igual ao PostgREST. */
export async function asUser<T>(db: Db, userId: string | null, fn: () => Promise<T>): Promise<T> {
  if (userId) {
    await db.exec(`set request.jwt.claim.sub = '${userId}'; set role authenticated;`);
  } else {
    await db.exec(`set request.jwt.claim.sub = ''; set role anon;`);
  }
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; reset request.jwt.claim.sub;`);
  }
}

export async function one<T = Record<string, unknown>>(db: Db, sql: string, params: unknown[] = []) {
  const r = await db.query<T>(sql, params);
  return r.rows[0];
}
