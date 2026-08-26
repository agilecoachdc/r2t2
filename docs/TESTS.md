# Inventaire de tests — add40k

Automatisé par `npm run test` (Vitest, `src/shared/calc-engine.test.ts`) : formules PV/PSP,
coût compétences/pouvoirs, budget de points, cas réel Stern Tack figé (voir le fichier de test
pour les valeurs). `scripts/release-check.sh` fait tourner ce test + le typecheck avant chaque
déploiement.

Les scénarios ci-dessous sont **manuels** — à repasser après tout changement touchant auth,
permissions ou l'UI de la fiche. Vérifiés une première fois le 2026-08-15 (§1-§4 tous ✅ via le
navigateur intégré, cf. session de build).

## §1 — Auth

- [ ] Login MJ (`mj` + mot de passe généré) → redirigé vers `/`, liste des 8 personnages visible.
- [ ] Login joueur (ex. `jo` / Karun) → même liste visible en lecture, badge "Ma fiche" sur Karun
      uniquement.
- [ ] Login avec mauvais mot de passe → message "Identifiants invalides", pas de redirection.
- [ ] Déconnexion → retour à `/login`, `GET /api/auth/me` renvoie 401.

## §2 — Consultation

- [ ] Ouvrir une fiche (ex. Stern Tack) → identité, PV/PSP, attributs, compétences, armes,
      armures, pouvoirs psy, avantages, équipement, budget de points et localisations tous
      affichés sans erreur console.
- [ ] Le solde de points affiche un avertissement rouge si négatif (cas réel : Stern Tack,
      Frigg, Jonas, Stella sont tous en négatif après import — attendu, cf.
      `scripts/import-report.md`).
- [ ] Depuis l'écran "Personnages" d'un groupe, cliquer "Documentation" → guide de la plateforme
      (sections communes + spécifiques au rôle connecté) et règles du jeu du groupe (races,
      compétences, armes, armures, pouvoirs psy, avantages, table de coût) affichés sans erreur.
      Connecté en joueur → section "Pour le joueur" (pas "Pour le MJ"). Changer la langue du
      compte (page Profil) → le guide de la plateforme bascule en anglais, les règles du jeu
      restent en français (contenu du catalogue non traduit).

## §3 — Édition

- [ ] Connecté en MJ ou en tant que propriétaire : bouton "Modifier" visible, bascule les
      champs en inputs.
- [ ] Modifier une compétence (score) → le coût et le solde se recalculent en direct, avant même
      d'enregistrer.
- [ ] Cliquer "Enregistrer" → retour en lecture seule, valeurs persistées (vérifiable via
      `wrangler d1 execute r2t2 --local --command "SELECT data FROM characters WHERE id=...`).
- [ ] Cliquer "Annuler" après modification → repasse en lecture seule sans appeler l'API,
      valeurs d'avant l'édition restaurées au prochain chargement.
- [ ] Boutons +/- PV et PSP → mettent à jour le compteur actuel/max immédiatement (état local),
      persistés uniquement après "Enregistrer".
- [ ] Ajouter une compétence, cocher "Gratuite (avantage/matériel)" → le champ nom devient du
      texte libre (plus le catalogue), un sélecteur d'attribut et un bouton "+ Justification"
      apparaissent ; le solde de points ne bouge pas quel que soit le score saisi (coût exclu du
      budget). Décocher → la compétence redevient sélectionnable depuis le catalogue et compte à
      nouveau dans le coût.
- [ ] Sur une compétence gratuite, cliquer "+ Justification" deux fois (ex. cas réel Conrad Lingus :
      "Collier Alphacien" +3 puis "Volonté de fer" +3) → chaque ligne a son propre champ score, le
      total affiché = score de base + somme des lignes (6 dans cet exemple), le badge "Gratuite"
      en lecture seule liste les deux justifications au survol.
- [ ] Activer un pouvoir psy (bouton dédié, hors mode édition) à un palier payant (ex. 20, 2 PSP)
      → PSP courant diminue de 2 immédiatement, badge "Actif · niveau 20 (2 PSP)" affiché,
      bouton "Désactiver" disponible. Désactiver → PSP remboursé (clampé au max), badge disparaît.
