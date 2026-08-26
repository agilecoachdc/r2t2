// Routes /api/characters/* — voir docs/API_REFERENCE.md.
// Un compte peut être membre de plusieurs groupes en même temps (cf.
// migrations/0005_memberships.sql) : la liste/création prennent désormais
// un ?groupId= explicite (au lieu de l'ancien user.playerGroupId unique) —
// require une appartenance à ce groupe (user.memberships). Lecture d'une
// fiche ouverte à tout membre du groupe du personnage (utile en jeu pour
// consulter la fiche d'un coéquipier) ; écriture réservée au propriétaire
// ou à un MJ membre du même groupe (canEditCharacter, lib/session.ts).
// Création (PNJ) réservée au MJ. Le catalogue de référence (ReferenceData)
// n'est plus un import statique ADD40K : il est chargé dynamiquement depuis
// la règle assignée au groupe (getReferenceDataForGroup, lib/reference.ts)
// et renvoyé dans chaque réponse pour que le frontend n'ait pas à
// l'importer lui-même.

import { Hono } from "hono";
import type { Env } from "../lib/session";
import { canEditCharacter } from "../lib/session";
import { getGroupDriveUrl, getGroupImageUrl, getReferenceDataForGroup } from "../lib/reference";
import type { PublicUser } from "../../shared/types";
import type { AttributeScores, Character, CharacterSummary, ReferenceData } from "../../shared/types";
import { ATTRIBUTES } from "../../shared/types";
import {
  computeCharacter,
  getAdvantagesNet,
  getBoostedAttributes,
  getBoostedSkillNames,
  getMonthlyIncome,
  getPsyPowerActivationCost,
  getPsyPowersCostTotal,
  getSkillsCostTotal,
} from "../../shared/calc-engine";

type HonoEnv = { Bindings: Env; Variables: { user: PublicUser } };

interface CharacterRow {
  id: string;
  data: string;
  owner_username: string;
  player_group_id: string | null;
}

export const characterRoutes = new Hono<HonoEnv>();

characterRoutes.get("/", async (c) => {
  const user = c.get("user");
  const groupId = c.req.query("groupId");
  if (!groupId || !user.memberships.includes(groupId)) {
    return c.json({ error: "Groupe introuvable ou non membre" }, 404);
  }

  const referenceData = await getReferenceDataForGroup(c.env.DB, groupId);
  const groupImageUrl = await getGroupImageUrl(c.env.DB, groupId);
  const groupDriveUrl = await getGroupDriveUrl(c.env.DB, groupId);
  const { results } = await c.env.DB.prepare(
    "SELECT id, name, race, owner_username, data FROM characters WHERE player_group_id = ?1 ORDER BY name",
  )
    .bind(groupId)
    .all<{ id: string; name: string; race: string; owner_username: string; data: string }>();

  // Résumé enrichi (portrait, statut en jeu, PV/PSP) pour l'écran d'accueil
  // et l'écran "Suivi des constantes" du MJ — computeCharacter recalcule
  // hpMax/pspMax comme pour la fiche détaillée, même source de vérité.
  const characters: CharacterSummary[] = (results ?? []).map((row) => {
    const parsed: Character = JSON.parse(row.data);
    const { hpMax, pspMax, armorTotals, actionRank, attributeTotals } = computeCharacter(parsed, referenceData);
    return {
      id: row.id,
      name: row.name,
      race: row.race,
      owner_username: row.owner_username,
      portraitUrl: parsed.portraitUrl,
      inGame: parsed.inGame ?? false,
      isNpc: parsed.isNpc ?? false,
      archived: parsed.archived ?? false,
      hpCurrent: parsed.hpCurrent,
      hpMax,
      pspCurrent: parsed.pspCurrent,
      pspMax,
      armorTotals,
      xp: parsed.xp ?? 0,
      xpAvailable: parsed.xpAvailable ?? 0,
      credits: parsed.credits ?? 0,
      actionRank,
      boostedAttributes: getBoostedAttributes(parsed, attributeTotals),
      boostedSkillNames: getBoostedSkillNames(parsed),
    };
  });

  return c.json({ characters, referenceData, groupImageUrl, groupDriveUrl });
});

