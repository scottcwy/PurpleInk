ALTER TABLE "canvas_nodes" DROP CONSTRAINT "canvas_nodes_status_check";--> statement-breakpoint
ALTER TABLE "canvas_nodes" ADD CONSTRAINT "canvas_nodes_status_check" CHECK ("canvas_nodes"."status" in (
        'idle', 'queued', 'running', 'succeeded', 'failed', 'cancelled', 'stale', 'skipped'
      ));