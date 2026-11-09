// Verrouillage des fiches pendant une séance — bouton MJ en haut de l'écran
// "Suivi des constantes" (player_groups.sheets_locked, cf.
// migrations/0011_sheets_locked.sql). Tant que le verrou est posé, un joueur
// ne peut plus dépenser d'XP ni de crédits pour faire évoluer son personnage
// : attributs, compétences, pouvoirs psy, avantages, armes/armures,
// équipement, achats de consommables et dépense/don de crédits. Reste libre
// ce qui sert à jouer : PV/PSP, pouvoirs activés, arme équipée / armure
// portée, utilisation des consommables (−1, −1 coup), notes et identité.
// Le MJ (et l'admin) n'est jamais concerné par le verrou.
//
// Partagé entre le Worker (autorisation réelle, PUT /api/characters/:id) et
// le frontend (affichage), pour qu'ils ne divergent pas.

import type { Character } from "./types";

/** Champs de la fiche figés pour un joueur tant que les fiches sont verrouillées. */
export const SESSION_LOCKED_FIELDS = [
  "race",
  "attributeScores",
  "attributeTechBonus",
  "tailleModifier",
  "skills",
  "psyPowers",
  "advantages",
  "equipment",
  "pointsDepart",
  "xp",
  "credits",
  "consumables",
] as const satisfies readonly (keyof Character)[];

/**
 * Filtre une mise à jour de fiche (PUT, fusion partielle) envoyée par un
 * joueur pendant que les fiches sont verrouillées : les champs de
 * progression sont ignorés (la valeur en base est conservée) ; pour les
 * armes et armures, seule la bascule "équipée"/"portée" d'une ligne
 * existante passe — aucun ajout, retrait ou changement de stats.
 */
export function applySessionLock(current: Character, incoming: Partial<Character>): Partial<Character> {
  const filtered: Partial<Character> = { ...incoming };
  for (const field of SESSION_LOCKED_FIELDS) delete filtered[field];

  if (incoming.weapons) {
    filtered.weapons = current.weapons.map((w, i) => {
      const next = incoming.weapons?.[i];
      return next && next.name === w.name ? { ...w, equipped: next.equipped === true } : w;
    });
  }
  if (incoming.armor) {
    filtered.armor = current.armor.map((a, i) => {
      const next = incoming.armor?.[i];
      return next && next.name === a.name ? { ...a, active: next.active === true } : a;
    });
  }
  return filtered;
}