characterRoutes.get("/:id", async (c) => {
  const user = c.get("user");
  const row = await c.env.DB.prepare("SELECT id, data, owner_username, player_group_id FROM characters WHERE id = ?1")
    .bind(c.req.param("id"))
    .first<CharacterRow>();
  // Une fiche d'un groupe dont on n'est pas membre est traitée comme
  // inexistante — évite de confirmer son existence à un compte qui n'y a
  // pas accès.
  if (!row || !row.player_group_id || !user.memberships.includes(row.player_group_id)) {
    return c.json({ error: "Personnage introuvable" }, 404);
  }

  const referenceData = await getReferenceDataForGroup(c.env.DB, row.player_group_id);
  const groupImageUrl = await getGroupImageUrl(c.env.DB, row.player_group_id);
  const character: Character = JSON.parse(row.data);
  const computed = computeCharacter(character, referenceData);
  return c.json({
    character,
    computed,
    canEdit: canEditCharacter(user, row.owner_username, row.player_group_id),
    referenceData,
    groupImageUrl,
  });
});

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "") // accents
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "pnj"
  );
}

async function uniqueId(db: D1Database, name: string): Promise<string> {
  const base = slugify(name);
  let candidate = base;
  let suffix = 2;
  while (await db.prepare("SELECT 1 FROM characters WHERE id = ?1").bind(candidate).first()) {
    candidate = `${base}-${suffix++}`;
  }
  return candidate;
}

const EMPTY_ATTRIBUTE_SCORES: AttributeScores = Object.fromEntries(ATTRIBUTES.map((a) => [a, 0])) as AttributeScores;

// Création d'un PNJ : fiche volontairement minimale (nom, photo, race pour
// la silhouette, PV/PSP max fixés directement via hpMaxOverride/
// pspMaxOverride — pas d'attributs à saisir). Réservé au MJ : un PNJ n'a pas
// de joueur propriétaire, seul le MJ doit pouvoir le créer/modifier (déjà
// garanti par canEditCharacter côté PUT, qui autorise role=gm sur tout
// personnage d'un groupe dont il est membre). Le PNJ est rattaché au
// groupe explicitement demandé (?groupId=, un MJ pouvant désormais gérer
// plusieurs groupes).
characterRoutes.post("/", async (c) => {
  const user = c.get("user");
  const groupId = c.req.query("groupId");
  if (user.role !== "gm" || !groupId || !user.memberships.includes(groupId)) {
    return c.json({ error: "Réservé au MJ de ce groupe" }, 403);
  }

  const body = await c.req
    .json<{ name?: string; portraitUrl?: string | null; race?: string; vit?: number; vol?: number }>()
    .catch(() => null);
  if (!body?.name?.trim()) {
    return c.json({ error: "Nom requis" }, 400);
  }

  const referenceData = await getReferenceDataForGroup(c.env.DB, groupId);
  const id = await uniqueId(c.env.DB, body.name);
  const now = new Date().toISOString();
  const race = body.race?.trim() || "humain";
  // PV/PSP suivent exactement le même calcul que pour un personnage de
  // joueur (VIT/VOL + bonus racial + taille, cf. calc-engine.ts) — le MJ
  // saisit juste VIT/VOL, les autres attributs restent à 0 (un PNJ n'a pas
  // de compétences à calculer dessus dans ce flux minimal).
  const raceDef = referenceData.races.find((r) => r.race === race);

  const character: Character = {
    id,
    ownerUsername: user.username,
    name: body.name.trim(),
    age: null,
    heightM: null,
    weightLabel: "",
    race,
    faction: "",
    fonction: "",
    loyaute: "",
    portraitUrl: body.portraitUrl ?? null,
    attributeScores: { ...EMPTY_ATTRIBUTE_SCORES, VIT: body.vit ?? 0, VOL: body.vol ?? 0 },
    attributeTechBonus: {},
    tailleModifier: raceDef?.tailleBonus ?? 0,
    hpCurrent: 0, // recalculé juste après via computeCharacter
    pspCurrent: 0,
    inGame: true, // visible tout de suite là où le MJ vient de le créer (Suivi des constantes)
    isNpc: true,
    archived: false,
    skills: [],
    psyPowers: [],
    weapons: [],
    armor: [],
    advantages: [],
    equipment: [],
    pointsDepart: 0,
    xp: 0,
    xpAvailable: 0,
    credits: 0,
    reputations: "",
    notes: "",
    updatedAt: now,
  };
  const { hpMax, pspMax } = computeCharacter(character, referenceData);
  character.hpCurrent = hpMax;
  character.pspCurrent = pspMax;

  await c.env.DB.prepare(
    "INSERT INTO characters (id, name, race, owner_username, data, updated_at, player_group_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
  )
    .bind(character.id, character.name, character.race, character.ownerUsername, JSON.stringify(character), now, groupId)
    .run();

  const computed = computeCharacter(character, referenceData);
  return c.json({ character, computed, canEdit: true, referenceData }, 201);
});

