import { describe, expect, it } from 'vitest'
import {
  assertAdminIndexDefinitions,
  assertUsersRoleCheckConstraint,
} from '../scripts/verify/database-upgrade-schema-contract'
import { createIsolatedPgTestEnvironment } from '../scripts/verify/isolated-pg-environment'

describe('database upgrade schema contract', () => {
  it('requires the exact admin index definitions and column order', () => {
    expect(() => assertAdminIndexDefinitions(new Map([
      ['ai_invocations_admin_telemetry_created_idx', 'CREATE INDEX ai_invocations_admin_telemetry_created_idx ON public.ai_invocations USING btree (telemetry_version, created_at DESC NULLS LAST)'],
      ['task_attempts_admin_status_created_idx', 'CREATE INDEX task_attempts_admin_status_created_idx ON public.task_attempts USING btree (status, created_at DESC NULLS LAST)'],
      ['task_attempts_admin_created_idx', 'CREATE INDEX task_attempts_admin_created_idx ON public.task_attempts USING btree (created_at DESC NULLS LAST)'],
    ]))).not.toThrow()

    expect(() => assertAdminIndexDefinitions(new Map([
      ['ai_invocations_admin_telemetry_created_idx', 'CREATE INDEX ai_invocations_admin_telemetry_created_idx ON public.ai_invocations USING btree (created_at DESC NULLS LAST, telemetry_version)'],
    ]))).toThrow('admin index definition mismatch')
  })

  it('requires the users_role_check enum constraint', () => {
    expect(() => assertUsersRoleCheckConstraint(
      "CHECK ((role = ANY (ARRAY['user'::text, 'admin'::text])))",
    )).not.toThrow()

    expect(() => assertUsersRoleCheckConstraint(
      "CHECK ((role = ANY (ARRAY['user'::text, 'member'::text])))",
    )).toThrow('users_role_check contract mismatch')
  })
})

describe('createIsolatedPgTestEnvironment', () => {
  it('overrides externally supplied developer database URLs', () => {
    const environment = createIsolatedPgTestEnvironment({
      DATABASE_URL: 'postgres://developer.example/dev',
      TEST_DATABASE_URL: 'postgres://developer.example/test',
      KEEP: 'value',
    }, 'postgres://postgres@127.0.0.1:55432/postgres')

    expect(environment).toMatchObject({
      DATABASE_URL: 'postgres://postgres@127.0.0.1:55432/postgres',
      TEST_DATABASE_URL: 'postgres://postgres@127.0.0.1:55432/postgres',
      KEEP: 'value',
    })
  })
})
