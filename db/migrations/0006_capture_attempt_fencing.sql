ALTER TABLE capture_worker_jobs ADD COLUMN payload jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE capture_sessions ADD COLUMN current_job_id uuid;
ALTER TABLE capture_sessions ADD COLUMN current_attempt integer DEFAULT 0 NOT NULL;
ALTER TABLE capture_sessions ADD CONSTRAINT capture_sessions_current_attempt_check
  CHECK (current_attempt >= 0);
ALTER TABLE capture_sessions ADD CONSTRAINT capture_sessions_workspace_current_job_fk
  FOREIGN KEY (workspace_id,current_job_id)
  REFERENCES capture_worker_jobs(workspace_id,id) ON DELETE RESTRICT;
