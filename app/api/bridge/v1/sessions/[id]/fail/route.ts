import { NextResponse, type NextRequest } from "next/server";
import { authenticatedJson, bridgeResponse } from "@/lib/bridge/http";
import { getBridgeService } from "@/lib/bridge/runtime";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { token, body } = await authenticatedJson(request);
    return NextResponse.json(getBridgeService().fail(token, id, Number(body.attempt), {
      errorCode: typeof body.errorCode === "string" ? body.errorCode : "",
      diagnostic: typeof body.diagnostic === "string" ? body.diagnostic : "",
    }));
  } catch (error) {
    return bridgeResponse(error);
  }
}
