// Routes /api/games, /api/rulesets, /api/groups — en libre accès à tout
// compte authentifié (pas seulement admin) : parcourir les jeux/règles/
// groupes existants pour rejoindre un groupe (joueur ou MJ), en quitter un,
// en créer un nouveau (MJ), ou éditer ses propres réglages (MJ membre du
// groupe). Un compte peut désormais être membre de plusieurs groupes en
// même temps (cf. migrations/0005_memberships.sql). Le CRUD complet côté
// admin (catalogue détaillé d'une règle, gestion fine des membres par un
// tiers) reste sous /api/admin/* (routes/admin.ts) — ces routes-ci
// n'exposent que le nécessaire aux écrans joueur/MJ (page Profil).

import { Hono } from "hono";
import type { Env } from "../lib/session";
import { uniqueSlugId } from "../lib/ids";
import { canAccessGroup, isGmOfGroup } from "../../shared/permissions";
import type { Game, JoinRequest, PlayerGroup, PublicUser, ReferenceData, Ruleset } from "../../shared/types";

type HonoEnv = { Bindings: Env; Variables: { user: PublicUser } };

export const catalogRoutes = new Hono<HonoEnv>();

// ---------------------------------------------------------------------------
// Jeux — lecture seule ici (création/édition réservées à l'admin)
// ---------------------------------------------------------------------------

interface GameRow {
  id: string;
  name: string;
  description: string;
  image_url: string | null;
  created_at: string;
}

function toGame(row: GameRow): Game {
  return { id: row.id, name: row.name, description: row.description, imageUrl: row.image_url, createdAt: row.created_at };
}

catalogRoutes.get("/games", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, name, description, image_url, created_at FROM games ORDER BY name",
  ).all<GameRow>();
  return c.json({ games: (results ?? []).map(toGame) });
});

// ---------------------------------------------------------------------------
// Règles — résumé (sans catalogue complet), pour le sélecteur de création de groupe
// ---------------------------------------------------------------------------

interface RulesetRow {
  id: string;
  game_id: string;
  name: string;
  description: string;
  image_url: string | null;
  created_at: string;
}

function toRuleset(row: RulesetRow): Ruleset {
  return {
    id: row.id,
    gameId: row.game_id,
    name: row.name,
    description: row.description,
    imageUrl: row.image_url,
    createdAt: row.created_at,
  };
}

catalogRoutes.get("/rulesets", async (c) => {
  const gameId = c.req.query("gameId");
  const { results } = gameId
    ? await c.env.DB.prepare(
        "SELECT id, game_id, name, description, image_url, created_at FROM rulesets WHERE game_id = ?1 ORDER BY name",
      )
        .bind(gameId)
        .all<RulesetRow>()
    : await c.env.DB.prepare(
        "SELECT id, game_id, name, description, image_url, created_at FROM rulesets ORDER BY name",
      ).all<RulesetRow>();
  return c.json({ rulesets: (results ?? []).map(toRuleset) });
});

// ---------------------------------------------------------------------------
// Groupes — parcourir, rejoindre/quitter, ou (MJ) créer/éditer les siens
// ---------------------------------------------------------------------------

interface GroupRow {
  id: string;
  name: string;
  description: string;
  ruleset_id: string;
  image_url: string | null;
  drive_url: string | null;
  created_at: string;
}

function toGroup(row: GroupRow): PlayerGroup {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    rulesetId: row.ruleset_id,
    imageUrl: row.image_url,
    driveUrl: row.drive_url,
    createdAt: row.created_at,
  };
}

const GROUP_COLUMNS = "id, name, description, ruleset_id, image_url, drive_url, created_at";

catalogRoutes.get("/groups", async (c) => {
  const { results } = await c.env.DB.prepare(`SELECT ${GROUP_COLUMNS} FROM player_groups ORDER BY name`).all<GroupRow>();
  return c.json({ groups: (results ?? []).map(toGroup) });
});

