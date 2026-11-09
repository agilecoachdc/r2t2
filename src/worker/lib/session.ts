// Résolution de session D1 + middleware Hono. Sépare les primitives crypto
// (lib/auth.ts) de l'accès base de données, pour rester testable/lisible.

import type { Context, Next } from "hono";
import type { Language, PublicUser, UserRole } from "../../shared/types";
import { generateSessionToken, parseSessionCookie, sessionExpiry } from "./auth";
import { canAccessGroup, isGmOfGroup } from "../../shared/permissions";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

interface UserRow {
  id: string;
  username: string;
  display_name: string;
  role: UserRole;
  character_id: string | null;
  language: Language;
}

/**
 * Groupes dont un compte est membre *effectif* (cf. migrations/0005_memberships.sql)
 * — vide pour un admin. Ne renvoie que les appartenances `status = 'approved'` :
 * une demande d'adhésion encore `pending` (migrations/0006_join_approval.sql,
 * en attente d'un MJ du groupe) ne donne aucun accès tant qu'elle n'est pas
 * approuvée, exactement comme si le compte n'était pas membre.
 */
export async function getMembershipsForUser(db: D1Database, userId: string): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT group_id FROM group_memberships WHERE user_id = ?1 AND status = 'approved'")
    .bind(userId)
    .all<{ group_id: string }>();
  return (results ?? []).map((r) => r.group_id);
}

export function toPublicUser(row: UserRow, memberships: string[]): PublicUser {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    characterId: row.character_id,
    memberships,
    language: row.language,
  };
}

export async function createSession(db: D1Database, userId: string): Promise<string> {
  const token = generateSessionToken();
  await db
    .prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?1, ?2, ?3)")
    .bind(token, userId, sessionExpiry())
    .run();
  return token;
}

export async function destroySession(db: D1Database, token: string): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE token = ?1").bind(token).run();
}

export async function getUserForToken(db: D1Database, token: string): Promise<PublicUser | null> {
  const row = await db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.role, u.character_id, u.language
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ?1 AND s.expires_at > datetime('now')`,
    )
    .bind(token)
    .first<UserRow>();
  if (!row) return null;
  const memberships = await getMembershipsForUser(db, row.id);
  return toPublicUser(row, memberships);
}

type HonoEnv = { Bindings: Env; Variables: { user: PublicUser } };

/** Middleware : exige une session valide, sinon 401. Attache `user` au contexte. */
export async function requireAuth(c: Context<HonoEnv>, next: Next) {
  const token = parseSessionCookie(c.req.header("Cookie"));
  const user = token ? await getUserForToken(c.env.DB, token) : null;
  if (!user) {
    return c.json({ error: "Non authentifié" }, 401);
  }
  c.set("user", user);
  await next();
}

/**
 * Un joueur ne peut modifier que sa propre fiche ; le MJ peut modifier tout
 * personnage d'un groupe dont il est membre, l'admin tout personnage de
 * tout groupe (cf. shared/permissions.ts) (un compte peut désormais
 * appartenir à plusieurs groupes, cf. migrations/0005_memberships.sql).
 * `ownerUsername`/`characterGroupId` viennent de la ligne `characters`
 * visée — `characterGroupId` null pour une fiche pas encore rattachée à un
 * groupe (ne devrait plus arriver après migration).
 */
export function canEditCharacter(
  user: PublicUser,
  ownerUsername: string,
  characterGroupId: string | null,
): boolean {
  if (!canAccessGroup(user, characterGroupId)) return false;
  if (isGmOfGroup(user, characterGroupId)) return true;
  return user.username === ownerUsername;
}

/** Middleware : exige que l'utilisateur ait l'un des rôles donnés, sinon 403. */
export function requireRole(...roles: UserRole[]) {
  return async (c: Context<HonoEnv>, next: Next) => {
    const user = c.get("user");
    if (!roles.includes(user.role)) {
      return c.json({ error: "Accès réservé" }, 403);
    }
    await next();
  };
}
