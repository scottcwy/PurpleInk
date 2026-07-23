import { z } from "zod";

const serverEnvSchema = z.object({
  DATABASE_URL: z
    .url()
    .refine(
      (value) => value.startsWith("postgresql://") || value.startsWith("postgres://"),
      "DATABASE_URL must be a PostgreSQL URL",
    ),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(
  environment: Record<string, string | undefined>,
): ServerEnv {
  return serverEnvSchema.parse(environment);
}

export function getServerEnv(): ServerEnv {
  return parseServerEnv(process.env);
}
