import { getLaunchVideoController } from "@/lib/launch-video/runtime";

export async function POST(request: Request) {
  return getLaunchVideoController().create(request);
}
