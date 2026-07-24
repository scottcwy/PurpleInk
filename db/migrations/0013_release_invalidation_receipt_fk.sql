ALTER TABLE release_invalidations
  ADD CONSTRAINT release_invalidations_workspace_receipt_fk
  FOREIGN KEY (workspace_id,command_receipt_id)
  REFERENCES command_receipts(workspace_id,id)
  ON DELETE RESTRICT;
