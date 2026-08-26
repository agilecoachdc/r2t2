// Moteur de calcul partagé (Worker + frontend). Réimplémentation propre des
// formules de la feuille `données` du classeur Excel d'origine — voir
// scripts/import_xlsx.py pour la correspondance avec les cellules Excel, et
// le plan (lively-rolling-comet.md) pour la justification des choix.
//
// Écarts assumés avec la formule Excel du solde de points (données!H26),
// confirmés explicitement par le MJ :
//   1. Catalogue : l'inconvénient "Dans les nuages" (-30, tier -3) pointait
//      vers la mauvaise cellule dans le classeur (VLOOKUP sur la ligne d'un
//      autre avantage) et se calculait comme +20. Fix appliqué au niveau de
//      la donnée de référence (reference-data.ts) : les avantages/inconvénients
//      sont toujours dérivés du catalogue par libellé, jamais de la cellule
//      mise en cache par personnage.
//   2. Sens du calcul (getBudgetSummary.solde) : le classeur fait `+K40`
//      (somme brute des avantages/inconvénients). Or un avantage doit COÛTER
//      des points et un inconvénient doit en DONNER — c'est l'inverse. Ce
//      moteur fait donc `- advantagesNet`, pas `+`.
//   3. Rang d'Action (getWeaponTotals.ra) : la réimplémentation du 16/08
//      (cf. investigation weapon-modifiers) avait traité le RA comme les
//      autres stats d'arme (base + somme des modificateurs), en oubliant la
//      partie "BASE_RA - Réflexe" de la formule — confirmé par le MJ le
//      18/08 sur le cas réel Wild Predator de Conrad Lingus. Deux
//      corrections ultérieures du MJ, mêmes échanges du 19/08 : (a) la
//      constante elle-même est 5, pas 8 (valeur initialement supposée pour
//      coller au premier calcul manuel) ; (b) le RA de catalogue d'une arme
//      (ex. 2 pour Wild Predator) est déjà un rang à part entière, lu tel
//      quel dans la table du classeur — il s'ADDITIONNE au socle BASE_RA -
//      Réflexe (avec les modificateurs justifiés, ex. -1 "Améliorations
//      WP"), il ne s'en soustrait pas. RA final confirmé pour ce cas : 6
//      (5 - 0 + 2 - 1). Voir BASE_RA plus bas.

import type {
  Attribute,
  AttributeScores,
  Character,
  ReferenceData,
  SkillEntry,
  WeaponEntry,
  WeaponType,
} from "./types";
import { ATTRIBUTES } from "./types";

/**
 * Extrait le code d'attribut (COM/INT/DEX/PER/VOL/VIT/REF/FO) depuis un nom
 * de compétence tel que stocké sur les fiches, ex. "Commandement (COM)" ou
 * "Affinité (VOL) Téléportation" (le code peut ne pas être en fin de nom).
 */
export function parseSkillAttribute(name: string): Attribute | null {
  const match = name.match(/\b(FO|VIT|DEX|REF|PER|COM|INT|VOL)\b/);
  return (match?.[1] as Attribute | undefined) ?? null;
}

export interface SkillTotal {
  attribute: Attribute | null;
  attributeValue: number;
  total: number;
}

/**
 * Score total d'une compétence = score + total de l'attribut lié.
 * `attributeOverride` (SkillEntry.attribute) prend le pas sur le parsing du
 * nom quand renseigné — nécessaire pour une compétence hors catalogue (texte
 * libre, ex. compétence `free` justifiée par un avantage/du matériel) dont
 * le nom ne suit pas la convention "Nom (ATTR)" du catalogue.
 */
export function getSkillTotal(
  skillName: string,
  score: number,
  attributeTotals: AttributeScores,
  attributeOverride?: Attribute | null,
): SkillTotal {
  const attribute = attributeOverride ?? parseSkillAttribute(skillName);
  const attributeValue = attribute ? attributeTotals[attribute] : 0;
  return { attribute, attributeValue, total: score + attributeValue };
}

/**
 * Lit les lignes de justification d'une compétence `free` (SkillEntry.
 * justifications), avec migration transparente de l'ancien champ
 * `justification` (une seule ligne, texte libre) vers la nouvelle forme
 * (plusieurs lignes, comme WeaponEntry.modifiers) — pas de réécriture
 * forcée des fiches déjà enregistrées avec l'ancien champ.
 */
export function getSkillJustifications(
  skill: Pick<SkillEntry, "justification" | "justifications">,
): NonNullable<SkillEntry["justifications"]> {
  if (skill.justifications) return skill.justifications;
  if (skill.justification) return [{ justification: skill.justification }];
  return [];
}

/**
 * Score total joué d'une compétence = score de base + somme des
 * contributions de ses justifications (cf. getSkillJustifications) — même
 * principe que getWeaponTotals (base + modificateurs). Sans effet pour une
 * compétence sans justification (total = score de base, comportement
 * inchangé).
 */
export function getSkillJustifiedScore(
  skill: Pick<SkillEntry, "score" | "justification" | "justifications">,
): number {
  return skill.score + getSkillJustifications(skill).reduce((sum, j) => sum + (j.score ?? 0), 0);
}

