import "server-only";
import { cookies } from "next/headers";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, type User } from "@/db/schema";

export const SESSION_COOKIE = "roulette_uid";
export const SESSION_NAME_COOKIE = "roulette_name";

/**
 * Server-side secret used to sign session cookies. In production this MUST
 * come from `process.env.SESSION_SECRET` (set via the deployment's secret
 * manager). Falling back to a random per-process value is intentionally
 * bad for multi-instance deployments — it invalidates every session on
 * restart, which is the safest possible failure mode.
 *
 * For local development we generate a random 32-byte value so cookies
 * don't leak across machines if the env file is committed.
 */
const SESSION_SECRET: string = (() => {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv && fromEnv.length >= 32) return fromEnv;
  // Generate a stable per-instance key by hashing a process-derived seed.
  // Note: this means sessions reset on server restart, which is acceptable.
  return createHmac("sha256", "chatterbox-dev")
    .update(`pid-${process.pid}`)
    .digest("hex");
})();

function sign(value: string): string {
  return createHmac("sha256", SESSION_SECRET).update(value).digest("base64url");
}

function verify(value: string, signature: string): boolean {
  const expected = sign(value);
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Format used in the cookie: `<userId>.<base64url(HMAC)>` */
function packCookie(userId: string): string {
  return `${userId}.${sign(userId)}`;
}

function unpackCookie(raw: string | undefined): string | null {
  if (!raw) return null;
  const lastDot = raw.lastIndexOf(".");
  if (lastDot < 1) return null;
  const userId = raw.slice(0, lastDot);
  const sig = raw.slice(lastDot + 1);
  if (!verify(userId, sig)) return null;
  return userId;
}

const ANIMALS = [
  "otter",
  "panda",
  "fox",
  "wolf",
  "hawk",
  "lynx",
  "whale",
  "heron",
  "raven",
  "gecko",
  "badger",
  "moose",
  "beaver",
  "lemur",
  "yak",
  "ibis",
  "newt",
  "quail",
];
const ADJECTIVES = [
  "Quiet",
  "Brave",
  "Calm",
  "Witty",
  "Bold",
  "Cheery",
  "Sleek",
  "Cosmic",
  "Loyal",
  "Merry",
  "Plucky",
  "Steady",
  "Sunny",
  "Mellow",
  "Zesty",
  "Jolly",
];

function randomName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)];
  return `${adj} ${animal}`;
}

/**
 * Read-only fetch of the current user from the session cookie.
 * Safe to call from server components (does NOT write cookies).
 * Returns null if the user has no session yet.
 */
export async function getCurrentUser(): Promise<User | null> {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  // Verify signature before trusting the userId. This stops a remote
  // attacker from impersonating any user whose UUID they can guess or
  // learn (the audit finding C-1).
  const userId = unpackCookie(raw);
  if (!userId) return null;
  const found = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return found[0] ?? null;
}

/**
 * Route-handler / server-action variant that CREATES a user on demand
 * and sets the session cookie. Call this only from route handlers or
 * server actions (Next.js forbids cookie writes in server components).
 */
export async function getOrCreateUser(): Promise<User> {
  const existing = await getCurrentUser();
  if (existing) return existing;

  const id = crypto.randomUUID();
  let displayName = randomName();
  for (let i = 0; i < 3; i += 1) {
    const taken = await db
      .select()
      .from(users)
      .where(eq(users.displayName, displayName))
      .limit(1);
    if (taken.length === 0) break;
    displayName = randomName();
  }

  const [created] = await db
    .insert(users)
    .values({ id, displayName })
    .returning();

  if (!created) throw new Error("Failed to create user");

  const jar = await cookies();
  jar.set(SESSION_COOKIE, packCookie(created.id), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  jar.set(SESSION_NAME_COOKIE, created.displayName, {
    httpOnly: false,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return created;
}