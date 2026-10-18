import { RoomChatClient } from "./RoomChatClient";

// Static shell for every room id. `generateStaticParams` opts the dynamic
// segment into static generation (pages for unseen ids are generated once
// on first request and then cached); the client reads the id from the URL
// and resolves everything else via POST /api/rooms/[id]/enter.
export const dynamicParams = true;
export function generateStaticParams() {
  return [];
}

export default function RoomPage() {
  return <RoomChatClient />;
}
