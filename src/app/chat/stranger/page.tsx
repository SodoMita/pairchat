import { getCurrentUser } from "@/lib/session";
import { getActiveStrangerSession, listMessages, partnerNameInSession, strangerScope } from "@/lib/chat";
import { StrangerChatClient } from "./StrangerChatClient";

export const dynamic = "force-dynamic";

type SerializedMessage = {
  id: string;
  scope: string;
  senderUserId: string;
  senderName: string;
  body: string;
  senderPubKey: string | null;
  createdAt: string;
  systemFlag: boolean;
};

export default async function StrangerChatPage() {
  // Server components can't write cookies, so the StrangerChatClient
  // will fetch/establish identity via API calls if needed.
  const user = await getCurrentUser();

  let initialMessages: SerializedMessage[] = [];
  let initialSession: { sessionId: string; partnerId: string | null } | null = null;
  let initialPartnerName: string | null = null;

  if (user) {
    const session = await getActiveStrangerSession(user.id);
    if (session) {
      initialSession = { sessionId: session.sessionId, partnerId: session.partnerId };
      const rows = await listMessages(strangerScope(session.sessionId));
      initialMessages = rows.map((r) => ({
        ...r,
        senderPubKey: r.senderPubKey ?? null,
        createdAt: r.createdAt.toISOString(),
      }));
      initialPartnerName = await partnerNameInSession(
        strangerScope(session.sessionId),
        user.id,
      );
    }
  }

  return (
    <StrangerChatClient
      userId={user?.id ?? null}
      userName={user?.displayName ?? null}
      initialSession={initialSession}
      initialMessages={initialMessages}
      initialPartnerName={initialPartnerName}
    />
  );
}