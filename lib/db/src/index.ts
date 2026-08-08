import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Force every PostgreSQL session to use UTC.
// TIMESTAMP WITHOUT TIME ZONE columns (createdAt / updatedAt on most tables)
// are stored and returned relative to the session timezone.  On a server whose
// OS timezone is UTC+2, the default session is also UTC+2, so PostgreSQL stores
// "local time" instead of UTC, resulting in all timestamps appearing 2 h ahead
// in the UI even after the user picks their own timezone in Settings.
// Setting the session timezone to UTC at connection time ensures consistent,
// unambiguous UTC storage and retrieval regardless of the host OS timezone.
pool.on("connect", (client) => {
  void client.query("SET timezone TO 'UTC'");
});

export const db = drizzle(pool, { schema });

export * from "./schema";