/** Bonus racial + bonus tech appliqués au score de base, par attribut. */
export function getAttributeTotal(
  character: Pick<Character, "attributeScores" | "attributeTechBonus" | "race">,
  reference: ReferenceData,
  attribute: Attribute,
): number {
  const raceDef = reference.races.find((r) => r.race === character.race);
  const base = character.attributeScores[attribute] ?? 0;
  const racial = raceDef?.attributeBonus[attribute] ?? 0;
  const tech = character.attributeTechBonus[attribute] ?? 0;
  return base + racial + tech;
}

export function getAllAttributeTotals(
  character: Pick<Character, "attributeScores" | "attributeTechBonus" | "race">,
  reference: ReferenceData,
): AttributeScores {
  const result = {} as AttributeScores;
  for (const attribute of ATTRIBUTES) {
    result[attribute] = getAttributeTotal(character, reference, attribute);
  }
  return result;
}

/** Somme des 8 totaux d'attributs — doit valoir +7 à la création (données!B22), informatif seulement en édition. */
export function getAttributeSum(
  character: Pick<Character, "attributeScores" | "attributeTechBonus" | "race">,
  reference: ReferenceData,
): number {
  const totals = getAllAttributeTotals(character, reference);
  return ATTRIBUTES.reduce((sum, attr) => sum + totals[attr], 0);
}

/**
 * PV max = (VIT_total + taille) x 5 + 30 (données!E24). Même formule pour
 * un PNJ : le MJ saisit juste VIT à la création (cf. characters.ts POST),
 * les autres attributs restant à 0.
 */
export function getHpMax(
  character: Pick<Character, "attributeScores" | "attributeTechBonus" | "race" | "tailleModifier">,
  reference: ReferenceData,
): number {
  const vit = getAttributeTotal(character, reference, "VIT");
  return (vit + character.tailleModifier) * 5 + 30;
}

/** PSP max = VOL_total x 5 + 30 (données!E25). */
export function getPspMax(
  character: Pick<Character, "attributeScores" | "attributeTechBonus" | "race">,
  reference: ReferenceData,
): number {
  const vol = getAttributeTotal(character, reference, "VOL");
  return vol * 5 + 30;
}

/**
 * Coût en points pour un score de compétence/pouvoir psy donné
 * (listes!A14:B29, table partagée). Un score sans entrée exacte retombe sur
 * le palier inférieur le plus proche ; un score de 0 ou négatif coûte 0.
 */
export function getSkillCost(score: number, table: ReferenceData["skillCostTable"]): number {
  if (score <= 0) return 0;
  if (table[score] !== undefined) return table[score]!;
  const knownScores = Object.keys(table)
    .map(Number)
    .filter((s) => s <= score)
    .sort((a, b) => b - a);
  const nearest = knownScores[0];
  return nearest !== undefined ? table[nearest]! : 0;
}

/**
 * Coût total des compétences — exclut les compétences `free` (déjà
 * justifiées par un avantage/du matériel de la fiche plutôt qu'achetées en
 * XP, cf. SkillEntry.free), qui restent dans la même liste mais ne
 * réduisent pas le solde de points.
 */
export function getSkillsCostTotal(
  character: Pick<Character, "skills">,
  reference: ReferenceData,
): number {
  return character.skills.reduce(
    (sum, skill) => sum + (skill.free ? 0 : getSkillCost(skill.score, reference.skillCostTable)),
    0,
  );
}

export function getPsyPowersCostTotal(
  character: Pick<Character, "psyPowers">,
  reference: ReferenceData,
): number {
  return character.psyPowers.reduce(
    (sum, power) => sum + getSkillCost(power.score, reference.skillCostTable),
    0,
  );
}

export interface ArmorTotals {
  vpTete: number;
  vpBras: number;
  vpTorse: number;
  vpJambes: number;
}

/** Total de protection = somme des VP des seules armures actives (équipées). Remplace l'affichage détaillé par armure — cf. char_sheet, qui n'affiche déjà que les noms, pas le détail VP par pièce. */
export function getArmorTotals(character: Pick<Character, "armor">): ArmorTotals {
  return character.armor
    .filter((a) => a.active)
    .reduce(
      (sum, a) => ({
        vpTete: sum.vpTete + a.vpTete,
        vpBras: sum.vpBras + a.vpBras,
        vpTorse: sum.vpTorse + a.vpTorse,
        vpJambes: sum.vpJambes + a.vpJambes,
      }),
      { vpTete: 0, vpBras: 0, vpTorse: 0, vpJambes: 0 },
    );
}

// ---------------------------------------------------------------------------
// Affinité — compétences d'Affinité (Règles ADD40K V0.2) : de purs
// modificateurs pour une compétence, un pouvoir psy précis, ou toute une
// discipline/science de pouvoirs psy (cible choisie explicitement à
// l'édition, cf. SkillEntry.isAffinity/affinityTargetSkillName/
// affinityTargetPowerName/affinityTargetDiscipline). Contrairement à une
// compétence normale, une compétence d'Affinité n'ajoute PAS son propre
// attribut (VOL) à son score affiché — cf. getSkillDisplayTotal — l'attribut
// est déjà compté une seule fois, au niveau de la cible (getPowerAffinityBonus
// pour un pouvoir ajoute VOL comme d'habitude ; getSkillAffinityBonus pour
// une compétence laisse le calcul d'attribut de la compétence ciblée
// inchangé, la contribution d'Affinité s'y ajoute en plus).
// ---------------------------------------------------------------------------

