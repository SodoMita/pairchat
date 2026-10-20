import { isCanvasEnabled } from "@/lib/canvas-flag";
import { CANVAS_HEIGHT, CANVAS_PROTOCOL, CANVAS_WIDTH } from "@/lib/canvas";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    enabled: isCanvasEnabled(),
    protocol: CANVAS_PROTOCOL,
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
  });
}
