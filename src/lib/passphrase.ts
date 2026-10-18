import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// OWASP's 32 MiB trade-off: N=2^15, r=8, p=3. Limit concurrent work to
// avoid turning password verification into an unbounded CPU/memory queue.
const globalWork = globalThis as typeof globalThis & { __cbScryptActive?: number };
async function derive(value: string, salt: Buffer): Promise<Buffer> {
  if ((globalWork.__cbScryptActive ?? 0) >= 2) throw new Error("Password verification busy");
  globalWork.__cbScryptActive = (globalWork.__cbScryptActive ?? 0) + 1;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(value, salt, 32, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key));
    });
  } finally { globalWork.__cbScryptActive!--; }
}

export async function hashPassphrase(value: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(value, salt);
  return `scrypt$32768$8$3$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassphrase(stored: string, value: string): Promise<{ valid: boolean; legacy: boolean }> {
  if (/^[a-f0-9]{64}$/.test(stored)) {
    const expected = Buffer.from(stored, "hex");
    return { valid: timingSafeEqual(expected, createHash("sha256").update(value).digest()), legacy: true };
  }
  const match = /^scrypt\$32768\$8\$3\$([a-f0-9]{32})\$([a-f0-9]{64})$/.exec(stored);
  if (!match) return { valid: false, legacy: false };
  const key = await derive(value, Buffer.from(match[1], "hex"));
  return { valid: timingSafeEqual(key, Buffer.from(match[2], "hex")), legacy: false };
}