/** Nom historique (avant le ciblage explicite) d'une compétence d'Affinité dédiée à un seul pouvoir — ex. "Affinité (VOL) Téléportation". Toujours reconnu en lecture pour ne pas casser les fiches existantes. */
function legacyAffinitySkillName(powerName: string): string {
  return `Affinité (VOL) ${powerName}`;
}

/**
 * Bonus total d'Affinité pour un pouvoir psy donné = somme des compétences
 * d'Affinité du personnage qui le ciblent, soit directement par son nom
 * (`affinityTargetPowerName`), soit via toute sa discipline
 * (`affinityTargetDiscipline`, ex. une compétence "Affinité Psychokinésie"
 * boost tous les pouvoirs de cette discipline sans avoir à les cibler un
 * par un). Rétrocompatibilité : si aucune compétence "nouvelle forme" ne
 * cible ce pouvoir, retombe sur l'ancien nom figé (`legacyAffinitySkillName`)
 * — jamais les deux à la fois, pour ne pas compter un même bonus deux fois
 * une fois une fiche migrée vers le ciblage explicite.
 */
export function getPowerAffinityBonus(
  character: Pick<Character, "skills">,
  power: { name: string; discipline?: string },
): number {
  let bonus = 0;
  let matchedExplicit = false;
  for (const s of character.skills) {
    if (!s.isAffinity) continue;
    if (s.affinityTargetPowerName === power.name || (power.discipline && s.affinityTargetDiscipline === power.discipline)) {
      bonus += s.score;
      matchedExplicit = true;
    }
  }
  if (!matchedExplicit) {
    const legacy = character.skills.find((s) => !s.isAffinity && s.name === legacyAffinitySkillName(power.name));
    if (legacy) bonus += legacy.score;
  }
  return bonus;
}

/**
 * Bonus total d'Affinité pour une compétence donnée (nom exact) = somme des
 * compétences d'Affinité du personnage qui la ciblent explicitement via
 * `affinityTargetSkillName`. Nouveau mécanisme (pas d'équivalent historique
 * pour cibler une compétence, seulement un pouvoir) — s'ajoute au score
 * total affiché de la compétence ciblée (cf. getSkillDisplayTotal), en plus
 * de son propre attribut lié, qui reste calculé normalement.
 */
export function getSkillAffinityBonus(character: Pick<Character, "skills">, skillName: string): number {
  return character.skills.reduce(
    (sum, s) => sum + (s.isAffinity && s.affinityTargetSkillName === skillName ? s.score : 0),
    0,
  );
}

/**
 * Score total d'un pouvoir psy = score du pouvoir + VOL_total + bonus
 * d'Affinité le ciblant (cf. getPowerAffinityBonus ci-dessus).
 */
export function getPsyPowerTotal(
  power: { name: string; score: number; discipline?: string },
  character: Pick<Character, "skills">,
  attributeTotals: AttributeScores,
): number {
  return power.score + attributeTotals.VOL + getPowerAffinityBonus(character, power);
}

export interface SkillDisplayTotal {
  attribute: Attribute | null;
  attributeValue: number;
  /** Bonus des compétences d'Affinité ciblant cette compétence (0 pour une compétence d'Affinité elle-même, cf. ci-dessous). */
  affinityBonus: number;
  /** Bonus des pouvoirs psy actifs ciblant cette compétence (cf. getActivePsyPowerSkillBoost). 0 pour une compétence d'Affinité. */
  activeBoost: number;
  /** Score total affiché = score de base (+ justifications) + attribut + affinityBonus + activeBoost — ou juste le score de base pour une compétence d'Affinité (cf. ci-dessous). */
  total: number;
}

/**
 * Score total affiché d'une compétence sur la fiche, tous bonus combinés —
 * remplace un appel manuel à getSkillTotal + getSkillAffinityBonus +
 * getActivePsyPowerSkillBoost par les panneaux d'affichage (SkillsPanel).
 *
 * Cas particulier d'une compétence d'Affinité (`skill.isAffinity`) : son
 * propre total affiché = son score de base SEUL (+ justifications
 * éventuelles), sans ajout d'attribut ni d'aucun bonus — une compétence
 * d'Affinité n'est jamais elle-même "jouée", c'est un pur modificateur pour
 * sa cible (où l'attribut lié à la cible, lui, reste compté normalement).
 */
export function getSkillDisplayTotal(
  skill: Pick<SkillEntry, "name" | "score" | "attribute" | "isAffinity" | "justification" | "justifications">,
  character: Pick<Character, "skills" | "activePsyPowers">,
  attributeTotals: AttributeScores,
): SkillDisplayTotal {
  const baseScore = getSkillJustifiedScore(skill);
  if (skill.isAffinity) {
    return { attribute: null, attributeValue: 0, affinityBonus: 0, activeBoost: 0, total: baseScore };
  }
  const { attribute, attributeValue } = getSkillTotal(skill.name, baseScore, attributeTotals, skill.attribute);
  const affinityBonus = getSkillAffinityBonus(character, skill.name);
  const activeBoost = getActivePsyPowerSkillBoost(character, skill.name);
  return { attribute, attributeValue, affinityBonus, activeBoost, total: baseScore + attributeValue + affinityBonus + activeBoost };
}

