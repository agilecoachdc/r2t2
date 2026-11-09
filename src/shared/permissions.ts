// Contrôles d'accès par groupe, partagés entre le Worker (autorisation
// réelle) et le frontend (affichage des boutons/liens) pour qu'ils ne
// divergent jamais.
//
// Un admin plateforme n'est membre d'aucun groupe (user.memberships reste
// vide, cf. migrations/0005_memberships.sql) mais dispose de tous les droits
// MJ sur tous les groupes : il peut ainsi modifier une règle ou ajouter de
// l'équipement au catalogue, puis ajuster directement les fiches des
// personnages et suivre les constantes, sans changer de compte.

import type { PublicUser } from "./types";

type AccessUser = Pick<PublicUser, "role" | "memberships">;

/** Accès en lecture à un groupe : membre approuvé, ou admin (tous les groupes). */
export function canAccessGroup(user: AccessUser, groupId: string | null | undefined): groupId is string {
  if (!groupId) return false;
  if (user.role === "admin") return true;
  return user.memberships.includes(groupId);
}

/** Droits MJ sur un groupe : MJ membre approuvé de ce groupe, ou admin (tous les groupes). */
export function isGmOfGroup(user: AccessUser, groupId: string | null | undefined): groupId is string {
  if (!groupId) return false;
  if (user.role === "admin") return true;
  return user.role === "gm" && user.memberships.includes(groupId);
}
