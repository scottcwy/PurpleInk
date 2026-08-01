const ADMIN_INDEX_DEFINITIONS = new Map([
  ['ai_invocations_admin_telemetry_created_idx', 'CREATE INDEX ai_invocations_admin_telemetry_created_idx ON public.ai_invocations USING btree (telemetry_version, created_at DESC NULLS LAST)'],
  ['task_attempts_admin_status_created_idx', 'CREATE INDEX task_attempts_admin_status_created_idx ON public.task_attempts USING btree (status, created_at DESC NULLS LAST)'],
  ['task_attempts_admin_created_idx', 'CREATE INDEX task_attempts_admin_created_idx ON public.task_attempts USING btree (created_at DESC NULLS LAST)'],
])

const USERS_ROLE_CHECK = "CHECK ((role = ANY (ARRAY['user'::text, 'admin'::text])))"

export function assertAdminIndexDefinitions(indexDefinitions: ReadonlyMap<string, string>): void {
  for (const [name, expected] of ADMIN_INDEX_DEFINITIONS) {
    if (indexDefinitions.get(name) !== expected) {
      throw new Error(`admin index definition mismatch: ${name}`)
    }
  }
}

export function assertUsersRoleCheckConstraint(definition: string | null): void {
  if (definition !== USERS_ROLE_CHECK) {
    throw new Error('users_role_check contract mismatch')
  }
}