export interface WeaponTotals {
  ra: number;
  damage: number;
  baseScore: number;
}

/**
 * Rang d'Action par défaut avant réflexes/arme : plus le RA final est bas,
 * plus le personnage agit tôt (confirmé par le MJ le 18/08 ; valeur 5
 * confirmée le 19/08, après un premier calcul manuel supposant 8). Le RA de
 * catalogue d'une arme (WeaponEntry.ra, ex. 2 pour Wild Predator) et ses
 * modificateurs justifiés ne sont donc pas le RA final — ils viennent en
 * déduction de ce socle, avec le Réflexe total du personnage.
 */
const BASE_RA = 5;

/**
 * Dégâts/Score réellement joués = valeur de base + somme des modificateurs
 * justifiés (cf. WeaponEntry.modifiers dans types.ts). RA réellement joué =
 * BASE_RA - Réflexe total + (RA de catalogue + modificateurs) : le RA de
 * catalogue d'une arme (ex. 2 pour Wild Predator) est déjà un rang à part
 * entière — lu directement dans la table du classeur, pas un malus à
 * soustraire (correction du 19/08 : la première version de cette formule
 * l'avait soustrait par erreur, oubliant que "le RA de l'arme est déjà dans
 * la table"). S'ADDITIONNE donc au socle BASE_RA - Réflexe, avec les
 * modificateurs justifiés (ex. -1 "Améliorations WP", qui réduit d'autant
 * le total puisqu'ajouté avec son propre signe). Remplace le bricolage du
 * classeur Excel d'origine (une formule figée référençant 3 lignes fixes du
 * catalogue, uniquement câblée pour le 1er emplacement d'arme, propagée par
 * copier-coller à des personnages qui n'avaient pourtant pas l'amélioration
 * — cf. investigation du 16/08).
 */
/** RA de catalogue d'une arme + ses modificateurs justifiés — terme de la formule complète (cf. getWeaponTotals/getActionRank), pas une valeur jouée en soi. */
function getWeaponRaModifier(weapon: Pick<WeaponEntry, "ra" | "modifiers">): number {
  const modifiers = weapon.modifiers ?? [];
  return weapon.ra + modifiers.reduce((sum, m) => sum + (m.ra ?? 0), 0);
}

export function getWeaponTotals(
  weapon: Pick<WeaponEntry, "ra" | "damage" | "baseScore" | "modifiers">,
  refTotal: number,
  /** Malus appliqué au score joué (ex. combat à deux armes sans Ambidextre, cf. getDualWieldPenalty) — 0 par défaut, n'affecte ni les dégâts ni le RA. */
  scorePenalty = 0,
): WeaponTotals {
  const modifiers = weapon.modifiers ?? [];
  return {
    ra: BASE_RA - refTotal + getWeaponRaModifier(weapon),
    damage: weapon.damage + modifiers.reduce((sum, m) => sum + (m.damage ?? 0), 0),
    baseScore: weapon.baseScore + modifiers.reduce((sum, m) => sum + (m.score ?? 0), 0) + scorePenalty,
  };
}

// ---------------------------------------------------------------------------
// Rang d'Action "courant" du personnage (écran MJ "Suivi des constantes") —
// même socle BASE_RA - Réflexe + arme équipée que getWeaponTotals ci-dessus,
// avec en plus les deux seuls éléments du catalogue (Règles ADD40K V0.2, cf.
// investigation du 18/08) qui modifient le Réflexe pour le calcul du RA :
//   - Avantages "Concentration rapide" (+10, REF+3) / "Concentration lente"
//     (-20, REF-3) — ne s'appliquent QUE quand le personnage a un pouvoir
//     actif ("quand vous utilisez vos pouvoirs" / "pour actionner vos
//     pouvoirs" dans le texte des avantages), pas en combat normal à l'arme.
//   - Pouvoir "Concentration psy" (Maîtrise de soi), activé "à la demande"
//     (Character.activePsyPowers) à un palier ≤ son score : seul pouvoir du
//     catalogue à moduler le Réflexe parmi les ~19 décrits dans les règles —
//     tous les autres pouvoirs peuvent être activés via la même UI mais
//     n'ont aucun effet chiffré sur le RA (portée hors périmètre de ce
//     calcul : dégâts, création de matière, téléportation...).
// ---------------------------------------------------------------------------

const CONCENTRATION_RAPIDE_LABEL = "Concentration rapide";
const CONCENTRATION_LENTE_LABEL = "Concentration lente";
const CONCENTRATION_PSY_NAME = "Concentration psy";

/**
 * +3/-3 de Réflexe pour l'activation de pouvoirs (Concentration rapide/lente,
 * cf. catalogue avantages) — appliqué seulement si le personnage a
 * effectivement un pouvoir actif (`hasActivePower`), conformément au texte
 * des avantages ("quand vous utilisez vos pouvoirs").
 */