// Demander à rejoindre un groupe existant — joueur ou MJ (un admin
// n'appartient à aucun groupe par construction, cf. lib/session.ts
// requireRole/canEditCharacter). N'accorde plus l'accès immédiatement :
// ouvre une ligne 'pending' qu'un MJ du groupe doit approuver (cf.
// migrations/0006_join_approval.sql, GET/POST/DELETE .../join-requests
// ci-dessous) — `user.memberships` (approuvées uniquement) ne change donc
// pas ici. Idempotent : redemander alors qu'une demande est déjà pending ou
// déjà membre ne fait rien de plus.
catalogRoutes.post("/groups/join", async (c) => {
  const user = c.get("user");
  if (user.role === "admin") return c.json({ error: "Un compte admin n'appartient à aucun groupe" }, 403);

  const body = await c.req.json<{ groupId?: string }>().catch(() => null);
  if (!body?.groupId) return c.json({ error: "Groupe requis" }, 400);

  const group = await c.env.DB.prepare("SELECT 1 FROM player_groups WHERE id = ?1").bind(body.groupId).first();
  if (!group) return c.json({ error: "Groupe introuvable" }, 404);

  const existing = await c.env.DB.prepare("SELECT status FROM group_memberships WHERE user_id = ?1 AND group_id = ?2")
    .bind(user.id, body.groupId)
    .first<{ status: "pending" | "approved" }>();

  if (!existing) {
    await c.env.DB.prepare("INSERT INTO group_memberships (user_id, group_id, status) VALUES (?1, ?2, 'pending')")
      .bind(user.id, body.groupId)
      .run();
  }
  return c.json({ user, status: existing?.status ?? "pending" });
});

// Quitter un groupe (ou annuler sa demande d'adhésion en attente) — pas
// d'effet si on n'en était pas membre et n'avait pas de demande en cours.
catalogRoutes.post("/groups/leave", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ groupId?: string }>().catch(() => null);
  if (!body?.groupId) return c.json({ error: "Groupe requis" }, 400);

  await c.env.DB.prepare("DELETE FROM group_memberships WHERE user_id = ?1 AND group_id = ?2")
    .bind(user.id, body.groupId)
    .run();
  const updated: PublicUser = { ...user, memberships: user.memberships.filter((id) => id !== body.groupId) };
  return c.json({ user: updated });
});

// ---------------------------------------------------------------------------
// Demandes d'adhésion en attente — réservé au MJ membre (approuvé) du groupe
// ciblé (cf. migrations/0006_join_approval.sql). L'admin garde son propre
// raccourci d'ajout direct (POST /api/admin/groups/:id/members), qui reste
// une approbation immédiate sans passer par ce circuit.
// ---------------------------------------------------------------------------

catalogRoutes.get("/groups/:id/join-requests", async (c) => {
  const user = c.get("user");
  const groupId = c.req.param("id");
  if (!isGmOfGroup(user, groupId)) return c.json({ error: "Réservé au MJ de ce groupe" }, 403);

  const { results } = await c.env.DB.prepare(
    `SELECT u.id as user_id, u.username, u.display_name, gm.created_at as requested_at
     FROM group_memberships gm JOIN users u ON u.id = gm.user_id
     WHERE gm.group_id = ?1 AND gm.status = 'pending' ORDER BY gm.created_at`,
  )
    .bind(groupId)
    .all<{ user_id: string; username: string; display_name: string; requested_at: string }>();

  const requests: JoinRequest[] = (results ?? []).map((r) => ({
    userId: r.user_id,
    username: r.username,
    displayName: r.display_name,
    requestedAt: r.requested_at,
  }));
  return c.json({ requests });
});

catalogRoutes.post("/groups/:id/join-requests/:userId/approve", async (c) => {
  const user = c.get("user");
  const groupId = c.req.param("id");
  if (!isGmOfGroup(user, groupId)) return c.json({ error: "Réservé au MJ de ce groupe" }, 403);

  const { meta } = await c.env.DB.prepare(
    "UPDATE group_memberships SET status = 'approved' WHERE group_id = ?1 AND user_id = ?2 AND status = 'pending'",
  )
    .bind(groupId, c.req.param("userId"))
    .run();
  if (meta.changes === 0) return c.json({ error: "Demande introuvable" }, 404);
  return c.json({ ok: true });
});

catalogRoutes.delete("/groups/:id/join-requests/:userId", async (c) => {
  const user = c.get("user");
  const groupId = c.req.param("id");
  if (!isGmOfGroup(user, groupId)) return c.json({ error: "Réservé au MJ de ce groupe" }, 403);

  await c.env.DB.prepare("DELETE FROM group_memberships WHERE group_id = ?1 AND user_id = ?2 AND status = 'pending'")
    .bind(groupId, c.req.param("userId"))
    .run();
  return c.json({ ok: true });
});

