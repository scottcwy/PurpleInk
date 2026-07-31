ALTER TABLE "canvas_nodes" DROP CONSTRAINT "canvas_nodes_type_check";--> statement-breakpoint
ALTER TABLE "canvas_nodes" ADD CONSTRAINT "canvas_nodes_type_check" CHECK ("canvas_nodes"."type" in (
        'script-import', 'shot-split', 'score', 'export', 'shot-script',
        'shot-codegen', 'shot-sfx', 'shot-subtitle', 'shot-qa',
        'audio-transcribe', 'website-stage'
      ));