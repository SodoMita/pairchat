import ChatApp from "@/components/chat-app";

/**
 * Static shell for `/r/<roomId>` (rewritten in next.config.ts).
 * The room id and the `#k=` invite secret are read from the browser URL, so
 * this page needs no request-time data and can be prerendered once.
 */
export default function InviteShellPage() {
  return <ChatApp />;
}
