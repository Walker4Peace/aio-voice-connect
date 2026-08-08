import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool, types } = pg;

// node-postgres returns TIMESTAMP WITHOUT TIME ZONE columns as bare strings
// (e.g. "2026-08-08 14:02:05.123") without any timezone indicator.  JavaScript's
// Date constructor treats such strings as LOCAL time, which causes a double-offset
// bug when the server runs in a non-UTC timezone.  Appending 'Z' tells the parser
// the value is UTC, which is always correct since we only ever store UTC values.
// OID 1114 = timestamp without time zone
types.setTypeParser(1114 as unknown as string, (raw: string) => new Date(raw + "Z"));

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

export * from "./schema";
