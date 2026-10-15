import ChatApp from "@/components/chat-app";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;
  return <ChatApp initialRoomId={roomId} />;
}
