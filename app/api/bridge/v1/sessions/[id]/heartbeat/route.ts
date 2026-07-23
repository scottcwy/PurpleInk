import { NextResponse, type NextRequest } from "next/server";
import { authenticatedJson, bridgeResponse } from "@/lib/bridge/http";
import { getBridgeService } from "@/lib/bridge/runtime";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { token, body } = await authenticatedJson(request);
    const reportedState = body.reportedState;
    if (reportedState !== "running" && reportedState !== "awaiting_user") {
      throw new Error("Invalid reported state");
    }
    return NextResponse.json(getBridgeService().heartbeat(token, id, Number(body.attempt), {
      reportedState,
      ...(body.resumeConfirmed === true ? { resumeConfirmed: true } : {}),
      ...(typeof body.currentNodeId === "string" ? { currentNodeId: body.currentNodeId } : {}),
      ...(typeof body.currentActionId === "string" ? { currentActionId: body.currentActionId } : {}),
    }));
  } catch (error) {
    return bridgeResponse(error);
  }
}
