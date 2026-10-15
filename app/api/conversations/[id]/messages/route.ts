import { NextResponse } from "next/server";
import { repo } from "@/lib/data";
import { apiUserId } from "@/lib/session";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const uid = await apiUserId();
  if (!uid) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const conv = await repo().getConversation(id);
  if (!conv || (conv.buyerId !== uid && conv.sellerId !== uid)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json(await repo().listMessages(id));
}