function getConcentrationAdvantageRefDelta(
  character: Pick<Character, "advantages">,
  hasActivePower: boolean,
): number {
  if (!hasActivePower) return 0;
  const labels = character.advantages.map((a) => a.label);
  if (labels.some((l) => l.startsWith(CONCENTRATION_RAPIDE_LABEL))) return 3;
  if (labels.some((l) => l.startsWith(CONCENTRATION_LENTE_LABEL))) return -3;
  return 0;
}

const AMBIDEXTROUS_LABEL = "Ambidextre";

/** Avantage "Ambidextre" (catalogue) — annule le malus de score du combat à deux armes (cf. getDualWieldPenalty). */
export function hasAmbidextrousAdvantage(character: Pick<Character, "advantages">): boolean {
  return character.advantages.some((a) => a.label.startsWith(AMBIDEXTROUS_LABEL));
}

/**
 * Nombre maximum d'armes équipées simultanément — 2 (une par main), avec ou
 * sans l'avantage "Ambidextre" : n'importe quel personnage peut équiper
 * deux armes, seul le score en pâtit sans entraînement (cf.
 * getDualWieldPenalty ci-dessous). getActionRank ci-dessous ne lit que la
 * première arme équipée trouvée dans la liste : avec deux armes équipées,
 * seule celle-ci compte pour le Rang d'Action — combiner les deux armes
 * dans le calcul du RA est hors périmètre tant qu'aucune règle précise n'a
 * été communiquée pour le combat à deux armes.
 */
export const MAX_EQUIPPED_WEAPONS = 2;

/**
 * Malus de score par arme quand exactement deux armes sont équipées SANS
 * l'avantage "Ambidextre" (combat à deux armes sans entraînement, cf.
 * hasAmbidextrousAdvantage) — 0 sinon (une seule arme équipée, ou deux avec
 * Ambidextre qui annule le malus). S'applique au score de CHAQUE arme
 * équipée (cf. getWeaponTotals, paramètre scorePenalty), pas aux dégâts ni
 * au Rang d'Action.
 */
export function getDualWieldPenalty(character: {
  weapons: Pick<WeaponEntry, "equipped">[];
  advantages: Character["advantages"];
}): number {
  const equippedCount = character.weapons.filter((w) => w.equipped).length;
  if (equippedCount !== 2 || hasAmbidextrousAdvantage(character)) return 0;
  return -3;
}

/**
 * Attributs "physiques" que "Concentration psy" peut moduler (Règles ADD40K
 * V0.2, §Maîtrise de soi) — PRE (Présence) du classeur d'origine n'a pas
 * d'équivalent dans les 8 attributs de l'app (cf. ATTRIBUTES), donc seuls
 * REF/DEX/VIT sont concernés.
 */
export const CONCENTRATION_PSY_ATTRIBUTES: readonly Attribute[] = ["REF", "DEX", "VIT"];

/**
 * Bonus du pouvoir "Concentration psy" actif sur un attribut physique donné
 * (REF, DEX ou VIT), selon le palier choisi et le score TOTAL du personnage
 * dans ce pouvoir — score de base + Volonté + Affinité (cf. getPsyPowerTotal,
 * PAS le seul score brut du catalogue : signalé sur le cas réel Karun, dont
 * le score total dans Concentration psy est 15 alors que le score de base
 * seul n'est que 3) — (Règles ADD40K V0.2, §Maîtrise de soi) :
 *   Niveau 15 : +1 par tranche de 5 dans le score total — seulement sur
 *     l'attribut choisi à l'activation (le pouvoir ne boost qu'un seul
 *     attribut physique à ce palier, cf. ActivePsyPower.attribute).
 *   Niveau 20 : +1 par tranche de 2 dans le score total — idem, un seul
 *     attribut choisi.
 *   Niveau 25 : +1 par tranche de 3, sur TOUTES les caractéristiques
 *     physiques (REF/DEX/VIT) sans avoir à en choisir une seule.
 *   Niveau 30 : +1 par point de score total, toutes caractéristiques
 *     physiques.
 *   Niveau 35 ("Appel de l'avatar") : +5 fixe, toutes caractéristiques
 *     physiques.
 * Un attribut hors REF/DEX/VIT (ex. INT, COM) n'est jamais concerné.
 */
function getConcentrationPsyAttributeBonus(
  character: Pick<Character, "psyPowers" | "activePsyPowers" | "skills">,
  attributeTotals: AttributeScores,
  attribute: Attribute,
): number {
  if (!CONCENTRATION_PSY_ATTRIBUTES.includes(attribute)) return 0;
  const active = (character.activePsyPowers ?? []).find((p) => p.name === CONCENTRATION_PSY_NAME);
  if (!active) return 0;
  const power = character.psyPowers.find((p) => p.name === CONCENTRATION_PSY_NAME);
  if (!power) return 0;
  const score = getPsyPowerTotal(power, character, attributeTotals);
  switch (active.level) {
    case 15:
      return active.attribute === attribute ? Math.floor(score / 5) : 0;
    case 20:
      return active.attribute === attribute ? Math.floor(score / 2) : 0;
    case 25:
      return Math.floor(score / 3);
    case 30:
      return score;
    case 35:
      return 5;
    default:
      return 0;
  }
}

