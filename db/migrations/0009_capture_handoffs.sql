CREATE TABLE capture_handoffs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  job_id uuid NOT NULL,
  attempt integer NOT NULL,
  token_hash text NOT NULL,
  remote_control_url text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT capture_handoffs_pkey PRIMARY KEY (workspace_id,id),
  CONSTRAINT capture_handoffs_workspace_job_fk
    FOREIGN KEY (workspace_id,job_id) REFERENCES capture_worker_jobs(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT capture_handoffs_attempt_check CHECK (attempt > 0),
  CONSTRAINT capture_handoffs_token_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT capture_handoffs_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT capture_handoffs_close_check CHECK (closed_at IS NULL OR closed_at >= created_at)
);

CREATE UNIQUE INDEX capture_handoffs_one_open_per_job
  ON capture_handoffs(workspace_id,job_id)
  WHERE closed_at IS NULL;
