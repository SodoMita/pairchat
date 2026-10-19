/**
 * Two-party crypto contract. Run with:
 *   npx --yes tsx scripts/e2ee-check.ts
 */
import {
  createEcdhCredentials,
  decryptMessage,
  encryptMessage,
  ensureSigningCredentials,
  getRoomCryptoKey,
  getRoomSafetyCode,
  serializePublicKey,
  serializeSigningKey,
  signEnvelope,
  verifyEnvelopeSignature,
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
const rightView: RoomSnapshot = {
  ...leftView,
  participantPublicId: leftView.partnerPublicId!,
  partnerPublicId: leftView.participantPublicId,
  partnerPublicKey: serializePublicKey(left),
  partnerSigningKey: serializeSigningKey(left),
};

const [leftCode, rightCode] = await Promise.all([
  getRoomSafetyCode(left, leftView),
  getRoomSafetyCode(right, rightView),
]);
check("safety codes agree", leftCode.length > 0 && leftCode === rightCode, leftCode);

const leftKey = await getRoomCryptoKey(left, leftView);
const rightKey = await getRoomCryptoKey(right, rightView);
const fromLeft = await encryptMessage(leftKey, roomId, leftView.participantPublicId, "hello from left");
const fromRight = await encryptMessage(rightKey, roomId, rightView.participantPublicId, "hello from right");
const signedLeft = { ...fromLeft, signature: await signEnvelope(left, roomId, fromLeft) };
const signedRight = { ...fromRight, signature: await signEnvelope(right, roomId, fromRight) };

check(
  "left verifies right",
  await verifyEnvelopeSignature(serializeSigningKey(right), roomId, signedRight),
);
check(
  "right verifies left",
  await verifyEnvelopeSignature(serializeSigningKey(left), roomId, signedLeft),
);
check(
  "right decrypts left",
  (await decryptMessage(rightKey, roomId, signedLeft)) === "hello from left",
);
check(
  "left decrypts right",
  (await decryptMessage(leftKey, roomId, signedRight)) === "hello from right",
);

const tampered = { ...signedLeft, ciphertext: signedLeft.ciphertext.slice(0, -2) + "AA" };
let rejected = false;
try {
  await decryptMessage(rightKey, roomId, tampered);
} catch {
  rejected = true;
}
check("tampered ciphertext is rejected", rejected);
check(
  "tampered signature is rejected",
  !(await verifyEnvelopeSignature(serializeSigningKey(left), roomId, {
    ...signedLeft,
    signature: signedLeft.signature.slice(0, -2) + "ab",
  })),
);

if (process.exitCode) {
  console.log("\nCRYPTO CONTRACT FAILED");
} else {
  console.log("\nCRYPTO CONTRACT PASSED");
}
}

void main();