// ---------------------------------------------------------------------------
// Activation générique des pouvoirs psy — coût en PSP par palier et bonus
// "boost" (caractéristique/compétence) choisis manuellement à l'activation
// pour les pouvoirs sans formule chiffrée codée (tous sauf "Concentration
// psy" ci-dessus). Cf. ActivePsyPower (shared/types.ts).
// ---------------------------------------------------------------------------

/** Paliers d'activation disponibles pour tout pouvoir psy (Règles ADD40K V0.2) — 10 gratuit, puis les paliers existants de POWER_LEVELS. */
export const PSY_POWER_LEVELS = [10, 15, 20, 25, 30, 35] as const;

/** Coût en PSP pour activer un pouvoir à un palier donné : 10 gratuit, +1 PSP par palier de 5 jusqu'à 35 (5 PSP). Décompté de Character.pspCurrent à l'activation, remboursé à la désactivation (cf. CharacterSheet.setActivePower). */
const PSY_POWER_ACTIVATION_COST: Record<number, number> = { 10: 0, 15: 1, 20: 2, 25: 3, 30: 4, 35: 5 };

export function getPsyPowerActivationCost(level: number): number {
  return PSY_POWER_ACTIVATION_COST[level] ?? 0;
}

/**
 * Bonus total sur un attribut donné venant des pouvoirs actifs : somme des
 * `boostAmount` génériques ciblant cet attribut via `boostAttribute` (tous
 * pouvoirs sauf "Concentration psy", cf. ActivePsyPower) + le bonus dédié de
 * "Concentration psy" sur ce même attribut si actif (cf.
 * getConcentrationPsyAttributeBonus, qui a besoin de `attributeTotals` pour
 * calculer le score TOTAL du pouvoir — score + Volonté + Affinité — pas
 * seulement son score de base). Additif, utilisé pour l'affichage
 * (AttributesPanel, mis en évidence) et pris en compte pour REF dans
 * getActionRank ci-dessous.
 */
export function getActivePsyPowerAttributeBoost(
  character: Pick<Character, "psyPowers" | "activePsyPowers" | "skills">,
  attributeTotals: AttributeScores,
  attribute: Attribute,
): number {
  const generic = (character.activePsyPowers ?? []).reduce(
    (sum, p) => sum + (p.boostAttribute === attribute ? (p.boostAmount ?? 0) : 0),
    0,
  );
  return generic + getConcentrationPsyAttributeBonus(character, attributeTotals, attribute);
}

/** Somme des `boostAmount` des pouvoirs actifs ciblant cette compétence via `boostSkillName` (nom exact) — additif, pour affichage (SkillsPanel). */
export function getActivePsyPowerSkillBoost(character: Pick<Character, "activePsyPowers">, skillName: string): number {
  return (character.activePsyPowers ?? []).reduce(
    (sum, p) => sum + (p.boostSkillName === skillName ? (p.boostAmount ?? 0) : 0),
    0,
  );
}

/**
 * Au moins un pouvoir actif booste une caractéristique ou une compétence —
 * cf. CharacterSummary.hasActiveBoost (icône sur la tuile du Suivi des
 * constantes). Couvre le bonus générique (boostAttribute/boostSkillName) et
 * le bonus dédié de "Concentration psy" (toutes caractéristiques physiques à
 * partir du palier 25, ou l'attribut choisi aux paliers 15/20).
 */
export function hasActivePsyPowerBoost(character: Pick<Character, "activePsyPowers">): boolean {
  return (character.activePsyPowers ?? []).some((p) => {
    if (p.boostAttribute != null || p.boostSkillName != null) return true;
    if (p.name === CONCENTRATION_PSY_NAME) {
      if (p.level >= 25) return true;
      if ((p.level === 15 || p.level === 20) && p.attribute) return true;
    }
    return false;
  });
}

/**
 * Liste des attributs (parmi les 8, cf. ATTRIBUTES) actuellement boostés
 * (bonus non nul) par un pouvoir actif — générique (boostAttribute) ou
 * "Concentration psy" (getConcentrationPsyAttributeBonus). Pour l'affichage
 * d'une icône par attribut sur la tuile de l'écran "Suivi des constantes"
 * (CharacterSummary.boostedAttributes), à la place de l'ancien badge
 * générique unique (hasActivePsyPowerBoost).
 */
export function getBoostedAttributes(
  character: Pick<Character, "psyPowers" | "activePsyPowers" | "skills">,
  attributeTotals: AttributeScores,
): Attribute[] {
  return ATTRIBUTES.filter((a) => getActivePsyPowerAttributeBoost(character, attributeTotals, a) !== 0);
}

/**
 * Noms (dédupliqués) des compétences actuellement boostées par un pouvoir
 * actif (ActivePsyPower.boostSkillName, bonus non nul) — ne correspond à
 * aucune des 8 icônes d'attribut de getBoostedAttributes ci-dessus ;
 * affiché via un indicateur générique séparé (CharacterSummary.
 * boostedSkillNames).
 */
