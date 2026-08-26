# Référence API — r2t2

Doc dev-facing des routes `/api/*` (Hono, `src/worker/`). Tenue à jour via le hook
`.claude/hooks/api-reference-reminder.sh` à chaque édition d'une route.

Toutes les routes sauf `/api/auth/login` exigent une session valide (cookie httpOnly
`add40k_session`, middleware `requireAuth` dans `src/worker/lib/session.ts`).

## Auth (`src/worker/routes/auth.ts`)

### `POST /api/auth/login`
- Auth : aucune.
- Entrée : `{ username: string, password: string }`.
- Sortie : `{ user: PublicUser }`, pose le cookie de session.
- Erreurs : `400` (champs manquants), `401` (identifiants invalides).

### `POST /api/auth/logout`
- Auth : session (optionnelle, no-op si absente).
- Sortie : `{ ok: true }`, efface le cookie.

### `GET /api/auth/me`
- Auth : session.
- Sortie : `{ user: PublicUser }`.
- Erreurs : `401` si pas de session valide.

## Personnages (`src/worker/routes/characters.ts`)

Un compte (joueur ou MJ) peut désormais être membre de **plusieurs groupes en même temps**
(`group_memberships`, cf. migrations/0005_memberships.sql — remplace l'ancien
`users.player_group_id` unique, qui reste en base pour compat historique mais n'est plus la
source de vérité). Il n'y a donc plus de "groupe courant" implicite : toutes les routes
personnages exigent un `groupId` explicite (query param ou body), vérifié contre
`user.memberships`. Le catalogue de référence (`ReferenceData`) est chargé depuis la règle
assignée à ce groupe (`getReferenceDataForGroup`, `src/worker/lib/reference.ts`) et renvoyé dans
chaque réponse.

### `GET /api/characters?groupId=`
- Auth : session ; `groupId` doit être dans `user.memberships` (403 sinon).
- Sortie : `{ characters: CharacterSummary[], referenceData: ReferenceData, groupImageUrl: string | null, groupDriveUrl: string | null }`
  — résumé enrichi (portrait, statut `inGame`, `isNpc`, `archived`, PV/PSP courant + max calculé,
  `xp`/`xpAvailable`, `actionRank`) utilisé par l'écran "Personnages" et l'écran "Suivi des
  constantes" (MJ), tous deux scopés `/groupe/:groupId` et `/suivi/:groupId`. `groupImageUrl` est
  l'image du groupe (`player_groups.image_url`, fond d'écran) ; `groupDriveUrl` est le lien Drive
  personnalisable du groupe (`player_groups.drive_url`, affiché en bouton "Dossier Drive" — plus
  de lien ADD40K en dur). `actionRank` (cf. `calc-engine.getActionRank`) est le Rang d'Action
  courant du personnage — plus bas = agit plus tôt ; l'écran "Suivi des constantes" affiche un
  rang courant (boutons Précédent/Suivant) et surligne les tuiles dont `actionRank` correspond
  exactement (plusieurs personnages peuvent agir au même rang). `hasActiveBoost` (cf.
  `calc-engine.hasActivePsyPowerBoost`) indique qu'au moins un pouvoir psy actif
  (`Character.activePsyPowers`) booste une caractéristique ou une compétence de ce personnage —
  affiche une icône "⚡" sur sa tuile. Voir `src/shared/types.ts`.

### `GET /api/characters/:id`
- Auth : session ; lecture ouverte à tout membre du groupe du personnage.
- Sortie : `{ character: Character, computed: CharacterComputed, canEdit: boolean, referenceData: ReferenceData, groupImageUrl: string | null }`.
  `computed` est calculé côté serveur via `src/shared/calc-engine.ts` (mêmes fonctions que le
  frontend, pour rester la source de vérité en cas de divergence de version de code).
