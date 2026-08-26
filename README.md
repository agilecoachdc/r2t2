# R2T2 — Fiches de personnage multi-jeux

Plateforme web (laptop / tablette / téléphone) de fiches de personnage pour plusieurs jeux de
rôle et groupes de joueurs, chacun avec sa propre règle (catalogue races/compétences/armes/
armures/pouvoirs/avantages). Née du jeu ADD40K, dont les données historiques forment aujourd'hui
le premier jeu/règle/groupe hébergé (remplace les classeurs Excel d'origine). Déployée sur un
Worker Cloudflare unique (Hono + D1 + SPA React).

Voir le plan de conception : `~/.claude/plans/lively-rolling-comet.md` (contexte complet,
décisions actées, hors-périmètre MVP).

## Stack

- **Worker** : [Hono](https://hono.dev) (`src/worker/`), sert l'API `/api/*` et le SPA buildé.
- **Frontend** : Vite + React + TypeScript + Tailwind v4 (`src/frontend/`).
- **Base** : Cloudflare D1 (`migrations/`), schéma `users` / `sessions` / `characters`.
- **Moteur de calcul** : `src/shared/calc-engine.ts`, partagé Worker + frontend (mêmes formules
  affichées en direct côté client et revalidées côté serveur à la sauvegarde).
- **Import** : `scripts/import_xlsx.py` (Python + openpyxl) extrait les 8 fiches Excel du
  dossier `Mon Drive/ADD40K/Fiches persos` vers `src/shared/reference-data.ts` (catalogue de
  règles) et `scripts/characters.seed.json`.

## Démarrage local

```bash
npm install
npm run db:migrate:local            # applique migrations/0001_init.sql (+0002_seed.sql si présent)
npm run build                       # build le SPA dans ./dist
npm run dev                         # wrangler dev sur http://localhost:8787
```

Identifiants de test : voir `scripts/generated-credentials.md` (généré, gitignored — relancer
`node scripts/generate_seed_sql.mjs` si absent).

## Régénérer les données depuis les fiches Excel

```bash
python3 scripts/import_xlsx.py        # -> reference-data.ts + characters.seed.json + rapport
node scripts/generate_seed_sql.mjs    # -> migrations/0002_seed.sql + mots de passe
npm run db:migrate:local              # applique (voir piège ci-dessous)
```

**Toujours dans cet ordre.** `wrangler d1 migrations apply` suit les migrations déjà appliquées
par nom de fichier : régénérer `0002_seed.sql` sans avoir d'abord supprimé l'état D1 local
(`.wrangler/state/v3/d1`) ne le réapplique pas. Voir
`.claude/skills/cloudflare-add40k/SKILL.md` pour le détail du piège et la procédure de reset.

Lire `scripts/import-report.md` après chaque import : il liste les écarts connus (races hors
catalogue, avantages introuvables, XP invalide...) qui nécessitent une vérification manuelle.

## Synchro fiche Excel <-> app

Chaque personnage a une fiche Excel dans `Mon Drive/ADD40K/Fiches App/<Nom>.xlsx` (générée par
`python3 scripts/export_xlsx.py <dossier de .json>`, au format du classeur de Conrad Lingus pris
comme template). Sur l'écran d'accueil, chaque tuile a deux boutons :

- **⬆︎ Excel** (import, propriétaire du personnage ou MJ) : lit un `.xlsx` sélectionné localement
  et met à jour la fiche dans l'app.
- **⬇︎ Excel** (export, tout le monde) : télécharge un `.xlsx` avec les données actuelles de l'app.

Les deux sens utilisent les mêmes coordonnées de cellules que `scripts/import_xlsx.py` (voir
`src/frontend/lib/xlsxSync.ts`) et re-dérivent les valeurs d'armure/pouvoir psy/avantage depuis
`reference-data.ts` plutôt que de faire confiance à la cellule formule mise en cache par Excel.
**Limite connue** : l'export (bibliothèque XLSX.js gratuite, `public/character-template.xlsx`)
ne préserve pas les images ni la mise en forme riche du classeur original — fonctionnel, pas
identique visuellement aux fiches de `Fiches App/`.

## Distribution d'XP

L'XP d'un personnage est distribuée par le MJ, jamais auto-attribuée par le joueur : un bouton
"Donner de l'XP" apparaît, pour le MJ uniquement, sur la fiche détaillée (panneau "Budget de
points") et sur chaque tuile de l'écran "Suivi des constantes". Deux champs distincts, à ne pas
confondre :

- **`Character.xp`** ("XP gagnée (depuis la création)" à l'écran) — total net : la valeur importée
  depuis la fiche Excel d'origine, plus/moins toutes les distributions du MJ depuis (positives ou
  négatives — un retrait décidé par le MJ vaut son approbation). Contribue au budget total dispo
  (additionné aux points raciaux + points de départ, cf. calc-engine.getTotalDispo).
- **`Character.xpAvailable`** ("XP disponible" à l'écran) — pool d'appoint géré par le MJ, séparé
  du budget total dispo (n'y contribue pas). Bouge du même montant que `xp` à chaque distribution/
  retrait du MJ, et diminue aussi séparément quand le coût de la fiche augmente (compétence/pouvoir
  psy monté, avantage ajouté — remboursé symétriquement en cas d'allègement). Peut devenir négatif
  dans les deux cas (aucun plancher).

Voir `POST /api/characters/:id/xp` dans `docs/API_REFERENCE.md`.

## Monnaie (crédits, Cr)

Système d'argent indépendant du budget de points ci-dessus — `Character.credits`, affiché en
"Crédits" sur la fiche (panneau "Budget de points") et sur chaque tuile de l'écran "Suivi des
constantes" (icône 💵).

- **Revenu mensuel** (`calc-engine.getMonthlyIncome`) : 500 Cr de base pour tout personnage joueur,
  plus 100 Cr par point de chaque avantage "Revenus : +X" possédé (ex. "Revenus : +20" ajoute
  20 x 100 = 2000 Cr/mois, pour un total de 2500 Cr/mois) — la description du catalogue dit "x1000"
  mais la table de jeu réelle utilise x100 (coquille de règle corrigée en session). Affiché en
  lecture seule sur la fiche pour transparence ; distribué par le MJ, jamais auto-attribué.
- **Distribution groupée** : bouton MJ "💵 +(X) mois" sur l'écran "Suivi des constantes", à côté de
  "Donner de l'XP à tous" — contrairement à l'XP (même montant pour tous), chaque personnage
  **joueur** en jeu reçoit SON PROPRE revenu mensuel (selon ses avantages) multiplié par le nombre
  de mois saisi. Les PNJ sont exclus (même portée que la distribution d'XP groupée). Voir
  `POST /api/characters/group-income` dans `docs/API_REFERENCE.md`.
- **Achats** : ajouter une NOUVELLE arme ou armure depuis le catalogue (`WeaponsArmorPanel`), ou un
  nouvel objet via le mini-formulaire d'achat (`EquipmentPanel`), déduit automatiquement le prix du
  solde du personnage. Un prix catalogue inconnu (fourchette texte type "10-100", absent) n'est
  jamais bloquant — rien n'est déduit. Un solde insuffisant BLOQUE l'achat (validation côté client,
  même logique que le blocage de "Enregistrer" en cas de solde de points négatif) : la sélection
  n'est pas appliquée, un message rouge explique pourquoi. Modifier une ligne déjà existante
  (renommer, changer le prix affiché) n'a jamais d'effet sur le solde — seul l'AJOUT d'une ligne
  déduit. Le prix catalogue des armes existait déjà (`WeaponDefinition.price`) ; celui des armures
  est nouveau (`ArmorDefinition.price`, colonne "Prix" ajoutée à l'éditeur de catalogue admin,
  onglet "Armures") — absent (`null`) tant qu'un admin ne l'a pas saisi.

## Rang d'Action (RA)

Le Rang d'Action détermine l'ordre de jeu en combat : plus le RA final est bas, plus le personnage
agit tôt. Calculé (`calc-engine.getActionRank`, jamais stocké) comme `BASE_RA(5) - Réflexe total +
(RA de l'arme équipée + ses modificateurs)` — le RA de catalogue d'une arme (ex. 2 pour Wild
Predator) est déjà un rang à part entière, lu tel quel dans la table du classeur : il s'additionne
au socle, il ne s'en soustrait pas. Une arme non équipée compte comme mains nues (RA 0 de
catalogue). Deux armes au maximum peuvent être marquées "équipées" à la fois (case à cocher sur la
fiche, à côté du nom de chaque arme, même principe que l'armure — `calc-engine.
MAX_EQUIPPED_WEAPONS`, `CharacterSheet.toggleWeaponEquipped` déséquipe automatiquement la plus
ancienne au-delà de cette limite), avec ou sans l'avantage "Ambidextre" : sans lui, le combat à deux
armes impose un malus de -3 au score joué de CHAQUE arme équipée (pas aux dégâts ni au RA, cf.
`calc-engine.getDualWieldPenalty`, appliqué via `getWeaponTotals`) ; avec Ambidextre, aucun malus.
Avec deux armes équipées, seule la première trouvée dans la liste compte pour le RA (`getActionRank`
ne lit que la première arme équipée) — combiner les deux armes dans ce calcul reste hors périmètre
tant qu'aucune règle précise n'a été communiquée pour le RA du combat à deux armes.

Deux éléments du catalogue (Règles ADD40K V0.2) modifient le Réflexe pris en compte, mais
seulement pendant qu'un pouvoir est actif :
- Avantages "Concentration rapide" (+10, REF+3) / "Concentration lente" (-20, REF-3).
- Pouvoir "Concentration psy" — activé "à la demande" sur la fiche (bouton dédié sous chaque
  pouvoir, réservé au propriétaire ou au MJ) à un palier ≤ son score (`Character.activePsyPowers`,
  cf. `ActivePsyPower` dans `shared/types.ts`) ; seul pouvoir du catalogue à avoir un effet chiffré
  sur le RA parmi la vingtaine décrite dans les règles.

L'écran "Suivi des constantes" affiche le RA de chaque personnage sur sa tuile, un rang courant en
haut de l'écran (boutons Précédent/Suivant pour dérouler le round — "Suivant" reboucle à 0 une fois
dépassé le plus haut RA parmi les personnages en jeu) et surligne les tuiles dont le RA correspond
exactement au rang affiché — plusieurs personnages peuvent agir au même rang.

## Activation des pouvoirs psy et coût en PSP

Chaque pouvoir possédé (`PsyPowersPanel`) a un bouton "Activer" dédié, réservé au propriétaire du
personnage ou à un MJ membre du groupe (`canEditCharacter`, comme le reste de l'édition de la
fiche) — un simple lecteur (autre joueur du groupe consultant la fiche) ne le voit pas.

Règle du jet de dé (jouée à table, hors de l'app) : le dé (1-10) s'ajoute au score total du pouvoir
ou de la compétence (score + caractéristique liée + Affinité/autres modificateurs, déjà affiché sur
la fiche — `getPsyPowerTotal`/`getSkillDisplayTotal`). Ce résultat détermine la réussite, et l'effet
de **tout palier ≤ à ce résultat** devient accessible — le palier n'est donc jamais un terme à
additionner au score ni un seuil que l'app validerait elle-même ; l'app n'a pas connaissance du jet
(non tracké). Tous les paliers — 10 (gratuit), 15, 20, 25, 30 ou 35
(`calc-engine.PSY_POWER_LEVELS`) — restent sélectionnables à l'activation quel que soit le score
du personnage : c'est au joueur/MJ de choisir, après avoir déterminé à table quel palier est
accessible, celui qu'il active réellement (il peut aussi choisir un palier plus bas pour économiser
du PSP). Le coût en PSP du palier (0/1/2/3/4/5, cf. `getPsyPowerActivationCost`) est
décompté de `Character.pspCurrent` à l'activation et remboursé à la désactivation (clampé entre 0
et `pspMax`, cf. `CharacterSheet.setActivePower`). "Concentration psy" garde son mécanisme dédié
(`calc-engine.getConcentrationPsyAttributeBonus`) : aux paliers 15/20, un sélecteur dédié (toujours
visible à ces paliers, pas replié) impose de choisir UNE caractéristique physique (REF/DEX/VIT) à
booster ; à partir du palier 25, les trois sont boostées automatiquement (simple repère informatif,
pas de sélecteur). Le calcul se base sur le score TOTAL du pouvoir — score de base + Volonté +
Affinité, cf. `getPsyPowerTotal` — et non son seul score de base (cas réel signalé : Karun a un
score de base de 3 dans Concentration psy, mais un total de 15 une fois Volonté et Affinité
ajoutés ; le bonus doit se calculer sur ce 15, pas sur ce 3). Le bonus obtenu est mis en évidence
comme celui de tout autre pouvoir (badge ambre sur `AttributesPanel`, pris en compte dans le RA
pour REF) — corrige un gap où choisir DEX/VIT plutôt que REF n'avait auparavant aucun effet visible
nulle part dans l'app. Pour tout
autre pouvoir qui modifie une caractéristique ou une compétence (règle non structurée en formule
dans ce moteur), un "effet" optionnel se choisit manuellement à
l'activation — repliée par défaut derrière un bouton "+ Effet (optionnel)" pour garder la ligne
d'activation courte quand ce pouvoir n'a rien à configurer : caractéristique et/ou compétence ciblée
(`ActivePsyPower.boostAttribute`/`boostSkillName`), valeur du bonus (`boostAmount`), et durée
indicative "un tour" (immédiat) ou "le combat" (`duration`). Ce bonus est ajouté et mis en évidence
(badge ambre) à l'endroit concerné —
`AttributesPanel` pour une caractéristique (et pris en compte dans le RA si REF), `SkillsPanel` pour
une compétence — et signalé sur la tuile du personnage à l'écran "Suivi des constantes" par une
icône dédiée par attribut boosté (`CharacterSummary.boostedAttributes`, cf.
`calc-engine.getBoostedAttributes`) : 💪 Force, 🧘🏻‍♀️ Vitalité, 🎯 Dextérité, ⚡ Réflexe,
👁️ Perception, 🗣️ Communication, 🧠 Intelligence, 🙏 Volonté. Une compétence boostée (pas un
attribut) affiche à la place un indicateur générique "✨" (`boostedSkillNames`, cf.
`calc-engine.getBoostedSkillNames`).

Le bouton "Fin de combat" (MJ, écran "Suivi des constantes", `POST /api/characters/end-combat`)
désactive d'un coup tous les pouvoirs actifs des personnages en jeu du groupe et rembourse leur PSP
— aucune expiration automatique par tour n'est codée (portée hors périmètre de cette itération),
seule cette action groupée ou une désactivation manuelle par fiche met fin à un pouvoir actif.

Le bouton "Donner de l'XP à tous" (MJ, écran "Suivi des constantes",
`POST /api/characters/group-xp`) applique le même montant d'XP, choisi par le MJ, à tous les
personnages **joueurs** actuellement en jeu du groupe en une seule action — même mécanisme que le
bouton "+XP" par tuile (`POST /:id/xp`, alimente `xp` et `xpAvailable` symétriquement), mais groupé.
Les PNJ ne sont pas concernés : l'XP est un mécanisme de progression des joueurs.

## Descriptions du catalogue et infobulles

Compétences, avantages/inconvénients et pouvoirs psy portent chacun une `description` extraite des
Règles ADD40K V0.2 (`src/shared/reference-data.ts`, croisé avec le classeur Excel dès l'origine —
cf. l'en-tête du fichier). Affichée en infobulle native (attribut `title`) au survol du nom, en
lecture seule, sur la fiche personnage. Quelques entrées du catalogue n'ont pas d'équivalent
identifiable dans les règles (ex. "Sciences théo", "Affinité (VOL) Téléportation") et restent sans
description plutôt que d'en inventer une. Armes et armures n'ont pas de description : les règles ne
décrivent que le tableau chiffré (dégâts/RA/VP/prix), sans texte par objet.

## Fiche repliable

Chaque section de la fiche personnage (Identité, Attributs, Compétences, Armes, Armures, Pouvoirs
psy, Avantages, Équipement, Budget de points...) se replie/déplie au clic sur son titre
(`Section` dans `CharacterSheetPanels.tsx`) — pratique sur mobile pour ne garder ouvert que ce dont
on a besoin en séance. Ouvertes par défaut, état non persisté (juste un confort d'affichage pendant
la session).

## Localisations

La table de localisation des touches (d10 : 1-2 jambe g., 3-4 jambe d., 5-7 torse, 8 bras g., 9 bras
d., 10 tête) est affichée comme une silhouette (`LocalisationSilhouette`,
`RaceArmorSilhouette.tsx`) à côté de la silhouette d'armure sur la fiche (section "Armures"), et en
repère générique en haut de l'écran "Suivi des constantes" — remplace l'ancienne section texte
"Localisations" en fin de fiche.

## Budget de points hors limites

Un solde négatif (dépense au-delà du budget) bloque l'enregistrement de la fiche en mode édition —
il faut d'abord ajuster la fiche, ou passer par le MJ : soit une distribution d'XP (ci-dessus), soit
le bouton "Accepter" du message d'avertissement rouge, qui absorbe le déficit dans les points de
départ pour ramener le solde à 0 (`onAcceptDeficit`, `BudgetPanel`).

## Compétences gratuites (justifiées par un avantage/du matériel)

Une compétence peut être marquée "Gratuite (avantage/matériel)" sur la fiche (`SkillEntry.free`,
`SkillsPanel`) : elle reste dans la même liste de compétences (rien à part, rien à oublier en jeu)
mais son coût est exclu du budget de points (`calc-engine.getSkillsCostTotal`) — utile pour une
compétence déjà acquise via un avantage et/ou du matériel plutôt qu'achetée en XP, ex. "Résistance
mentale" de Conrad Lingus, obtenue grâce à son collier Alphacien (+3) ET à l'avantage "Volonté de
fer" (+3). Comme pour les modificateurs d'arme (`WeaponEntry.modifiers`, section RA ci-dessus), une
compétence gratuite accepte **plusieurs lignes de justification** (`SkillEntry.justifications`,
bouton "+ Justification" / "Justifications (N)") — chaque ligne (texte libre, autocomplété depuis
les libellés d'avantages/matériel de la fiche) peut porter sa propre contribution en points, qui
s'additionne au score de base pour former le score total joué
(`calc-engine.getSkillJustifiedScore` — même principe que `getWeaponTotals`, base + somme des
modificateurs). L'ancien champ à une seule justification (`SkillEntry.justification`) reste lisible
sur les fiches existantes (migration transparente en lecture, cf.
`calc-engine.getSkillJustifications`) sans réécriture forcée. Comme une compétence gratuite est le
plus souvent hors du catalogue de règle (son nom ne suit donc pas la convention "Nom (ATTR)" utilisée
pour en déduire l'attribut lié), son nom se saisit en texte libre et son attribut se choisit
manuellement dans un sélecteur dédié (`SkillEntry.attribute`, prioritaire sur le parsing du nom —
`calc-engine.getSkillTotal`).

## Affinité (modificateur pour une compétence, un pouvoir, ou toute une discipline)

Une compétence peut être marquée "Affinité" (`SkillEntry.isAffinity`, indépendant de "Gratuite" —
les deux peuvent se cumuler) : un pur modificateur, sans ajout de son propre attribut à son score
affiché (déjà compté une fois au niveau de la cible, cf. `calc-engine.getSkillDisplayTotal`). La
cible se choisit explicitement à l'édition plutôt que d'être déduite du nom de la ligne — trois
formes possibles, un seul champ renseigné à la fois :
- `affinityTargetSkillName` — une autre compétence précise (ex. "Affinité tir" boostant "Arme de
  poing (PER)") ; nouveau, sans équivalent avant cette itération (l'Affinité ne ciblait auparavant
  que des pouvoirs psy).
- `affinityTargetPowerName` — un pouvoir psy précis.
- `affinityTargetDiscipline` — toute une discipline/science de pouvoirs psy (ex. "Psychokinésie")
  — s'applique à tous les pouvoirs de cette discipline sans avoir à les cibler un par un.

Le bonus s'ajoute au score total affiché de sa cible (`calc-engine.getPowerAffinityBonus` pour un
pouvoir — `getPsyPowerTotal` en tient compte automatiquement — ou `getSkillAffinityBonus` pour une
compétence, mis en évidence par un badge ambre dans `SkillsPanel`, comme un bonus de pouvoir actif).
L'ancienne compétence catalogue "Affinité (VOL) Téléportation" (un nom figé, dédié uniquement au
pouvoir "Téléportation") reste reconnue en lecture pour les fiches existantes — rétrocompatibilité
transparente, sans réécriture forcée — mais le mécanisme désormais recommandé est le ciblage
explicite ci-dessus, disponible pour n'importe quelle ligne "Affinité" ajoutée sur la fiche.

## Traduction

Chaque compte choisit sa langue d'interface (`users.language`, `migrations/0007_language.sql`,
`fr` ou `en` — champ modifiable en self-service depuis la page Profil, `PUT
/api/profile/language`). Traduction minimale côté frontend (`src/frontend/lib/i18n.ts`) : le texte
français d'origine sert lui-même de clé de dictionnaire (pas de clés sémantiques séparées à
maintenir) ; `t("Texte français exact")` renvoie la traduction anglaise si elle existe, sinon
retombe silencieusement sur le français — un texte pas encore traduit reste donc lisible plutôt que
de planter ou d'afficher une clé brute. Couvre aujourd'hui les écrans joueur/MJ (Accueil, Profil,
Personnages, Suivi des constantes, Fiche personnage et ses panneaux). Restent en français
uniquement : les pages d'administration (`admin/GamesRulesets.tsx`, `admin/PlayerGroups.tsx`,
`admin/Accounts.tsx`) et la page de connexion (langue du compte pas encore connue avant
authentification) — pistes pour une prochaine itération si une couverture complète est nécessaire.
Ajouter une 3ᵉ langue : créer son dictionnaire dans `i18n.ts`, l'ajouter à `DICTIONARIES`, et
lister le nouveau code dans `Language` (`shared/types.ts`) et `VALID_LANGUAGES`
(`routes/profile.ts`).

## Page Documentation (dans l'app)

Accessible depuis l'écran "Personnages" de chaque groupe (`/documentation/:groupId`,
`Documentation.tsx`) — ouverte à tout membre approuvé (joueur ou MJ), pas seulement au MJ. Deux
volets :
- **Guide de la plateforme** (`src/frontend/lib/platform-guide.ts`) : contenu générique
  d'utilisation de l'app, indépendant de la règle jouée — sections communes (navigation, fiche,
  attributs/compétences, armes/armures, pouvoirs psy, budget, import/export) puis spécifiques au
  rôle (joueur : sa fiche, ses coéquipiers ; MJ : PNJ, Suivi des constantes, XP, demandes
  d'adhésion, solde négatif, personnalisation du groupe). Bilingue par bloc complet (FR/EN, pas de
  traduction phrase à phrase comme `i18n.ts` — plus adapté à de la prose longue) ; suit la langue
  choisie sur le profil.
- **Règles du jeu** : rendu direct du catalogue (`ReferenceData`) de la règle assignée à ce groupe
  (races, compétences, armes, armures, pouvoirs psy, avantages/inconvénients, table de coût), via
  `GET /api/groups/:id/reference` (nouvelle route, ouverte à tout membre — pas besoin des droits
  admin pour consulter les règles de sa propre table). Reste dans la langue source du catalogue
  (français pour ADD40K) — seul le chrome de la page (titres de tableaux) suit la langue du
  compte ; traduire le contenu du catalogue lui-même est hors périmètre de cette itération.

## Comptes et plateforme

Trois rôles : `admin` (gère jeux/règles/groupes de joueurs et les comptes, pages `/admin/jeux` et
`/admin/groupes` — membre d'aucun groupe), `gm` (MJ d'un ou plusieurs groupes : édite tous les
personnages de chacun, y crée des PNJ) et `player` (lié à un `character_id` par groupe, édite
uniquement sa fiche). Un compte peut appartenir à **plusieurs groupes de joueurs en même temps**
(table `group_memberships`, `migrations/0005_memberships.sql` — remplace l'ancien
`player_group_id` unique) ; les données (personnages, catalogue de règle) restent isolées par
groupe — un joueur ou MJ ne voit que les personnages des groupes dont il est membre, lisibles par
tous les autres membres de chacun (utile en séance pour consulter la fiche d'un coéquipier).
L'accueil liste les groupes du compte ; chacun a son propre lien de dossier Drive personnalisable
(`player_groups.drive_url`, réglable par un admin ou en self-service par un MJ membre du groupe).

Rejoindre un groupe passe désormais par une **demande d'adhésion** : un joueur ou MJ qui demande à
rejoindre un groupe (page Profil) n'y a accès qu'une fois la demande approuvée par un MJ déjà
membre de ce groupe (panneau "Demandes d'adhésion en attente" sur l'écran Personnages du groupe,
`group_memberships.status`, `migrations/0006_join_approval.sql`) — avant approbation, la demande
est visible côté joueur ("en attente d'approbation") mais ne donne aucun accès aux personnages ni
au catalogue du groupe. Un admin garde un raccourci d'ajout direct, toujours approuvé, qui
contourne ce circuit.

Les données existantes (import Excel initial) forment le jeu/règle/groupe "ADD40K"
(`migrations/0003_platform.sql`, généré par `scripts/generate_platform_seed_sql.mjs`) — un admin
peut créer d'autres jeux/règles/groupes pour d'autres tables via l'interface, sans toucher au
groupe ADD40K existant. Le catalogue d'une règle (races/compétences/armes/armures/pouvoirs
psy/avantages/table de coût) est éditable depuis `/admin/jeux` ; une nouvelle règle démarre avec
un catalogue vide.

## Tests et déploiement

```bash
npm run typecheck
npm run test              # Vitest, src/shared/calc-engine.test.ts
npm run deploy            # release-check.sh -> build -> wrangler deploy
```

`npm run deploy` **met l'app en ligne publiquement** — ne l'exécuter qu'après validation locale
et accord explicite. Avant le tout premier déploiement : `wrangler d1 create r2t2`, reporter
le `database_id` dans `wrangler.jsonc`, puis `npm run db:migrate:remote`.

## Documentation

- `docs/API_REFERENCE.md` — routes `/api/*`.
- `docs/TESTS.md` — inventaire de scénarios (automatisés + manuels).
- `.claude/skills/cloudflare-add40k/SKILL.md` — bindings, migrations, pièges connus.

## Hors périmètre (v1)

Assistant de création de personnage complet, aides de jeu visuelles de combat (bonus
situationnels), édition en ligne du catalogue de règles — cf. plan de conception.
