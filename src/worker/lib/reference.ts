// Chargement du catalogue de référence (ReferenceData) d'un groupe de
// joueurs, via la règle (ruleset) qui lui est assignée. Remplace l'ancien
// import statique de src/shared/reference-data.ts (qui ne couvrait que
// ADD40K) — chaque groupe a désormais son propre catalogue, stocké en JSON
// dans rulesets.reference_data (cf. migrations/0003_platform.sql).

import type { ReferenceData } from "../../shared/types";

interface RulesetRow {
  reference_data: string;
}

/**
 * Récupère le ReferenceData de la règle assignée à un groupe. Lève une
 * erreur si le groupe n'existe pas ou n'a pas de règle assignée — ne
 * devrait pas arriver en usage normal (un groupe est toujours créé avec une
 * règle, cf. routes/admin.ts), donc pas de valeur de repli silencieuse.
 */
export async function getReferenceDataForGroup(db: D1Database, groupId: string): Promise<ReferenceData> {
  const row = await db
    .prepare(
      `SELECT r.reference_data
       FROM player_groups g JOIN rulesets r ON r.id = g.ruleset_id
       WHERE g.id = ?1`,
    )
    .bind(groupId)
    .first<RulesetRow>();
  if (!row) throw new Error(`Groupe ou règle introuvable pour le groupe ${groupId}`);
  return JSON.parse(row.reference_data) as ReferenceData;
}

/**
 * Image du groupe (fond d'écran des écrans Personnages/Fiche/Suivi) — plus
 * un fond en dur (background.jpg) pour toute l'app : chaque groupe a la
 * sienne (ex. "/background.jpg" pour le groupe historique "add40k"), à
 * défaut le frontend retombe sur l'image plateforme (cf. CharacterList.tsx
 * et consorts). Null si le groupe n'existe pas ou n'a pas d'image.
 */
export async function getGroupImageUrl(db: D1Database, groupId: string): Promise<string | null> {
  const row = await db.prepare("SELECT image_url FROM player_groups WHERE id = ?1").bind(groupId).first<{ image_url: string | null }>();
  return row?.image_url ?? null;
}

/**
 * Dossier partagé (Google Drive...) du groupe — plus un lien en dur
 * spécifique à ADD40K sur l'écran "Personnages" : chaque groupe a le sien
 * (cf. migrations/0005_memberships.sql), null si non renseigné.
 */
export async function getGroupDriveUrl(db: D1Database, groupId: string): Promise<string | null> {
  const row = await db.prepare("SELECT drive_url FROM player_groups WHERE id = ?1").bind(groupId).first<{ drive_url: string | null }>();
  return row?.drive_url ?? null;
}

/**
 * Rang d'Action courant du round, écran "Suivi des constantes" — partagé
 * entre tous les MJ qui consultent ce groupe en même temps (cf.
 * migrations/0010_current_rank.sql), plutôt que local à l'onglet de chacun
 * comme avant (signalé : ne se mettait pas à jour sur une tablette quand un
 * autre MJ cliquait "Suivant"). 0 si le groupe n'existe pas.
 */
export async function getGroupCurrentRank(db: D1Database, groupId: string): Promise<number> {
  const row = await db.prepare("SELECT current_rank FROM player_groups WHERE id = ?1").bind(groupId).first<{ current_rank: number }>();
  return row?.current_rank ?? 0;
}
