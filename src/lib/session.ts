import "server-only";
import { cookies } from "next/headers";
import { randomBytes, createHash } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { db } from "@/db";
import { sessions, users, type User } from "@/db/schema";
import { admissionKey, HttpError, limit } from "@/lib/request-security";

export const SESSION_COOKIE = "roulette_session_v2";
export const SESSION_NAME_COOKIE = "roulette_name";
const MAX_AGE = 30 * 24 * 60 * 60;
const tokenHash = (value: string) => createHash("sha256").update(value).digest("hex");

export type AuthenticatedUser = User & { sessionExpiresAt: Date };
export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [found] = await db.select({ user: users, expiresAt: sessions.expiresAt }).from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, tokenHash(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return found ? { ...found.user, sessionExpiresAt: found.expiresAt } : null;
}

export async function requireUser(): Promise<AuthenticatedUser> {
  const user = await getCurrentUser();
  if (!user) throw new HttpError(401, "Session required");
  return user;
}

/** Only explicit entry/bootstrap routes may issue a new session. */
export async function getOrCreateUser(req?: Request): Promise<User> {
  const current = await getCurrentUser();
  if (current) return current;
  limit(`session-issue:${req ? admissionKey(req) : "shared"}`, 60, 0.25);
  const adjectives = ["Calm", "Cosmic", "Sunny", "Mellow", "Brave", "Witty"];
  const animals = ["otter", "panda", "fox", "lynx", "whale", "raven", "gecko"];
  const displayName = `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${animals[Math.floor(Math.random() * animals.length)]}`;
  const token = randomBytes(32).toString("base64url");
  const user = await db.transaction(async tx => {
    const [created] = await tx.insert(users).values({ displayName }).returning();
    await tx.insert(sessions).values({ userId: created.id, tokenHash: tokenHash(token), expiresAt: new Date(Date.now() + MAX_AGE * 1000) });
    return created;
  });
  // Old PID-signed sessions are intentionally not migrated or trusted.
  const jar = await cookies();
  const options = { path: "/", sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", maxAge: MAX_AGE };
  jar.set(SESSION_COOKIE, token, { ...options, httpOnly: true });
  jar.set(SESSION_NAME_COOKIE, user.displayName, options);
  jar.delete("roulette_uid");
  // Expiry is enforced on every read, irrespective of browser cookie expiry.
  void db.delete(sessions).where(lt(sessions.expiresAt, new Date())).catch(() => {});
  return user;
}