characterRoutes.put("/:id", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");

  const existing = await c.env.DB.prepare(
    "SELECT id, data, owner_username, player_group_id FROM characters WHERE id = ?1",
  )
    .bind(id)
    .first<CharacterRow>();
  if (!existing) return c.json({ error: "Personnage introuvable" }, 404);
  if (!canEditCharacter(user, existing.owner_username, existing.player_group_id)) {
    return c.json({ error: "Vous ne pouvez modifier que votre propre fiche" }, 403);
  }

  const incoming = await c.req.json<Partial<Character>>().catch(() => null);
  if (!incoming) return c.json({ error: "JSON invalide" }, 400);

  const current: Character = JSON.parse(existing.data);
  // On fusionne plutôt que remplacer intégralement : le client peut n'envoyer
  // que la section modifiée (ex. juste `skills`), le reste de la fiche reste
  // intact même si un autre onglet a été édité entre-temps par erreur.
  const updated: Character = {
    ...current,
    ...incoming,
    id: current.id, // non modifiable par le client
    ownerUsername: current.ownerUsername, // idem — changement de propriétaire hors périmètre MVP
    updatedAt: new Date().toISOString(),
  };
  // `xp` ("XP gagnée depuis la création") ne descend jamais sous 0 par
  // cette route (import Excel ou édition directe) — protection contre une
  // valeur négative importée depuis une cellule Excel. Un retrait du MJ
  // (POST /characters/:id/xp) peut en revanche la faire baisser, cf.
  // Character.xp/xpAvailable dans shared/types.ts.
  if (updated.xp < 0) updated.xp = 0;

  const referenceData: ReferenceData = existing.player_group_id
    ? await getReferenceDataForGroup(c.env.DB, existing.player_group_id)
    : { races: [], skillCostTable: {}, skills: [], weapons: [], armor: [], psyPowers: [], advantages: [] };

  // Dépenser des points (monter une compétence/un pouvoir psy, ajouter un
  // avantage) réduit "XP disponible" du montant exact de l'augmentation de
  // coût — et un allègement (baisser une compétence, retirer un avantage)
  // la rembourse symétriquement. On ignore ici toute valeur de xpAvailable
  // envoyée par le client (aucune UI n'expose son édition directe hors du
  // bouton "Donner de l'XP" du MJ, POST /characters/:id/xp) : elle est
  // entièrement recalculée à partir de la différence de coût avant/après.
  const costBefore = getSkillsCostTotal(current, referenceData) + getPsyPowersCostTotal(current, referenceData) + getAdvantagesNet(current);
  const costAfter = getSkillsCostTotal(updated, referenceData) + getPsyPowersCostTotal(updated, referenceData) + getAdvantagesNet(updated);
  updated.xpAvailable = (current.xpAvailable ?? 0) - (costAfter - costBefore);

  await c.env.DB.prepare(
    "UPDATE characters SET name = ?1, race = ?2, data = ?3, updated_at = ?4 WHERE id = ?5",
  )
    .bind(updated.name, updated.race, JSON.stringify(updated), updated.updatedAt, id)
    .run();

  const computed = computeCharacter(updated, referenceData);
  return c.json({ character: updated, computed, canEdit: true, referenceData });
});

