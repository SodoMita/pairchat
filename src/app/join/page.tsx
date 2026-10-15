import { redirect } from "next/navigation";
import { findRoomByInviteCode } from "@/lib/chat";
import { JoinView } from "./JoinView";

export const dynamic = "force-dynamic";

type SearchParams = { code?: string };

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const code = params.code?.trim();
  if (code) {
    const room = await findRoomByInviteCode(code);
    if (room) redirect(`/room/${room.id}`);
  }
  return <JoinView />;
}