export function createIsolatedPgTestEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  databaseUrl: string,
): Record<string, string | undefined> {
  return {
    ...environment,
    DATABASE_URL: databaseUrl,
    TEST_DATABASE_URL: databaseUrl,
  }
}
