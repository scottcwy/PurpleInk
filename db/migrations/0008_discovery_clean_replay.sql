ALTER TABLE discovery_runs
  ADD COLUMN clean_replay_manifest_hash text,
  ADD COLUMN clean_replay_worker_image_digest text,
  ADD COLUMN clean_replay_passed_at timestamptz;

ALTER TABLE discovery_runs ADD CONSTRAINT discovery_runs_clean_replay_presence_check
  CHECK (
    (clean_replay_manifest_hash IS NULL
      AND clean_replay_worker_image_digest IS NULL
      AND clean_replay_passed_at IS NULL)
    OR
    (clean_replay_manifest_hash ~ '^[0-9a-f]{64}$'
      AND clean_replay_worker_image_digest ~ '^sha256:[0-9a-f]{64}$'
      AND clean_replay_passed_at IS NOT NULL)
  );
