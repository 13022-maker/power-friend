import { NextResponse } from "next/server";
import { repo } from "@/lib/data";
import { currentUserId } from "@/lib/session";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const uid = await currentUserId();
  const conv = await repo().getConversation(id);
  if (!conv || (conv.buyerId !== uid && conv.sellerId !== uid)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json(await repo().listMessages(id));
}
