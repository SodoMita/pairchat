import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { rooms } from "@/db/schema";
import { getCurrentUser } from "@/lib/session";
import { listMessages, roomScope, partnerNameInSession } from "@/lib/chat";
import { RoomChatClient } from "./RoomChatClient";

export const dynamic = "force-dynamic";

type SerializedMessage = {
  id: string;
  scope: string;
  senderUserId: string;
  senderName: string;
  /** Always null for rooms; the wire shape is shared with stranger chats. */
  senderPubKey: string | null;
  body: string;
  createdAt: string;
  systemFlag: boolean;
};

type Params = { params: Promise<{ id: string }> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function RoomPage({ params }: Params) {
  const { id } = await params;

  // Reject malformed ids before they reach the DB so we don't surface a
  // 500 from the postgres uuid parser. notFound() renders a clean 404.
  if (!UUID_RE.test(id)) notFound();

  const user = await getCurrentUser();

  const rows = await db.select().from(rooms).where(eq(rooms.id, id)).limit(1);
  const room = rows[0];
  if (!room) notFound();

  // For closed rooms, still render the closed view (no chat UI).
  // If the visitor doesn't have a session yet (no cookie), they're not the
  // host — the API will create their user on first message send.
  const isHost = user ? room.hostUserId === user.id : false;

  const messageRows = await listMessages(roomScope(id));
  const initialMessages: SerializedMessage[] = messageRows.map((m) => ({
    ...m,
    senderPubKey: m.senderPubKey ?? null,
    createdAt: m.createdAt.toISOString(),
  }));

  let partnerName: string | null = null;
  if (user) {
    partnerName = await partnerNameInSession(roomScope(id), user.id);
  } else {
    // No session yet — pick the first non-system sender we see.
    const firstReal = initialMessages.find((m) => !m.systemFlag);
    partnerName = firstReal ? firstReal.senderName : null;
  }

  // Build absolute share URL from request headers.
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto =
    h.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  const origin = `${proto}://${host}`;
  const shareUrl = `${origin}/room/${room.id}`;

  return (
    <RoomChatClient
      userId={user?.id ?? null}
      userName={user?.displayName ?? null}
      roomId={room.id}
      inviteCode={room.inviteCode}
      isHost={isHost}
      closed={!!room.closedAt}
      initialMessages={initialMessages}
      initialPartnerName={partnerName}
      shareUrl={shareUrl}
    />
  );
}