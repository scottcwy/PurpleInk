import { NextResponse, type NextRequest } from "next/server";
import { authenticatedJson, bridgeResponse } from "@/lib/bridge/http";
import { getBridgeService } from "@/lib/bridge/runtime";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { token, body } = await authenticatedJson(request);
    return NextResponse.json(await getBridgeService().signUploads(
      token,
      id,
      Number(body.attempt),
      Array.isArray(body.entries) ? body.entries : [],
    ));
  } catch (error) {
    return bridgeResponse(error);
  }
}
