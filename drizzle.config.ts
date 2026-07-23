import "dotenv/config";
import { defineConfig } from "drizzle-kit";
import { parseServerEnv } from "./lib/env";

const environment = parseServerEnv(process.env);

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dbCredentials: {
    url: environment.DATABASE_URL,
  },
  strict: true,
  verbose: true,
});
