import { NextResponse, type NextRequest } from "next/server";
import { authenticatedJson, bridgeResponse } from "@/lib/bridge/http";
import { getBridgeService } from "@/lib/bridge/runtime";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { token, body } = await authenticatedJson(request);
    const events = Array.isArray(body.events) ? body.events : [];
    return NextResponse.json(getBridgeService().appendEvents(
      token,
      id,
      Number(body.attempt),
      events as Array<{ seq: number; type: string; payload: unknown }>,
    ));
  } catch (error) {
    return bridgeResponse(error);
  }
}
