import { NextResponse, type NextRequest } from "next/server";
import { bridgeResponse } from "@/lib/bridge/http";
import { getBridgeService } from "@/lib/bridge/runtime";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, string>;
    return NextResponse.json(getBridgeService().createAccessToken({
      deviceId: body.deviceId ?? "",
      deviceCredential: body.deviceCredential ?? "",
      timestamp: body.timestamp ?? "",
      nonce: body.nonce ?? "",
      signature: body.signature ?? "",
    }));
  } catch (error) {
    return bridgeResponse(error);
  }
}
