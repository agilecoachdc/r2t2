// Client API minimal — fetch() + cookie de session (httpOnly, envoyé
// automatiquement par le navigateur via `credentials: "include"`). Voir
// docs/API_REFERENCE.md pour la forme exacte des réponses.

import type {
  Character,
  CharacterSummary,
  Game,
  JoinRequest,
  Language,
  PlayerGroup,
  PlayerGroupDetail,
  ProfileInfo,
  PublicUser,
  ReferenceData,
  Ruleset,
  RulesetDetail,
  UserRole,
} from "@shared/types";
import type { CharacterComputed } from "@shared/calc-engine";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `Erreur ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  login: (username: string, password: string) =>
    request<{ user: PublicUser }>("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout: () => request<{ ok: true }>("/auth/logout", { method: "POST" }),
  me: () => request<{ user: PublicUser }>("/auth/me"),
  getProfile: () => request<ProfileInfo>("/profile"),
  updateLanguage: (language: Language) =>
    request<{ user: PublicUser }>("/profile/language", { method: "PUT", body: JSON.stringify({ language }) }),

  // groupId requis : un compte peut être membre de plusieurs groupes en
  // même temps (cf. migrations/0005_memberships.sql), il n'y a plus de
  // "groupe courant" implicite côté serveur.
  listCharacters: (groupId: string) =>
    request<{
      characters: CharacterSummary[];
      referenceData: ReferenceData | null;
      groupImageUrl: string | null;
      groupDriveUrl: string | null;
    }>(`/characters?groupId=${encodeURIComponent(groupId)}`),
  getCharacter: (id: string) =>
    request<{
      character: Character;
      computed: CharacterComputed;
      canEdit: boolean;
      referenceData: ReferenceData;
      groupImageUrl: string | null;
    }>(`/characters/${id}`),
  updateCharacter: (id: string, patch: Partial<Character>) =>
    request<{ character: Character; computed: CharacterComputed; canEdit: boolean; referenceData: ReferenceData }>(
      `/characters/${id}`,
      { method: "PUT", body: JSON.stringify(patch) },
    ),
  // Distribution d'XP par le MJ (positif = alimente le pool, négatif =
  // absorbé dans pointsDepart) — réservé au MJ, cf. characters.ts.
  grantXp: (id: string, amount: number) =>
    request<{ character: Character; computed: CharacterComputed; canEdit: boolean; referenceData: ReferenceData }>(
      `/characters/${id}/xp`,
      { method: "POST", body: JSON.stringify({ amount }) },
    ),
  createNpc: (groupId: string, input: { name: string; portraitUrl?: string | null; race?: string; vit: number; vol: number }) =>
    request<{ character: Character; computed: CharacterComputed; canEdit: boolean; referenceData: ReferenceData }>(
      `/characters?groupId=${encodeURIComponent(groupId)}`,
      { method: "POST", body: JSON.stringify(input) },
    ),
  // "Fin de combat" (MJ, écran Suivi des constantes) : désactive tous les
  // pouvoirs psy actifs des personnages en jeu de ce groupe et rembourse
  // leur coût en PSP — cf. characters.ts POST /end-combat.
  endCombat: (groupId: string) =>
    request<{ ok: true; deactivated: number }>(`/characters/end-combat?groupId=${encodeURIComponent(groupId)}`, {
      method: "POST",
    }),
  // Distribution d'XP groupée (MJ, écran Suivi des constantes) : même
  // montant pour tous les personnages joueurs en jeu du groupe — cf.
  // characters.ts POST /group-xp.
  grantGroupXp: (groupId: string, amount: number) =>
    request<{ ok: true; granted: number }>(`/characters/group-xp?groupId=${encodeURIComponent(groupId)}`, {
      method: "POST",
      body: JSON.stringify({ amount }),
    }),
  // Distribution du revenu mensuel groupée (MJ, écran Suivi des constantes,
  // bouton "+(X) mois 💵") : chaque personnage joueur en jeu reçoit SON
  // PROPRE revenu (500 Cr + bonus "Revenus" éventuel) x months — cf.
  // characters.ts POST /group-income, calc-engine.getMonthlyIncome.
  grantGroupIncome: (groupId: string, months: number) =>
    request<{ ok: true; granted: number }>(`/characters/group-income?groupId=${encodeURIComponent(groupId)}`, {
      method: "POST",
      body: JSON.stringify({ months }),
    }),

  // ---------------------------------------------------------------------
  // Administration (jeux / règles / groupes / comptes) — réservé au rôle admin.
  // ---------------------------------------------------------------------

  listGames: () => request<{ games: Game[] }>("/admin/games"),
  createGame: (input: { name: string; description?: string; imageUrl?: string | null }) =>
    request<{ game: Game }>("/admin/games", { method: "POST", body: JSON.stringify(input) }),
  updateGame: (id: string, patch: { name?: string; description?: string; imageUrl?: string | null }) =>
    request<{ game: Game }>(`/admin/games/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
  deleteGame: (id: string) => request<{ ok: true }>(`/admin/games/${id}`, { method: "DELETE" }),

  listRulesets: (gameId?: string) =>
    request<{ rulesets: Ruleset[] }>(`/admin/rulesets${gameId ? `?gameId=${encodeURIComponent(gameId)}` : ""}`),
  getRuleset: (id: string) => request<{ ruleset: RulesetDetail }>(`/admin/rulesets/${id}`),
  createRuleset: (input: { gameId: string; name: string; description?: string; imageUrl?: string | null }) =>
    request<{ ruleset: RulesetDetail }>("/admin/rulesets", { method: "POST", body: JSON.stringify(input) }),
  updateRuleset: (
    id: string,
    patch: { name?: string; description?: string; imageUrl?: string | null; referenceData?: ReferenceData },
  ) => request<{ ruleset: RulesetDetail }>(`/admin/rulesets/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
  deleteRuleset: (id: string) => request<{ ok: true }>(`/admin/rulesets/${id}`, { method: "DELETE" }),

  listGroups: () => request<{ groups: PlayerGroup[] }>("/admin/groups"),
  getGroup: (id: string) => request<{ group: PlayerGroupDetail }>(`/admin/groups/${id}`),
  createGroup: (input: { name: string; description?: string; rulesetId: string; imageUrl?: string | null; driveUrl?: string | null }) =>
    request<{ group: PlayerGroupDetail }>("/admin/groups", { method: "POST", body: JSON.stringify(input) }),
  updateGroup: (
    id: string,
    patch: { name?: string; description?: string; rulesetId?: string; imageUrl?: string | null; driveUrl?: string | null },
  ) => request<{ group: PlayerGroup }>(`/admin/groups/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
  deleteGroup: (id: string) => request<{ ok: true }>(`/admin/groups/${id}`, { method: "DELETE" }),
  addGroupMember: (groupId: string, userId: string) =>
    request<{ ok: true }>(`/admin/groups/${groupId}/members`, { method: "POST", body: JSON.stringify({ userId }) }),
  removeGroupMember: (groupId: string, userId: string) =>
    request<{ ok: true }>(`/admin/groups/${groupId}/members/${userId}`, { method: "DELETE" }),

  listUsers: () => request<{ users: PublicUser[] }>("/admin/users"),
  createUser: (input: { username: string; displayName: string; role: UserRole; groupId?: string | null }) =>
    request<{ user: PublicUser; password: string }>("/admin/users", { method: "POST", body: JSON.stringify(input) }),
  updateUser: (id: string, patch: { displayName?: string; role?: UserRole }) =>
    request<{ user: PublicUser }>(`/admin/users/${id}`, { method: "PUT", body: JSON.stringify(patch) }),

  // ---------------------------------------------------------------------
  // Jeux / règles / groupes — parcourir, rejoindre/quitter, créer/éditer
  // les siens (page Profil). Ouvert à tout compte authentifié, sans passer
  // par /admin/*.
  // ---------------------------------------------------------------------

  browseGames: () => request<{ games: Game[] }>("/games"),
  browseRulesets: (gameId?: string) =>
    request<{ rulesets: Ruleset[] }>(`/rulesets${gameId ? `?gameId=${encodeURIComponent(gameId)}` : ""}`),
  browseGroups: () => request<{ groups: PlayerGroup[] }>("/groups"),
  // Ouvre une demande d'adhésion en attente d'approbation par un MJ du
  // groupe — n'accorde plus l'accès immédiatement (cf.
  // migrations/0006_join_approval.sql). `status` renvoyé indique si le
  // compte est déjà membre approuvé, ou si la demande est en attente.
  joinGroup: (groupId: string) =>
    request<{ user: PublicUser; status: "pending" | "approved" }>("/groups/join", {
      method: "POST",
      body: JSON.stringify({ groupId }),
    }),
  leaveGroup: (groupId: string) =>
    request<{ user: PublicUser }>("/groups/leave", { method: "POST", body: JSON.stringify({ groupId }) }),
  createGroupSelf: (input: {
    name: string;
    description?: string;
    rulesetId: string;
    imageUrl?: string | null;
    driveUrl?: string | null;
  }) => request<{ group: PlayerGroup; user: PublicUser }>("/groups", { method: "POST", body: JSON.stringify(input) }),
  updateGroupSelf: (
    id: string,
    patch: { name?: string; description?: string; rulesetId?: string; imageUrl?: string | null; driveUrl?: string | null },
  ) => request<{ group: PlayerGroup }>(`/groups/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
  // Catalogue complet de la règle de ce groupe + nom de la règle/du jeu —
  // page Documentation, ouvert à tout membre approuvé (pas seulement MJ).
  getGroupReference: (groupId: string) =>
    request<{ referenceData: ReferenceData; groupName: string; rulesetName: string; gameName: string }>(
      `/groups/${groupId}/reference`,
    ),

  // Approbation des demandes d'adhésion — réservé au MJ membre (approuvé)
  // du groupe ciblé (cf. migrations/0006_join_approval.sql).
  listJoinRequests: (groupId: string) => request<{ requests: JoinRequest[] }>(`/groups/${groupId}/join-requests`),
  approveJoinRequest: (groupId: string, userId: string) =>
    request<{ ok: true }>(`/groups/${groupId}/join-requests/${userId}/approve`, { method: "POST" }),
  rejectJoinRequest: (groupId: string, userId: string) =>
    request<{ ok: true }>(`/groups/${groupId}/join-requests/${userId}`, { method: "DELETE" }),
};