- [ ] Sur un pouvoir autre que "Concentration psy", renseigner l'effet optionnel en ciblant une
      **caractéristique** (ex. FO) + valeur du bonus avant d'activer → le bonus apparaît en
      évidence (badge ambre) sur l'attribut concerné (`AttributesPanel`), et l'icône dédiée à cet
      attribut (💪 FO, 🧘🏻‍♀️ VIT, 🎯 DEX, ⚡ REF, 👁️ PER, 🗣️ COM, 🧠 INT, 🙏 VOL) apparaît sur
      la tuile du personnage à l'écran "Suivi des constantes" (infobulle = nom de l'attribut).
      Cibler une **compétence** à la place → badge ambre sur la compétence concernée
      (`SkillsPanel`), et c'est l'indicateur générique "✨" (pas une icône d'attribut) qui apparaît
      sur la tuile, infobulle listant le(s) nom(s) de compétence(s) boostée(s).
- [ ] Sur "Concentration psy" (cas réel Karun), activer à un palier ≥15 avec un attribut choisi (ou
      ≥25, toutes caractéristiques physiques) → l'icône REF (⚡) et/ou DEX (🎯) et/ou VIT (🧘🏻‍♀️)
      apparaissent sur sa tuile selon l'attribut(s) réellement boosté(s), en plus de toute icône due
      à un autre pouvoir actif (plusieurs icônes peuvent coexister sur une même tuile).
- [ ] Sur l'écran "Suivi des constantes" (MJ), avec au moins un pouvoir actif sur un personnage en
      jeu : cliquer "Fin de combat" → tous les pouvoirs actifs des personnages en jeu sont
      désactivés, leur PSP remboursé, toutes les icônes de boost (attribut ou "✨") disparaissent de
      leurs tuiles.
- [ ] Sur l'écran "Suivi des constantes" (MJ), avec au moins 2 personnages joueurs en jeu (et,
      idéalement, 1 PNJ en jeu) : cliquer "Donner de l'XP à tous", saisir un montant (ex. 5),
      valider → "XP gagnée" et "dispo" augmentent de 5 sur chaque tuile **joueur** en jeu, mais
      restent inchangés sur les tuiles PNJ et sur tout personnage joueur non "en jeu". Saisir un
      montant négatif → mêmes tuiles concernées, "XP gagnée" et "dispo" diminuent d'autant (peuvent
      devenir négatifs, aucun plancher côté MJ — même comportement que le "+XP" par tuile).
- [ ] Sur "Concentration psy" (ex. cas réel Karun : score de base 3, mais total 15 une fois Volonté
      + Affinité ajoutés), activer à un palier avec REF choisi → le bonus REF (`AttributesPanel`,
      pris en compte dans le RA) doit se calculer sur le score TOTAL (15), pas le score de base
      seul (3) — au palier 15 (+1 par tranche de 5), bonus attendu +3, pas 0.
- [ ] Sur "Concentration psy" (ex. cas réel Karun), choisir le palier 15 ou 20 → un sélecteur
      "Caractéristique boostée" (REF/DEX/VIT) apparaît toujours, sans clic supplémentaire ; choisir
      DEX ou VIT (pas REF) et activer → le bonus apparaît en évidence sur l'attribut choisi dans
      `AttributesPanel` (pas seulement sur le RA, réservé à REF). Choisir le palier 25 ou plus →
      le sélecteur disparaît, remplacé par la mention "Toutes les caractéristiques physiques
      (REF/DEX/VIT)", et les trois sont boostées sans choix à activer.
- [ ] Ajouter une compétence, cocher "Affinité" (indépendant de "Gratuite") → le champ nom devient
      du texte libre, un sélecteur "Compétence"/"Pouvoir"/"Discipline" apparaît. Choisir "Pouvoir"
      et cibler un pouvoir psy possédé → le score total de ce pouvoir (`PsyPowersPanel`) augmente
      du score de la ligne d'Affinité, badge ambre "+N" affiché à côté du total du pouvoir. Choisir
      "Discipline" → tous les pouvoirs de cette discipline en bénéficient. Choisir "Compétence" et
      cibler une autre compétence de la fiche → le total de cette compétence (`SkillsPanel`)
      augmente d'autant, badge ambre affiché. La ligne d'Affinité elle-même n'affiche que son score
      de base en "Total" (pas de colonne "Attribut" — toujours "—"), même si son nom contient un
      code d'attribut. Le badge bleu "Affinité" en lecture seule affiche la cible réelle (ex.
      "→ Téléportation"), pas le mot "Affinité" répété (cas réel signalé : une ligne nommée
      "Affinité" avec le badge affichait "Affinité Affinité").
- [ ] Sur un pouvoir psy, cliquer "Activer" → aucune mention "Total avant jet" (règle mal comprise
      lors d'une itération précédente, retirée : le dé se joue à table et s'ajoute au score déjà
      affiché — Σ, score + Volonté + Affinité — ce n'est pas quelque chose que l'app calcule ou
      affiche séparément). Seuls le sélecteur de palier (avec coût en PSP) et, pour "Concentration
      psy", le sélecteur de caractéristique/la mention "Toutes les caractéristiques physiques"
      apparaissent.
- [ ] Sur une fiche sans l'avantage "Ambidextre" : cocher "équipée" sur une 2ᵉ arme (la 1ʳᵉ reste
      équipée, deux armes autorisées par défaut) → un message rouge "Combat à deux armes sans
      Ambidextre : -3 au score de chaque arme équipée" apparaît, et le "Score" affiché de chacune
      des deux armes équipées diminue de 3 (pas les dégâts ni le RA). Cocher une 3ᵉ arme →
      déséquipe automatiquement la plus ancienne des deux (toujours 2 maximum). Ajouter l'avantage
      "Ambidextre: +10" → le message rouge disparaît, les deux armes retrouvent leur score plein.