// Catalogue complet (ReferenceData) de la règle assignée à ce groupe, avec
// le nom de la règle et du jeu — alimente la page Documentation (accessible
// depuis l'écran "Personnages" du groupe), pour afficher les règles du jeu
// réellement utilisées par cette table sans passer par /api/admin/*.
// Ouvert à tout membre approuvé du groupe (joueur ou MJ), pas seulement au
// MJ : consulter les règles est utile à tous.
catalogRoutes.get("/groups/:id/reference", async (c) => {
  const user = c.get("user");
  const groupId = c.req.param("id");
  if (!canAccessGroup(user, groupId)) return c.json({ error: "Non membre de ce groupe" }, 403);

  const row = await c.env.DB.prepare(
    `SELECT g.name AS group_name, r.name AS ruleset_name, r.reference_data, ga.name AS game_name
     FROM player_groups g
     JOIN rulesets r ON r.id = g.ruleset_id
     JOIN games ga ON ga.id = r.game_id
     WHERE g.id = ?1`,
  )
    .bind(groupId)
    .first<{ group_name: string; ruleset_name: string; reference_data: string; game_name: string }>();
  if (!row) return c.json({ error: "Groupe introuvable" }, 404);

  const referenceData: ReferenceData = JSON.parse(row.reference_data);
  return c.json({
    referenceData,
    groupName: row.group_name,
    rulesetName: row.ruleset_name,
    gameName: row.game_name,
  });
});

// Créer un nouveau groupe — réservé au MJ (un joueur rejoint une table déjà
// menée par un MJ, il n'en crée pas). Le MJ créateur en devient
// automatiquement membre — un MJ doit être membre d'un groupe pour y créer
// des PNJ ou y gérer des personnages (cf. characters.ts). Un MJ peut créer
// et gérer plusieurs groupes en parallèle.
catalogRoutes.post("/groups", async (c) => {
  const user = c.get("user");
  if (user.role !== "gm") return c.json({ error: "Réservé au MJ" }, 403);

  const body = await c.req
    .json<{ name?: string; description?: string; rulesetId?: string; imageUrl?: string | null; driveUrl?: string | null }>()
    .catch(() => null);
  if (!body?.name?.trim() || !body.rulesetId) return c.json({ error: "Nom et règle requis" }, 400);

  const ruleset = await c.env.DB.prepare("SELECT 1 FROM rulesets WHERE id = ?1").bind(body.rulesetId).first();
  if (!ruleset) return c.json({ error: "Règle introuvable" }, 404);

  const id = await uniqueSlugId(c.env.DB, "player_groups", body.name);
  await c.env.DB.prepare(
    "INSERT INTO player_groups (id, name, description, ruleset_id, image_url, drive_url) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
  )
    .bind(id, body.name.trim(), body.description?.trim() ?? "", body.rulesetId, body.imageUrl ?? null, body.driveUrl ?? null)
    .run();
  await c.env.DB.prepare("INSERT INTO group_memberships (user_id, group_id) VALUES (?1, ?2)").bind(user.id, id).run();

  const row = await c.env.DB.prepare(`SELECT ${GROUP_COLUMNS} FROM player_groups WHERE id = ?1`).bind(id).first<GroupRow>();
  const updatedUser: PublicUser = { ...user, memberships: [...user.memberships, id] };
  return c.json({ group: toGroup(row!), user: updatedUser }, 201);
});

// Éditer les réglages de son propre groupe — réservé au MJ membre de ce
// groupe (pas besoin de passer par l'admin pour personnaliser son dossier
// Drive, son image, etc.).
catalogRoutes.put("/groups/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  if (!isGmOfGroup(user, id)) {
    return c.json({ error: "Réservé au MJ de ce groupe" }, 403);
  }

  const existing = await c.env.DB.prepare(`SELECT ${GROUP_COLUMNS} FROM player_groups WHERE id = ?1`).bind(id).first<GroupRow>();
  if (!existing) return c.json({ error: "Groupe introuvable" }, 404);

  const body = await c.req
    .json<{
      name?: string;
      description?: string;
      rulesetId?: string;
      imageUrl?: string | null;
      driveUrl?: string | null;
    }>()
    .catch(() => null);

  if (body?.rulesetId) {
    const ruleset = await c.env.DB.prepare("SELECT 1 FROM rulesets WHERE id = ?1").bind(body.rulesetId).first();
    if (!ruleset) return c.json({ error: "Règle introuvable" }, 404);
  }

  const name = body?.name?.trim() || existing.name;
  const description = body?.description ?? existing.description;
  const rulesetId = body?.rulesetId ?? existing.ruleset_id;
  const imageUrl = body?.imageUrl !== undefined ? body.imageUrl : existing.image_url;
  const driveUrl = body?.driveUrl !== undefined ? body.driveUrl : existing.drive_url;

  await c.env.DB.prepare(
    "UPDATE player_groups SET name = ?1, description = ?2, ruleset_id = ?3, image_url = ?4, drive_url = ?5 WHERE id = ?6",
  )
    .bind(name, description, rulesetId, imageUrl, driveUrl, id)
    .run();

  const group: PlayerGroup = { id, name, description, rulesetId, imageUrl, driveUrl, createdAt: existing.created_at };
  return c.json({ group });
});
