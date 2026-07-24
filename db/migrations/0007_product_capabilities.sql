CREATE TABLE product_capabilities (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  product_id uuid NOT NULL,
  name text NOT NULL,
  description text NOT NULL,
  status text DEFAULT 'active' NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT product_capabilities_pkey PRIMARY KEY (workspace_id,id),
  CONSTRAINT product_capabilities_workspace_product_fk
    FOREIGN KEY (workspace_id,product_id) REFERENCES products(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT product_capabilities_status_check CHECK (status IN ('active','archived'))
);

CREATE UNIQUE INDEX product_capabilities_active_name_unique
  ON product_capabilities(workspace_id,product_id,name)
  WHERE status = 'active';
