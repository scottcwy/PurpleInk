import { getLaunchVideoController } from "@/lib/launch-video/runtime";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  return getLaunchVideoController().callback(request, (await context.params).id);
}