- [ ] Sur la fiche d'un personnage sans avantage "Revenus", panneau "Budget de points" → section
      "Crédits" affiche "Revenu mensuel" = 500. Ajouter l'avantage "Revenus : +20" → "Revenu
      mensuel" passe à 2500 (500 + 20 x 100 — multiplicateur x100, pas x1000, corrigé en session).
- [ ] Sur l'écran "Suivi des constantes" (MJ), avec au moins 2 personnages joueurs en jeu (et,
      idéalement, 1 avec l'avantage "Revenus", 1 PNJ en jeu) : cliquer "💵 +(X) mois", saisir 1,
      valider → chaque personnage **joueur** en jeu reçoit SON PROPRE revenu mensuel (💵 sur sa
      tuile augmente du montant affiché dans "Revenu mensuel" sur sa fiche, pas un montant uniforme
      pour tous) ; les tuiles PNJ et les personnages joueurs non "en jeu" restent inchangés. Saisir 2
      → chaque personnage reçoit le double de son propre revenu mensuel.
- [ ] Sur l'écran "Suivi des constantes" (MJ), sur une tuile joueur ou PNJ : cliquer le bouton "+Cr"
      juste à côté du solde 💵, saisir un montant (ex. 300), valider → le solde de CE personnage
      uniquement augmente de 300, les autres tuiles restent inchangées. Saisir un montant négatif →
      le solde diminue d'autant (peut devenir négatif, aucun plancher — même comportement que "+XP").
      Le montant saisi est bien un nombre de Cr (pas un nombre de mois — ça, c'est réservé au bouton
      groupé "+(X) mois"). Vérifier en particulier sur mobile (cas réel signalé) : ouvrir "+Cr",
      taper un montant → la tuile ne doit JAMAIS naviguer vers la fiche pendant que le formulaire est
      ouvert, même après un léger délai (clic fantôme post-changement de mise en page) ; seul un clic
      explicite hors formulaire (ou "×") doit fermer le mini-formulaire sans naviguer, et un clic sur
      le reste de la tuile une fois le formulaire refermé doit naviguer normalement.
- [ ] Sur la fiche détaillée d'un personnage (MJ), panneau "Budget de points", section "Crédits" :
      champ "Donner des crédits" + "Valider" → même effet que le "+Cr" par tuile (solde mis à jour
      immédiatement, positif ou négatif) ; sert de repli si le bouton par tuile est interrompu par
      une navigation avant validation.
- [ ] Sur une fiche en édition, avec un solde de quelques centaines de Cr : dans "Armes", cliquer
      "+ Ajouter une arme" puis choisir dans le catalogue une arme au prix connu et inférieur au
      solde → le solde affiché en haut de la section ("💵 Solde : …") diminue du prix de l'arme.
      Choisir ensuite une arme au prix SUPÉRIEUR au solde restant → message rouge "Solde insuffisant
      pour…", la sélection n'est PAS appliquée (le nom de l'arme reste vide), le solde ne bouge pas.
      Rouvrir le sélecteur sur une ligne d'arme DÉJÀ nommée et changer son choix → aucune déduction
      (ce n'est pas un nouvel achat). Même comportement à vérifier sur "Armures" (nécessite qu'un
      admin ait renseigné un prix sur au moins une armure du catalogue, cf. éditeur admin, onglet
      "Armures", colonne "Prix").
- [ ] Sur "Équipement" en édition : saisir un nom et un prix supérieur au solde dans le
      mini-formulaire d'ajout → message rouge "Solde insuffisant pour…", rien n'est ajouté. Saisir un
      prix inférieur ou égal au solde → l'objet est ajouté à la liste (avec son prix affiché entre
      parenthèses en lecture seule) et le solde diminue d'autant. Laisser le prix vide → l'objet est
      ajouté sans rien déduire (comportement identique à avant l'ajout du prix). Modifier ensuite le
      prix affiché sur une ligne déjà ajoutée → aucun effet sur le solde (seul l'ajout déduit).

## §4 — Permissions

- [ ] Connecté en tant que joueur A, `GET /api/characters/<perso-B>` → 200, `canEdit: false`,
      pas de bouton "Modifier" affiché.
- [ ] `PUT /api/characters/<perso-B>` depuis le compte du joueur A → 403.
- [ ] Connecté en MJ, `PUT` sur n'importe quel personnage → 200.

## Non couvert (hors périmètre MVP)

- Assistant de création de personnage complet (point-buy from scratch).
- Aides de jeu visuelles de combat.
- E2E automatisé (Playwright) — app à petite échelle, groupe restreint ; à ajouter si le projet
  grossit (cf. `.claude/skills/cloudflare-r2t2/SKILL.md`).