// Distribution d'XP par le MJ — réservé au MJ membre du groupe du
// personnage (contrairement à PUT ci-dessus, le joueur propriétaire ne peut
// pas s'en servir : l'XP est décidée par le MJ, jamais auto-attribuée). Le
// montant (positif = distribution, négatif = retrait, décidé par le MJ, ce
// qui vaut ici son "approbation") s'applique symétriquement à `xp` ("XP
// gagnée depuis la création", contribue au budget total dispo, cf.
// calc-engine.getTotalDispo) et à `xpAvailable` ("XP disponible", pool géré
// par le MJ, distinct du budget total dispo — diminue aussi séparément
// quand le joueur dépense des points, cf. PUT ci-dessus). Aucun plancher :
// un retrait peut faire descendre l'un ou l'autre sous 0. Cf. Character.xp/
// xpAvailable dans shared/types.ts.
characterRoutes.post("/:id/xp", async (c) => {
  const id = c.req.param("id");
  const user = c.get("user");

  const existing = await c.env.DB.prepare(
    "SELECT id, data, owner_username, player_group_id FROM characters WHERE id = ?1",
  )
    .bind(id)
    .first<CharacterRow>();
  if (!existing) return c.json({ error: "Personnage introuvable" }, 404);
  if (user.role !== "gm" || !existing.player_group_id || !user.memberships.includes(existing.player_group_id)) {
    return c.json({ error: "Réservé au MJ de ce groupe" }, 403);
  }

  const body = await c.req.json<{ amount?: number }>().catch(() => null);
  const amount = body?.amount;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount === 0) {
    return c.json({ error: "Montant requis (non nul)" }, 400);
  }

  const current: Character = JSON.parse(existing.data);
  const updated: Character = {
    ...current,
    xp: current.xp + amount,
    xpAvailable: (current.xpAvailable ?? 0) + amount,
    updatedAt: new Date().toISOString(),
  };

  await c.env.DB.prepare("UPDATE characters SET data = ?1, updated_at = ?2 WHERE id = ?3")
    .bind(JSON.stringify(updated), updated.updatedAt, id)
    .run();

  const referenceData = await getReferenceDataForGroup(c.env.DB, existing.player_group_id);
  const computed = computeCharacter(updated, referenceData);
  return c.json({ character: updated, computed, canEdit: true, referenceData });
});

// "Fin de combat" — bouton MJ sur l'écran "Suivi des constantes" : désactive
// d'un coup tous les pouvoirs psy actifs (Character.activePsyPowers) des
// personnages EN JEU (inGame) de ce groupe, et rembourse le PSP décompté à
// leur activation (cf. getPsyPowerActivationCost, CharacterSheet.
// setActivePower pour le même mécanisme côté fiche individuelle). Les
// pouvoirs "turn" (immédiats) et "combat" (modification) sont traités de la
// même façon ici : aucune expiration automatique par tour n'est codée, seule
// cette action groupée ou une désactivation manuelle par fiche y met fin.
characterRoutes.post("/end-combat", async (c) => {
  const user = c.get("user");
  const groupId = c.req.query("groupId");
  if (user.role !== "gm" || !groupId || !user.memberships.includes(groupId)) {
    return c.json({ error: "Réservé au MJ de ce groupe" }, 403);
  }

  const referenceData = await getReferenceDataForGroup(c.env.DB, groupId);
  const { results } = await c.env.DB.prepare(
    "SELECT id, data FROM characters WHERE player_group_id = ?1",
  )
    .bind(groupId)
    .all<{ id: string; data: string }>();

  const now = new Date().toISOString();
  let deactivated = 0;
  for (const row of results ?? []) {
    const character: Character = JSON.parse(row.data);
    const active = character.activePsyPowers ?? [];
    if (!character.inGame || active.length === 0) continue;
    const { pspMax } = computeCharacter(character, referenceData);
    const refund = active.reduce((sum, p) => sum + getPsyPowerActivationCost(p.level), 0);
    const updated: Character = {
      ...character,
      activePsyPowers: [],
      pspCurrent: Math.min(pspMax, character.pspCurrent + refund),
      updatedAt: now,
    };
    await c.env.DB.prepare("UPDATE characters SET data = ?1, updated_at = ?2 WHERE id = ?3")
      .bind(JSON.stringify(updated), now, row.id)
      .run();
    deactivated++;
  }

  return c.json({ ok: true, deactivated });
});

