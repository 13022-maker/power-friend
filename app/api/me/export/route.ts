import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/session";
import { exportUserData } from "@/lib/services";

export async function GET() {
  const uid = await currentUserId();
  const data = await exportUserData(uid);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="power-friend-${uid}.json"`,
    },
  });
}