- Erreurs : `404` si le personnage n'existe pas *ou* appartient à un groupe dont l'appelant n'est
  pas membre (traité comme inexistant, pas de fuite d'existence).

### `POST /api/characters`
- Auth : session + rôle `gm`, membre du groupe ciblé.
- Entrée : `{ groupId: string, name: string, portraitUrl?: string | null, race?: string, vit?: number, vol?: number }`
  — crée un PNJ (`isNpc: true`, `inGame: true`) rattaché à `groupId`. PV/PSP max suivent
  exactement le même calcul que pour un personnage de joueur (VIT/VOL + bonus racial + taille,
  `calc-engine.ts`) ; les autres attributs restent à 0. `id` généré par slug du nom (suffixe
  numérique en cas de collision).
- Sortie : `{ character: Character, computed: CharacterComputed, canEdit: true, referenceData: ReferenceData }`, code `201`.
- Erreurs : `403` (pas MJ ou pas membre de `groupId`), `400` (nom manquant).

### `PUT /api/characters/:id`
- Auth : session + `canEditCharacter` (propriétaire du personnage — comparaison par
  `owner_username`, un même compte pouvant posséder des personnages dans plusieurs groupes — ou
  rôle `gm` membre du groupe du personnage).
- Entrée : `Partial<Character>` — fusionné avec les données existantes côté serveur
  (`id` et `ownerUsername` du client sont ignorés). `xp` ("XP gagnée depuis la création" à
  l'écran) est clampé à `0` minimum si le patch en envoie un négatif (import Excel ou autre) —
  cf. `POST /:id/xp` ci-dessous pour les retraits du MJ (qui touchent `xp` et `xpAvailable`
  ensemble). C'est aussi cette route qui gère, en dehors du mode édition de la fiche,
  `weapons[].equipped` (arme en main — un des termes du Rang d'Action, cf. `computed.actionRank`
  et `calc-engine.getActionRank`) et `activePsyPowers` (pouvoirs activés "à la demande" en séance,
  cf. `ActivePsyPower` dans `shared/types.ts` — seul "Concentration psy" y a un effet chiffré, un
  bonus de Réflexe pris en compte dans le calcul du RA). C'est également par cette route (patch
  `{ pointsDepart }`) que le MJ absorbe un solde négatif (bouton "Accepter" de BudgetPanel) — le
  blocage de l'enregistrement en cas de solde négatif est une validation côté client uniquement
  (bouton "Enregistrer" désactivé), pas une contrainte appliquée par cette route elle-même.
- Sortie : `{ character: Character, computed: CharacterComputed, canEdit: true, referenceData: ReferenceData }`
  — `computed.actionRank` est dérivé à la volée (Réflexe, arme équipée, avantages/pouvoir
  "Concentration" actifs), jamais stocké tel quel.
- Erreurs : `403` (pas le propriétaire ni MJ du groupe), `404` (personnage introuvable), `400` (JSON invalide).

### `POST /api/characters/:id/xp`
- Auth : session + rôle `gm` membre du groupe du personnage (contrairement à `PUT` ci-dessus, le
  joueur propriétaire ne peut pas s'en servir même avec `canEdit` — l'XP est décidée par le MJ).
- Entrée : `{ amount: number }` (non nul).
  - Positif : ajouté à la fois à `character.xp` ("XP gagnée (depuis la création)" à l'écran —
    historique cumulatif qui contribue au budget total dispo, cf. calc-engine.getTotalDispo) et à
    `character.xpAvailable` ("XP disponible" à l'écran — pool d'appoint géré par le MJ, hors
    budget total dispo), du même montant pour les deux.
  - Négatif : un retrait décidé par le MJ, ce qui vaut ici son "approbation" — ne réduit que
    `character.xpAvailable`, qui peut devenir négatif (pas de plancher, contrairement à `xp` qui
    n'est jamais réduit par un retrait).
- Sortie : `{ character: Character, computed: CharacterComputed, canEdit: true, referenceData: ReferenceData }`
  (même enveloppe que `PUT /:id`).
- Erreurs : `403` (pas MJ ou pas membre du groupe), `404` (personnage introuvable), `400` (montant
  manquant, non numérique, ou nul).

### `POST /api/characters/end-combat?groupId=`
- Auth : session + rôle `gm` membre du groupe ciblé.
- "Fin de combat" (bouton MJ, écran "Suivi des constantes") : désactive d'un coup
  `activePsyPowers` de tous les personnages `inGame` de ce groupe qui en ont, et rembourse à
  chacun le PSP décompté à l'activation (`getPsyPowerActivationCost` par palier actif, clampé à
  `pspMax`) — même mécanisme de remboursement qu'une désactivation individuelle
  (`PUT /:id` côté fiche, cf. `CharacterSheet.setActivePower`). S'applique uniformément aux
  pouvoirs `duration: "turn"` et `"combat"` : aucune expiration automatique par tour n'est codée,
  seule cette action groupée ou une désactivation manuelle par fiche y met fin.
- Sortie : `{ ok: true, deactivated: number }` (nombre de personnages dont au moins un pouvoir a
  été désactivé).
- Erreurs : `403` (pas MJ ou pas membre du groupe).

### `POST /api/characters/group-xp?groupId=`
- Auth : session + rôle `gm` membre du groupe ciblé.
- "Donner de l'XP à tous" (bouton MJ, écran "Suivi des constantes") : applique le même montant
  d'XP, en une seule requête, à tous les personnages **joueurs** (pas les PNJ) actuellement
  `inGame` et non archivés de ce groupe — même effet par personnage que `POST /:id/xp` (positif ou
  négatif, alimente `xp` et `xpAvailable` symétriquement, cf. ci-dessus), simplement appliqué en
  boucle côté serveur plutôt que par des appels individuels depuis le client.
- Entrée : `{ amount: number }` (non nul).
- Sortie : `{ ok: true, granted: number }` (nombre de personnages ayant reçu l'XP).
- Erreurs : `403` (pas MJ ou pas membre du groupe), `400` (montant manquant, non numérique, ou nul).

## Profil (`src/worker/routes/profile.ts`)

### `GET /api/profile`
- Auth : session (tout rôle).
- Sortie : `{ user: PublicUser, memberships: MembershipInfo[] }` où chaque `MembershipInfo` est
  `{ group: PlayerGroup, ruleset: Ruleset | null, game: Game | null }` — un par groupe dont
  l'appelant est membre (page "Mon profil", section "Mes groupes"). Tableau vide pour un compte
  sans groupe (admin).

### `PUT /api/profile/language`
- Auth : session (tout rôle) — self-service, un compte ne modifie que son propre champ.
- Entrée : `{ language: Language }` (`Language = "fr" | "en"`, cf. `shared/types.ts` et
  `migrations/0007_language.sql`).
- Sortie : `{ user: PublicUser }` avec le nouveau `language`.
- Erreurs : `400` (langue absente ou hors de `["fr", "en"]`).
- Utilisé par le sélecteur "Langue de l'interface" de la page Profil. `language` par défaut
  `'fr'` pour tout compte (y compris non authentifié — page de connexion, où la préférence n'est
  pas encore connue). Traduction gérée côté frontend par `src/frontend/lib/i18n.ts`
  (`useTranslation()`/`t()`) : dictionnaire anglais indexé par le texte source français, avec
  retombée silencieuse sur le français pour tout texte non encore traduit. Actuellement couvre les
  écrans joueur/MJ (Accueil, Profil, Personnages, Suivi des constantes, Fiche personnage) ; les
  pages d'administration (`admin/GamesRulesets.tsx`, `admin/PlayerGroups.tsx`, `admin/Accounts.tsx`)
  et la page de connexion restent en français uniquement.

## Administration (`src/worker/routes/admin.ts`)

Toutes les routes ci-dessous sont montées sous `/api/admin/*` avec
`requireAuth` + `requireRole("admin")` (`src/worker/index.ts`) — réservées au rôle `admin`,
`403` sinon.

- `GET/POST /api/admin/games`, `PUT/DELETE /api/admin/games/:id` — CRUD des jeux
  (`{ name, description, imageUrl? }`). `DELETE` refusé (`409`) si des règles y sont rattachées.
- `GET /api/admin/rulesets[?gameId=]`, `GET /api/admin/rulesets/:id` (avec `referenceData`),
  `POST /api/admin/rulesets` (`{ gameId, name, description, imageUrl? }`, catalogue vide par
  défaut), `PUT /api/admin/rulesets/:id` (`{ name?, description?, imageUrl?, referenceData? }`),
  `DELETE /api/admin/rulesets/:id` — CRUD des règles. `DELETE` refusé (`409`) si un groupe
  l'utilise.
- `GET /api/admin/groups`, `GET /api/admin/groups/:id` (avec `members: GroupMember[]`, membres
  approuvés uniquement — une demande `pending` ne s'y affiche pas, cf. plus bas),
  `POST /api/admin/groups` (`{ name, description, rulesetId, imageUrl?, driveUrl? }`),
  `PUT /api/admin/groups/:id` (mêmes champs, tous optionnels), `DELETE /api/admin/groups/:id` —
  CRUD des groupes de joueurs. `driveUrl` est le lien du dossier Drive du groupe, personnalisable
  indépendamment pour chacun (`player_groups.drive_url`, cf. migrations/0005_memberships.sql).
  `DELETE` refusé (`409`) si des comptes ou personnages y sont rattachés.
- `POST /api/admin/groups/:id/members` — Entrée : `{ userId: string }`. Ajoute ce compte comme
  membre du groupe (idempotent — `INSERT OR IGNORE` sur `group_memberships`). Sortie : `{ ok: true }`.
- `DELETE /api/admin/groups/:id/members/:userId` — Retire ce compte du groupe. Sortie : `{ ok: true }`.
- `GET /api/admin/users`, `POST /api/admin/users` (`{ username, displayName, role, groupId? }`
  → `{ user, password }`, mot de passe généré renvoyé une seule fois, même principe que
  `scripts/add_user.mjs` ; `groupId` crée aussi la première appartenance), `PUT /api/admin/users/:id`
  (`{ displayName?, role? }` **uniquement** — ne touche jamais l'appartenance aux groupes, pour
  éviter toute rétrogradation accidentelle : cf. l'incident du 18/08 où un endpoint combiné
  rôle+groupe avait démis un admin en le "réassignant"). L'appartenance aux groupes se gère
  exclusivement via les deux routes `/members` ci-dessus. Passer `role: "admin"` retire
  automatiquement toutes les appartenances existantes (un admin n'est membre d'aucun groupe).

`imageUrl` (games/rulesets/groups) est soit une data URL (image importée depuis l'admin ou la
page Profil, redimensionnée côté client via `resizePortraitToDataUrl`, même principe que le
portrait de personnage), soit un chemin d'asset statique (ex. `"/background.jpg"` pour le groupe
historique `add40k`).

## Jeux / règles / groupes en self-service (`src/worker/routes/catalog.ts`)

Montées directement sous `/api/games`, `/api/rulesets`, `/api/groups` (pas de préfixe `/admin`) —
accessibles à tout compte authentifié, pour la page "Mon profil" (rejoindre/créer/quitter un
groupe, ou éditer son propre groupe) sans passer par les routes CRUD complètes ci-dessus.

- `GET /api/games` — liste des jeux (résumé, comme `/api/admin/games`).
- `GET /api/rulesets[?gameId=]` — liste des règles (résumé, sans `referenceData`).
- `GET /api/groups` — liste des groupes de joueurs (résumé, sans `members`, avec `driveUrl`).
- `GET /api/groups/:id/reference` — Auth : membre approuvé de ce groupe (joueur ou MJ, 403 sinon).
  Sortie : `{ referenceData: ReferenceData, groupName, rulesetName, gameName }` — catalogue complet
  de la règle assignée à ce groupe (mêmes données que `/api/characters?groupId=`, mais accessible
  sans passer par la liste des personnages). Alimente la page Documentation
  (`/documentation/:groupId`, accessible depuis l'écran "Personnages"), qui affiche les règles du
  jeu réellement utilisées par ce groupe à côté du guide générique de la plateforme.
- `POST /api/groups/join` — Auth : joueur ou MJ (403 si admin). Entrée : `{ groupId }`. Ouvre une
  demande d'adhésion (idempotent) — **n'accorde plus l'accès immédiatement** : la ligne
  `group_memberships` créée démarre à `status = 'pending'` et doit être approuvée par un MJ déjà
  membre du groupe avant de compter dans `user.memberships` (cf.
  migrations/0006_join_approval.sql). Sortie : `{ user: PublicUser, status: "pending" | "approved" }`
  (`status` vaut `"approved"` seulement si l'appelant était déjà membre approuvé).
- `POST /api/groups/leave` — Auth : joueur ou MJ. Entrée : `{ groupId }`. Retire l'appelant de ce
  groupe — supprime aussi bien une appartenance approuvée qu'une demande encore en attente
  (annulation). Sortie : `{ user: PublicUser }`.
- `POST /api/groups` — Auth : MJ uniquement (403 sinon). Entrée :
  `{ name, description?, rulesetId, imageUrl?, driveUrl? }`. Crée un nouveau groupe et y rattache
  automatiquement le MJ créateur, **directement approuvé** (ne passe pas par le circuit de demande
  ci-dessus) — un MJ doit appartenir à un groupe pour y créer des PNJ/gérer des personnages, cf.
  `characters.ts`. Sortie : `{ group: PlayerGroup, user: PublicUser }`, code `201`.
- `PUT /api/groups/:id` — Auth : MJ membre approuvé de ce groupe uniquement (403 sinon, y compris
  pour un MJ d'un autre groupe). Entrée : `{ name?, description?, imageUrl?, driveUrl? }` —
  édition self-service limitée (pas de changement de règle, réservé à `/api/admin/groups/:id`).
  Sortie : `{ group: PlayerGroup }`.
- `GET /api/groups/:id/join-requests` — Auth : MJ membre approuvé de ce groupe (403 sinon). Sortie :
  `{ requests: JoinRequest[] }` — les demandes `pending` en attente d'approbation pour ce groupe,
  triées par date de demande.
- `POST /api/groups/:id/join-requests/:userId/approve` — Auth : MJ membre approuvé de ce groupe.
  Fait passer la demande de `pending` à `approved` (l'utilisateur obtient alors l'accès au groupe).
  Sortie : `{ ok: true }`. Erreurs : `404` si aucune demande `pending` pour ce couple groupe/compte.
- `DELETE /api/groups/:id/join-requests/:userId` — Auth : MJ membre approuvé de ce groupe. Rejette
  la demande (supprime la ligne `pending`, sans effet si elle n'existe pas/plus). Sortie :
  `{ ok: true }`.

Le raccourci admin `POST /api/admin/groups/:id/members` (ci-dessus) reste un ajout direct
toujours approuvé, bypassant ce circuit de demande — pratique pour un admin qui veut rattacher un
compte sans attendre un MJ ; il fait aussi passer une éventuelle demande `pending` existante à
`approved` (UPSERT).

## Types

Voir `src/shared/types.ts` (`Character`, `PublicUser`, `ReferenceData`, `Game`, `Ruleset`,
`RulesetDetail`, `PlayerGroup`, `PlayerGroupDetail`, `GroupMember`, `MembershipInfo`,
`MembershipStatus`, `JoinRequest`, `ProfileInfo`) et `src/shared/calc-engine.ts`
(`CharacterComputed`, `BudgetSummary`).

## Vérification de dérive

- `grep -r "app.route\|app.get\|app.post\|app.put" src/worker/` doit lister exactement les
  routes documentées ci-dessus.
