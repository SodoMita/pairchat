import { JoinView } from "./JoinView";

// Static. Invite codes are resolved by the room page itself (POST /enter
// accepts either a room id or an invite code), so this page needs no
// per-request lookup or redirect.
export default function JoinPage() {
  return <JoinView />;
}