export function getBoostedSkillNames(character: Pick<Character, "activePsyPowers">): string[] {
  return Array.from(
    new Set(
      (character.activePsyPowers ?? [])
        .filter((p) => p.boostSkillName != null && (p.boostAmount ?? 0) !== 0)
        .map((p) => p.boostSkillName as string),
    ),
  );
}

/**
 * Rang d'Action courant du personnage, tous éléments combinés — cf. les
 * commentaires ci-dessus pour le détail de chaque terme. Plus la valeur est
 * basse, plus le personnage agit tôt (confirmé par le MJ le 18/08).
 */
export function getActionRank(
  character: Pick<
    Character,
    "race" | "attributeScores" | "attributeTechBonus" | "weapons" | "advantages" | "psyPowers" | "activePsyPowers" | "skills"
  >,
  reference: ReferenceData,
): number {
  // Attributs complets (pas seulement REF) : nécessaire pour que
  // getActivePsyPowerAttributeBoost puisse calculer le score TOTAL de
  // "Concentration psy" (score + Volonté + Affinité, cf.
  // getConcentrationPsyAttributeBonus), pas seulement son score de base.
  const attributeTotals = getAllAttributeTotals(character, reference);
  const refTotal = attributeTotals.REF;
  const hasActivePower = (character.activePsyPowers ?? []).length > 0;
  // getActivePsyPowerAttributeBoost inclut déjà le bonus dédié de
  // "Concentration psy" sur REF (cf. getConcentrationPsyAttributeBonus) en
  // plus du bonus générique des autres pouvoirs — un seul terme, pas de
  // double comptage.
  const effectiveRef =
    refTotal +
    getConcentrationAdvantageRefDelta(character, hasActivePower) +
    getActivePsyPowerAttributeBoost(character, attributeTotals, "REF");
  const equippedWeapon = character.weapons.find((w) => w.equipped);
  const weaponRaModifier = equippedWeapon ? getWeaponRaModifier(equippedWeapon) : 0;
  return BASE_RA - effectiveRef + weaponRaModifier;
}

// Armes -> compétence liée, pour dériver le score de base (cf. getWeaponSuggestedScore).
// Le classeur d'origine ne fait cette association nulle part de façon fiable
// (une seule colonne "type" Mêl/Fire/Jet, aucune liaison arme->compétence) —
// construite manuellement à partir du catalogue (listes!I:R), confirmée avec
// le MJ le 16/08 sur les cas Vagar (Mêlée) et Jonas (Arme de poing). Les
// armes de jet (arcs, grenades) n'ont pas de compétence fiable identifiée et
// restent donc hors mapping (score de base reste manuel pour ce type).
const PISTOL_WEAPONS = new Set([
  "Street line palm pistol",
  "Cybertech secutity",
  "Colt Python",
  "Wild Predator",
  "Cybertech Silverhawk",
  "Pistolet Gauss",
]);
const RIFLE_WEAPONS = new Set([
  "INDRA",
  "Leader AF4",
  "Redfield 540",
  "Widowmaker",
  "Devastator",
  "Railgun",
  "Inferno",
  "C-Tech Tsunami",
  "Wild RPG",
]);

/** Nom de la compétence liée à une arme (par nom + type), ou null si aucune correspondance fiable (armes de jet). */
export function getWeaponSkillName(weaponName: string, weaponType: WeaponType): string | null {
  if (weaponType === "Mêl") return "Mêlée (DEX)";
  if (weaponType === "Fire") {
    if (PISTOL_WEAPONS.has(weaponName)) return "Arme de poing (PER)";
    if (RIFLE_WEAPONS.has(weaponName)) return "Fusils (PER)";
  }
  return null;
}

/**
 * Score de base suggéré pour une arme = total de la compétence liée (score +
 * attribut, cf. getSkillTotal) si le personnage possède cette compétence sur
 * sa fiche — null sinon (le score de base reste alors manuel). Utilisé pour
 * pré-remplir le score au choix d'une arme dans le catalogue ; n'écrase pas
 * une saisie manuelle existante si aucune compétence ne correspond.
 */
export function getWeaponSuggestedScore(
  character: Pick<Character, "skills">,
  attributeTotals: AttributeScores,
  weaponName: string,
  weaponType: WeaponType,
): number | null {
  const skillName = getWeaponSkillName(weaponName, weaponType);
  if (!skillName) return null;
  const skill = character.skills.find((s) => s.name === skillName);
  if (!skill) return null;
  return getSkillTotal(skillName, skill.score, attributeTotals, skill.attribute).total;
}

/** Somme signée des avantages/inconvénients (données!K40). */
export function getAdvantagesNet(character: Pick<Character, "advantages">): number {
  return character.advantages.reduce((sum, adv) => sum + adv.value, 0);
}

// ---------------------------------------------------------------------------
// Argent (crédits, Cr) — revenu mensuel distribué par le MJ (bouton "+(X)
// mois 💵", écran "Suivi des constantes") et prix catalogue consommé à
// l'achat d'une nouvelle arme/armure/ligne d'équipement (cf. WeaponsArmorPanel
// / EquipmentPanel). Indépendant du budget de points ci-dessus.
// ---------------------------------------------------------------------------

