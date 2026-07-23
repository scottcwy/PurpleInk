import { NextResponse, type NextRequest } from "next/server";
import { bridgeResponse } from "@/lib/bridge/http";
import { getBridgeService } from "@/lib/bridge/runtime";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, string>;
    return NextResponse.json(await getBridgeService().pair({
      code: body.code ?? "",
      publicKey: body.publicKey ?? "",
      bridgeVersion: body.bridgeVersion ?? "",
      egoVersion: body.egoVersion ?? "",
      label: body.label ?? "",
    }));
  } catch (error) {
    return bridgeResponse(error);
  }
}
