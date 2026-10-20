import {
  CANVAS_HEIGHT,
  CANVAS_PROTOCOL,
  CANVAS_WIDTH,
  decryptCanvasEvent,
  encryptCanvasEvent,
  isCompatibleInvite,
  signCanvasEnvelope,
  verifyCanvasEnvelope,
} from "../src/lib/canvas";
import {
  createEcdhCredentials,
  ensureSigningCredentials,
  serializePublicKey,
  serializeSigningKey,
} from "../src/lib/e2ee";
import type { RoomSnapshot } from "../src/lib/chat";

function check(name: string, ok: boolean, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
  if (!ok) process.exitCode = 1;
}

async function main() {
  const roomId = "r_" + "ab".repeat(16);
  const [left, right] = await Promise.all([
    ensureSigningCredentials(await createEcdhCredentials()),
    ensureSigningCredentials(await createEcdhCredentials()),
  ]);
  const leftView: RoomSnapshot = {
    id: roomId,
    kind: "random",
    status: "active",
    partnerPresent: true,
    partnerOnline: true,
    participantPublicId: "11111111-1111-4111-8111-111111111111",
    partnerPublicId: "22222222-2222-4222-8222-222222222222",
    partnerPublicKey: serializePublicKey(right),
    partnerSigningKey: serializeSigningKey(right),
    participantActive: true,
    createdAt: new Date().toISOString(),
  };
  const sessionId = crypto.randomUUID();
  const unsigned = await encryptCanvasEvent(left, leftView, leftView.participantPublicId, sessionId, 1, 0, {
    type: "invite",
    protocol: CANVAS_PROTOCOL,
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
    units: "normalized",
    brushes: ["#1e2927"],
  });
  const envelope = { ...unsigned, signature: await signCanvasEnvelope(left, roomId, unsigned) };
  const rightView: RoomSnapshot = {
    ...leftView,
    participantPublicId: leftView.partnerPublicId!,
    partnerPublicId: leftView.participantPublicId,
    partnerPublicKey: serializePublicKey(left),
    partnerSigningKey: serializeSigningKey(left),
  };
  check("canvas signature verifies", await verifyCanvasEnvelope(serializeSigningKey(left), roomId, envelope));
  const event = await decryptCanvasEvent(right, rightView, envelope);
  check("invite decrypts", event.type === "invite" && isCompatibleInvite(event));
  const tampered = { ...envelope, sessionId: crypto.randomUUID() };
  let rejected = false;
  try {
    await decryptCanvasEvent(right, rightView, tampered);
  } catch {
    rejected = true;
  }
  check("tampered session is rejected", rejected);
}

void main().then(() => {
  console.log(process.exitCode ? "\nCANVAS CONTRACT FAILED" : "\nCANVAS CONTRACT PASSED");
});
