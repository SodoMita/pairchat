import LocalChatView from "./LocalChatView";

// Static shell (see the room page for how dynamic segments stay static).
export const dynamicParams = true;
export function generateStaticParams() {
  return [];
}

export default function LocalChatPage() {
  return <LocalChatView />;
}
