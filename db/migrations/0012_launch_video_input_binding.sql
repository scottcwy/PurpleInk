ALTER TABLE launch_video_jobs ADD COLUMN input_fingerprint text;

-- Legacy jobs cannot be retried under the stronger full-input contract.
UPDATE launch_video_jobs
SET input_fingerprint = repeat('0', 64)
WHERE input_fingerprint IS NULL;

ALTER TABLE launch_video_jobs ALTER COLUMN input_fingerprint SET NOT NULL;
ALTER TABLE launch_video_jobs ADD CONSTRAINT launch_video_jobs_input_fingerprint_check
  CHECK (input_fingerprint ~ '^[0-9a-f]{64}$');
