import { getLaunchVideoController } from "@/lib/launch-video/runtime";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  return getLaunchVideoController().execute(request, (await context.params).id);
}
