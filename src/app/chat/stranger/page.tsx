import { StrangerChatClient } from "./StrangerChatClient";

// Static shell. Identity, matching and history all arrive over the API /
// event stream after load, so nothing here is rendered per request.
export default function StrangerChatPage() {
  return <StrangerChatClient />;
}
