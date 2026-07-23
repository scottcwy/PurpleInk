import { NextResponse, type NextRequest } from "next/server";
import { authenticatedEmpty, bridgeResponse } from "@/lib/bridge/http";
import { getBridgeService } from "@/lib/bridge/runtime";

export async function GET(request: NextRequest) {
  try {
    const token = authenticatedEmpty(request);
    const waitSeconds = Math.min(25, Math.max(0, Number(request.nextUrl.searchParams.get("wait") ?? 25)));
    const deadline = Date.now() + waitSeconds * 1_000;
    do {
      const session = getBridgeService().nextSession(token);
      if (session) return NextResponse.json(session);
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    } while (true);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return bridgeResponse(error);
  }
}