/** Revenu mensuel de base (Cr) pour tout personnage joueur, avant tout avantage. */
export const BASE_MONTHLY_INCOME = 500;

/** Préfixe des labels d'avantage "Revenus : +X" du catalogue (toutes variantes de ponctuation/espacement partagent ce préfixe). */
const REVENU_ADVANTAGE_LABEL = "Revenus";

/**
 * Multiplicateur du revenu mensuel additionnel par point de l'avantage
 * "Revenus" — la description du catalogue dit "x1000" mais la table de jeu
 * réelle utilise x100 (corrigé en session, coquille de règle). Ex. "Revenus :
 * +20" ajoute 20 x 100 = 2000 Cr/mois au revenu de base.
 */
const REVENU_ADVANTAGE_MULTIPLIER = 100;

/**
 * Revenu mensuel total (Cr) d'un personnage : 500 Cr de base (BASE_MONTHLY_
 * INCOME), plus 100 Cr par point de chaque avantage "Revenus : +X" possédé
 * (sommés si plusieurs, cf. getAdvantagesNet pour la même convention de somme
 * sur les avantages). Utilisé par POST /api/characters/group-income (bouton
 * MJ "+(X) mois") pour distribuer à chaque personnage joueur en jeu ce qu'il
 * doit réellement recevoir, pas un montant uniforme.
 */
export function getMonthlyIncome(character: Pick<Character, "advantages">): number {
  const revenuBonus = character.advantages
    .filter((a) => a.label.startsWith(REVENU_ADVANTAGE_LABEL))
    .reduce((sum, a) => sum + a.value * REVENU_ADVANTAGE_MULTIPLIER, 0);
  return BASE_MONTHLY_INCOME + revenuBonus;
}

/**
 * Convertit un prix catalogue (WeaponDefinition.price / ArmorDefinition.price
 * — nombre, texte libre, ou absent/null) en nombre exploitable pour déduire
 * un achat, ou `null` si le prix n'est pas un nombre exploitable (fourchette
 * type "10-100", texte non numérique, absent). Un prix inconnu n'est jamais
 * bloquant : l'achat correspondant n'est simplement pas déduit du solde (cf.
 * WeaponsArmorPanel).
 */
export function parseCatalogPrice(price: number | string | null | undefined): number | null {
  if (price == null) return null;
  if (typeof price === "number") return Number.isFinite(price) ? price : null;
  const trimmed = price.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export function getRaceSkillPoints(character: Pick<Character, "race">, reference: ReferenceData): number {
  return reference.races.find((r) => r.race === character.race)?.skillPoints ?? 0;
}

/** Total disponible = points raciaux + points de départ + XP (données!H25). */
export function getTotalDispo(
  character: Pick<Character, "race" | "pointsDepart" | "xp">,
  reference: ReferenceData,
): number {
  return getRaceSkillPoints(character, reference) + character.pointsDepart + character.xp;
}

export interface BudgetSummary {
  raceSkillPoints: number;
  totalDispo: number;
  skillsCost: number;
  psyPowersCost: number;
  advantagesNet: number;
  /**
   * Solde = total dispo - coût compétences - coût pouvoirs psy - net avantages.
   * Un avantage COÛTE des points (réduit le solde), un inconvénient EN DONNE
   * (augmente le solde) — ex. "Dans les nuages" (inconvénient -3, valeur
   * catalogue -30) ajoute +30 au solde. C'est l'inverse de la formule brute
   * du classeur Excel (qui faisait `+K40`) : confirmé explicitement par le
   * MJ, cf. plan lively-rolling-comet.md. Négatif = personnage hors budget.
   */
  solde: number;
}

export function getBudgetSummary(
  character: Pick<
    Character,
    "race" | "pointsDepart" | "xp" | "skills" | "psyPowers" | "advantages"
  >,
  reference: ReferenceData,
): BudgetSummary {
  const totalDispo = getTotalDispo(character, reference);
  const skillsCost = getSkillsCostTotal(character, reference);
  const psyPowersCost = getPsyPowersCostTotal(character, reference);
  const advantagesNet = getAdvantagesNet(character);
  return {
    raceSkillPoints: getRaceSkillPoints(character, reference),
    totalDispo,
    skillsCost,
    psyPowersCost,
    advantagesNet,
    solde: totalDispo - skillsCost - psyPowersCost - advantagesNet,
  };
}

export interface CharacterComputed {
  attributeTotals: AttributeScores;
  attributeSum: number;
  hpMax: number;
  pspMax: number;
  budget: BudgetSummary;
  armorTotals: ArmorTotals;
  actionRank: number;
}

/** Calcule en une passe tout ce que l'UI a besoin d'afficher en lecture seule. */
export function computeCharacter(character: Character, reference: ReferenceData): CharacterComputed {
  return {
    attributeTotals: getAllAttributeTotals(character, reference),
    attributeSum: getAttributeSum(character, reference),
    hpMax: getHpMax(character, reference),
    pspMax: getPspMax(character, reference),
    budget: getBudgetSummary(character, reference),
    armorTotals: getArmorTotals(character),
    actionRank: getActionRank(character, reference),
  };
}