// Distribution d'XP groupée par le MJ — écran "Suivi des constantes" :
// même montant pour tous les personnages JOUEURS actuellement en jeu de ce
// groupe (inGame && !isNpc && !archived — les PNJ sont exclus, l'XP est un
// mécanisme de progression des joueurs, tranché via AskUserQuestion en
// session). Même effet par personnage que POST /:id/xp (positif ou négatif,
// alimente xp ET xpAvailable symétriquement), appliqué en boucle plutôt que
// personnage par personnage depuis le frontend pour rester atomique côté
// MJ (un seul clic, un seul message d'erreur global en cas d'échec partiel).
characterRoutes.post("/group-xp", async (c) => {
  const user = c.get("user");
  const groupId = c.req.query("groupId");
  if (user.role !== "gm" || !groupId || !user.memberships.includes(groupId)) {
    return c.json({ error: "Réservé au MJ de ce groupe" }, 403);
  }

  const body = await c.req.json<{ amount?: number }>().catch(() => null);
  const amount = body?.amount;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount === 0) {
    return c.json({ error: "Montant requis (non nul)" }, 400);
  }

  const { results } = await c.env.DB.prepare(
    "SELECT id, data FROM characters WHERE player_group_id = ?1",
  )
    .bind(groupId)
    .all<{ id: string; data: string }>();

  const now = new Date().toISOString();
  let granted = 0;
  for (const row of results ?? []) {
    const character: Character = JSON.parse(row.data);
    if (!character.inGame || character.isNpc || character.archived) continue;
    const updated: Character = {
      ...character,
      xp: character.xp + amount,
      xpAvailable: (character.xpAvailable ?? 0) + amount,
      updatedAt: now,
    };
    await c.env.DB.prepare("UPDATE characters SET data = ?1, updated_at = ?2 WHERE id = ?3")
      .bind(JSON.stringify(updated), now, row.id)
      .run();
    granted++;
  }

  return c.json({ ok: true, granted });
});

// Distribution du revenu mensuel groupée par le MJ — écran "Suivi des
// constantes", bouton "+(X) mois 💵" à côté de "Donner de l'XP à tous".
// Contrairement à l'XP groupée (même montant pour tous), chaque personnage
// JOUEUR en jeu du groupe reçoit SON PROPRE revenu mensuel (cf.
// calc-engine.getMonthlyIncome : 500 Cr de base + 100 Cr par point de
// l'avantage "Revenus" éventuel), multiplié par le nombre de mois choisi par
// le MJ — pas un montant uniforme. Les PNJ sont exclus (même portée que
// group-xp).
characterRoutes.post("/group-income", async (c) => {
  const user = c.get("user");
  const groupId = c.req.query("groupId");
  if (user.role !== "gm" || !groupId || !user.memberships.includes(groupId)) {
    return c.json({ error: "Réservé au MJ de ce groupe" }, 403);
  }

  const body = await c.req.json<{ months?: number }>().catch(() => null);
  const months = body?.months;
  if (typeof months !== "number" || !Number.isFinite(months) || months === 0) {
    return c.json({ error: "Nombre de mois requis (non nul)" }, 400);
  }

  const { results } = await c.env.DB.prepare(
    "SELECT id, data FROM characters WHERE player_group_id = ?1",
  )
    .bind(groupId)
    .all<{ id: string; data: string }>();

  const now = new Date().toISOString();
  let granted = 0;
  for (const row of results ?? []) {
    const character: Character = JSON.parse(row.data);
    if (!character.inGame || character.isNpc || character.archived) continue;
    const income = getMonthlyIncome(character) * months;
    const updated: Character = {
      ...character,
      credits: (character.credits ?? 0) + income,
      updatedAt: now,
    };
    await c.env.DB.prepare("UPDATE characters SET data = ?1, updated_at = ?2 WHERE id = ?3")
      .bind(JSON.stringify(updated), now, row.id)
      .run();
    granted++;
  }

  return c.json({ ok: true, granted });
});
