import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getServerEnv } from "@/lib/env";
import * as schema from "./schema";

export function createDatabaseClient(databaseUrl: string) {
  const client = postgres(databaseUrl, { prepare: false });
  return drizzle(client, { schema });
}

let database: ReturnType<typeof createDatabaseClient> | undefined;

export function getDatabase(): ReturnType<typeof createDatabaseClient> {
  database ??= createDatabaseClient(getServerEnv().DATABASE_URL);
  return database;
}

export type Database = ReturnType<typeof createDatabaseClient>;
