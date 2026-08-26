// Tests du moteur de calcul — le cœur critique de l'app (cf.
// scripts/release-check.sh, qui les fait tourner avant tout déploiement).
// Le cas "Stern Tack" fige les valeurs réelles connues du classeur Excel
// d'origine (PV=25, PSP=45) et documente l'effet du fix du bug "Dans les
// nuages" sur le solde de points (voir plan lively-rolling-comet.md).

import { describe, expect, it } from "vitest";
import {
  computeCharacter,
  getActionRank,
  getActivePsyPowerAttributeBoost,
  getActivePsyPowerSkillBoost,
  getAllAttributeTotals,
  getArmorTotals,
  getAttributeTotal,
  getBoostedAttributes,
  getBoostedSkillNames,
  getDualWieldPenalty,
  getHpMax,
  getMonthlyIncome,
  getPowerAffinityBonus,
  getPspMax,
  getPsyPowerActivationCost,
  getPsyPowerTotal,
  getSkillAffinityBonus,
  getSkillCost,
  getSkillDisplayTotal,
  getSkillJustifications,
  getSkillJustifiedScore,
  getSkillsCostTotal,
  getSkillTotal,
  getWeaponSkillName,
  getWeaponSuggestedScore,
  getWeaponTotals,
  hasActivePsyPowerBoost,
  hasAmbidextrousAdvantage,
  MAX_EQUIPPED_WEAPONS,
  parseCatalogPrice,
  parseSkillAttribute,
} from "./calc-engine";
import { referenceData } from "./reference-data";
import type { AttributeScores, Character } from "./types";
import charactersSeed from "../../scripts/characters.seed.json";

const sternTack = (charactersSeed as Character[]).find((c) => c.name === "Stern Tack")!;
const jonas = (charactersSeed as Character[]).find((c) => c.name === "Jonas")!;

describe("getSkillCost", () => {
  it("suit la table listes!A14:B29 (paliers 11-15 corrigés à +15/niveau, cf. reference-data.ts)", () => {
    expect(getSkillCost(0, referenceData.skillCostTable)).toBe(0);
    expect(getSkillCost(1, referenceData.skillCostTable)).toBe(5);
    expect(getSkillCost(6, referenceData.skillCostTable)).toBe(35);
    expect(getSkillCost(15, referenceData.skillCostTable)).toBe(150);
  });

  it("retombe sur le palier inférieur pour un score sans entrée exacte", () => {
    expect(getSkillCost(20, referenceData.skillCostTable)).toBe(150);
  });
});

describe("getAttributeTotal", () => {
  it("additionne base + bonus racial (gith: INT+1, VOL+1)", () => {
    const total = getAttributeTotal(sternTack, referenceData, "INT");
    expect(total).toBe(sternTack.attributeScores.INT + 1);
  });
});

describe("PV/PSP — cas réel Stern Tack", () => {
  it("PV max = 25 (valeur connue du classeur : (VIT_total -1 + taille 0) x 5 + 30)", () => {
    expect(getHpMax(sternTack, referenceData)).toBe(25);
  });

  it("PSP max = 45 (valeur connue du classeur : VOL_total 3 x 5 + 30)", () => {
    expect(getPspMax(sternTack, referenceData)).toBe(45);
  });
});

describe("parseSkillAttribute / getSkillTotal", () => {
  it("extrait le code d'attribut même au milieu du nom", () => {
    expect(parseSkillAttribute("Commandement (COM)")).toBe("COM");
    expect(parseSkillAttribute("Affinité (VOL) Téléportation")).toBe("VOL");
    expect(parseSkillAttribute("Corpsystème")).toBeNull();
  });

  it("additionne score de compétence + total d'attribut lié (cas réel Stern Tack : Commandement (COM) 6 + COM 2 = 8)", () => {
    const attributeTotals = computeCharacter(sternTack, referenceData).attributeTotals;
    const result = getSkillTotal("Commandement (COM)", 6, attributeTotals);
    expect(result.attribute).toBe("COM");
    expect(result.attributeValue).toBe(2);
    expect(result.total).toBe(8);
  });

  it("attributeOverride prend le pas sur le parsing du nom (compétence hors catalogue, ex. compétence 'free' sans code d'attribut dans le nom)", () => {
    const attributeTotals = computeCharacter(sternTack, referenceData).attributeTotals;
    const result = getSkillTotal("Résistance mentale", 0, attributeTotals, "VOL");
    expect(result.attribute).toBe("VOL");
    expect(result.attributeValue).toBe(attributeTotals.VOL);
  });
});

describe("getSkillsCostTotal — compétences 'free' (justifiées par un avantage/du matériel)", () => {
  it("exclut du coût une compétence marquée free, quel que soit son score", () => {
    const base: Pick<Character, "skills"> = { skills: [{ name: "Commandement (COM)", score: 6 }] };
    const withFree: Pick<Character, "skills"> = {
      skills: [
        { name: "Commandement (COM)", score: 6 },
        { name: "Résistance mentale", score: 20, attribute: "VOL", free: true, justification: "Volonté de fer" },
      ],
    };
    expect(getSkillsCostTotal(withFree, referenceData)).toBe(getSkillsCostTotal(base, referenceData));
  });
});

describe("getSkillJustifications / getSkillJustifiedScore — plusieurs justifications, comme les modificateurs d'arme", () => {
  it("plusieurs lignes (cas réel Conrad Lingus : collier Alphacien + Volonté de fer) s'additionnent au score de base", () => {
    const skill = {
      score: 0,
      justifications: [
        { justification: "Collier Alphacien", score: 3 },
        { justification: "Volonté de fer", score: 3 },
      ],
    };
    expect(getSkillJustifications(skill)).toHaveLength(2);
    expect(getSkillJustifiedScore(skill)).toBe(6);
  });

  it("rétrocompatibilité : l'ancien champ `justification` (une seule ligne) est lu comme une justification unique tant que `justifications` est absent", () => {
    const skill = { score: 6, justification: "Volonté de fer" };
    expect(getSkillJustifications(skill)).toEqual([{ justification: "Volonté de fer" }]);
    expect(getSkillJustifiedScore(skill)).toBe(6); // pas de `score` sur la ligne migrée -> +0
  });

  it("`justifications` prend le pas sur l'ancien `justification` si les deux sont présents (état transitoire pendant la migration)", () => {
    const skill = {
      score: 0,
      justification: "Ancienne ligne",
      justifications: [{ justification: "Nouvelle ligne", score: 5 }],
    };
    expect(getSkillJustifications(skill)).toEqual([{ justification: "Nouvelle ligne", score: 5 }]);
    expect(getSkillJustifiedScore(skill)).toBe(5);
  });

  it("compétence sans justification : score total = score de base, comportement inchangé", () => {
    const skill = { score: 6, justification: undefined, justifications: undefined };
    expect(getSkillJustifications(skill)).toEqual([]);
    expect(getSkillJustifiedScore(skill)).toBe(6);
  });
});

describe("getArmorTotals", () => {
  it("ne somme que les armures actives", () => {
    const totals = getArmorTotals({
      armor: [
        { name: "A", vpTete: 1, vpBras: 1, vpTorse: 1, vpJambes: 1, active: true },
        { name: "B", vpTete: 10, vpBras: 10, vpTorse: 10, vpJambes: 10, active: false },
      ],
    });
    expect(totals).toEqual({ vpTete: 1, vpBras: 1, vpTorse: 1, vpJambes: 1 });
  });
});

describe("getWeaponTotals", () => {
  it("Dmg/Score = base ; RA = BASE_RA - Réflexe + RA catalogue (le RA de catalogue s'additionne, il ne se soustrait pas — c'est déjà un rang à part entière)", () => {
    expect(getWeaponTotals({ ra: 6, damage: 8, baseScore: 7 }, 0)).toEqual({ ra: 11, damage: 8, baseScore: 7 });
  });

  it("cas réel Wild Predator de Conrad Lingus (Réflexe total 0, un seul modificateur 'Améliorations WP') : RA final 5 - 0 + (2 - 1) = 6 — confirmé par le MJ le 19/08", () => {
    const totals = getWeaponTotals(
      {
        ra: 2,
        damage: 6,
        baseScore: 7,
        modifiers: [{ justification: "Améliorations WP : 1,1,1", ra: -1, damage: 1, score: 1 }],
      },
      0,
    );
    expect(totals).toEqual({ ra: 6, damage: 7, baseScore: 8 });
  });

  it("un Réflexe total plus élevé abaisse le RA final (agit plus tôt)", () => {
    expect(getWeaponTotals({ ra: 2, damage: 6, baseScore: 7 }, 3)).toEqual({ ra: 4, damage: 6, baseScore: 7 });
  });

  it("cumule plusieurs modificateurs de RA, chacun ne touchant pas forcément les 3 stats", () => {
    const totals = getWeaponTotals(
      {
        ra: 2,
        damage: 6,
        baseScore: 7,
        modifiers: [
          { justification: "Améliorations WP : 1,1,1", ra: -1, damage: 1, score: 1 },
          { justification: "Écart hérité de la fiche (avant restructuration base = compétence)", ra: 4, damage: 2, score: 1 },
        ],
      },
      0,
    );
    expect(totals).toEqual({ ra: 10, damage: 9, baseScore: 9 });
  });

  it("modificateurs ne touchant pas le RA (score/dégâts uniquement)", () => {
    const totals = getWeaponTotals(
      {
        ra: 5,
        damage: 5,
        baseScore: 5,
        modifiers: [
          { justification: "Viseur laser", score: 2 },
          { justification: "Chargeur amélioré", damage: 1 },
        ],
      },
      0,
    );
    expect(totals).toEqual({ ra: 10, damage: 6, baseScore: 7 });
  });
});

describe("hasAmbidextrousAdvantage / getDualWieldPenalty — combat à deux armes", () => {
  it("MAX_EQUIPPED_WEAPONS = 2, avec ou sans Ambidextre (seul le score en pâtit sans l'avantage)", () => {
    expect(MAX_EQUIPPED_WEAPONS).toBe(2);
  });

  it("une seule arme équipée : aucun malus, avec ou sans Ambidextre", () => {
    const withoutAmbi = { weapons: [{ equipped: true }], advantages: [] };
    const withAmbi = { weapons: [{ equipped: true }], advantages: [{ label: "Ambidextre: +10", value: 10 }] };
    expect(getDualWieldPenalty(withoutAmbi)).toBe(0);
    expect(getDualWieldPenalty(withAmbi)).toBe(0);
  });

  it("deux armes équipées sans Ambidextre : malus de -3", () => {
    const character = {
      weapons: [{ equipped: true }, { equipped: true }, { equipped: false }],
      advantages: [{ label: "Réputation: +10", value: 10 }],
    };
    expect(hasAmbidextrousAdvantage(character)).toBe(false);
    expect(getDualWieldPenalty(character)).toBe(-3);
  });

  it("deux armes équipées avec Ambidextre : aucun malus", () => {
    const character = {
      weapons: [{ equipped: true }, { equipped: true }],
      advantages: [{ label: "Ambidextre: +10", value: 10 }],
    };
    expect(hasAmbidextrousAdvantage(character)).toBe(true);
    expect(getDualWieldPenalty(character)).toBe(0);
  });

  it("getWeaponTotals applique le malus au score joué, pas aux dégâts ni au RA", () => {
    const totals = getWeaponTotals({ ra: 2, damage: 6, baseScore: 7 }, 0, -3);
    expect(totals).toEqual({ ra: 7, damage: 6, baseScore: 4 });
  });
});

describe("getActionRank", () => {
  // gith (bonus racial REF nul, cf. reference-data.ts) — mêmes hypothèses
  // que Conrad Lingus (REF total 0) pour rester comparable aux tests
  // getWeaponTotals ci-dessus.
  function baseCharacter(): Pick<
    Character,
    "race" | "attributeScores" | "attributeTechBonus" | "weapons" | "advantages" | "psyPowers" | "activePsyPowers" | "skills"
  > {
    return {
      race: "gith",
      attributeScores: { FO: 0, VIT: 0, DEX: 0, REF: 0, PER: 0, COM: 0, INT: 0, VOL: 0 },
      attributeTechBonus: {},
      weapons: [],
      advantages: [],
      psyPowers: [],
      activePsyPowers: [],
      skills: [],
    };
  }

  it("mains nues (aucune arme équipée) : RA = BASE_RA - Réflexe = 5", () => {
    expect(getActionRank(baseCharacter(), referenceData)).toBe(5);
  });

  it("arme équipée : reprend le même terme que getWeaponTotals (cas réel Wild Predator, RA 6 — RA de catalogue additionné, pas soustrait, confirmé par le MJ le 19/08)", () => {
    const character = {
      ...baseCharacter(),
      weapons: [
        {
          name: "Wild Predator",
          type: "Fire" as const,
          ra: 2,
          damage: 6,
          baseScore: 7,
          equipped: true,
          modifiers: [{ justification: "Améliorations WP : 1,1,1", ra: -1, damage: 1, score: 1 }],
        },
      ],
    };
    expect(getActionRank(character, referenceData)).toBe(6);
  });

  it("une arme présente sur la fiche mais NON équipée ne compte pas (comme mains nues)", () => {
    const character = {
      ...baseCharacter(),
      weapons: [{ name: "Widowmaker", type: "Fire" as const, ra: 5, damage: 11, baseScore: 7, equipped: false }],
    };
    expect(getActionRank(character, referenceData)).toBe(5);
  });

  it("Concentration rapide (REF+3) sans pouvoir actif : aucun effet — ne s'applique qu'en cours d'activation d'un pouvoir", () => {
    const character = { ...baseCharacter(), advantages: [{ label: "Concentration rapide: +10", value: 10 }] };
    expect(getActionRank(character, referenceData)).toBe(5);
  });

  it("Concentration rapide (REF+3) avec un pouvoir actif : RA abaissé de 3", () => {
    const character = {
      ...baseCharacter(),
      advantages: [{ label: "Concentration rapide: +10", value: 10 }],
      activePsyPowers: [{ name: "Illusion", level: 15 }],
    };
    expect(getActionRank(character, referenceData)).toBe(2);
  });

  it("Concentration lente (REF-3) avec un pouvoir actif : RA relevé de 3", () => {
    const character = {
      ...baseCharacter(),
      advantages: [{ label: "Concentration lente: -20", value: -20 }],
      activePsyPowers: [{ name: "Illusion", level: 15 }],
    };
    expect(getActionRank(character, referenceData)).toBe(8);
  });

  it("Concentration psy niveau 25 (score 9) : +1 REF par tranche de 3 = +3, sur toutes les caractéristiques sans avoir à choisir REF", () => {
    const character = {
      ...baseCharacter(),
      psyPowers: [{ name: "Concentration psy", score: 9, discipline: "Maîtrise de soi" }],
      activePsyPowers: [{ name: "Concentration psy", level: 25 }],
    };
    expect(getActionRank(character, referenceData)).toBe(2);
  });

  it("Concentration psy niveau 15, attribut choisi DEX (pas REF) : aucun bonus sur le RA", () => {
    const character = {
      ...baseCharacter(),
      psyPowers: [{ name: "Concentration psy", score: 12, discipline: "Maîtrise de soi" }],
      activePsyPowers: [{ name: "Concentration psy", level: 15, attribute: "DEX" as const }],
    };
    expect(getActionRank(character, referenceData)).toBe(5);
  });

  it("Concentration psy niveau 15, attribut choisi REF (score 12) : +1 par tranche de 5 = +2", () => {
    const character = {
      ...baseCharacter(),
      psyPowers: [{ name: "Concentration psy", score: 12, discipline: "Maîtrise de soi" }],
      activePsyPowers: [{ name: "Concentration psy", level: 15, attribute: "REF" as const }],
    };
    expect(getActionRank(character, referenceData)).toBe(3);
  });

  it("Concentration psy niveau 35 (Appel de l'avatar) : +5 fixe", () => {
    const character = {
      ...baseCharacter(),
      psyPowers: [{ name: "Concentration psy", score: 3, discipline: "Maîtrise de soi" }],
      activePsyPowers: [{ name: "Concentration psy", level: 35 }],
    };
    expect(getActionRank(character, referenceData)).toBe(0);
  });

  it("boost générique (boostAttribute REF, hors Concentration psy) : pris en compte dans le RA comme un bonus de Réflexe", () => {
    const character = {
      ...baseCharacter(),
      activePsyPowers: [{ name: "Illusion", level: 20, boostAttribute: "REF" as const, boostAmount: 4 }],
    };
    expect(getActionRank(character, referenceData)).toBe(1);
  });

  it("boost générique ciblant un autre attribut (DEX) : aucun effet sur le RA", () => {
    const character = {
      ...baseCharacter(),
      activePsyPowers: [{ name: "Illusion", level: 20, boostAttribute: "DEX" as const, boostAmount: 4 }],
    };
    expect(getActionRank(character, referenceData)).toBe(5);
  });
});

describe("getActivePsyPowerAttributeBoost — Concentration psy sur DEX/VIT (pas seulement REF)", () => {
  // Signalé : à un palier ≤ 20, choisir DEX ou VIT (plutôt que REF) n'avait
  // auparavant aucun effet visible nulle part dans l'app (seul REF via le RA
  // était câblé) — getActivePsyPowerAttributeBoost inclut désormais le bonus
  // de Concentration psy pour n'importe quel attribut physique, affiché en
  // évidence sur AttributesPanel comme n'importe quel autre pouvoir.
  // VOL à 0 et aucune compétence d'Affinité dans ces fixtures : isole la
  // formule par palier (score total = score de base seul, cf.
  // getConcentrationPsyAttributeBonus qui utilise désormais getPsyPowerTotal
  // — score + Volonté + Affinité, testé séparément ci-dessous).
  const zeroAttributeTotals: AttributeScores = { FO: 0, VIT: 0, DEX: 0, REF: 0, PER: 0, COM: 0, INT: 0, VOL: 0 };

  it("niveau 15, attribut choisi DEX (score 12) : +1 par tranche de 5 = +2 sur DEX, rien sur REF/VIT", () => {
    const character = {
      skills: [],
      psyPowers: [{ name: "Concentration psy", score: 12, discipline: "Maîtrise de soi" }],
      activePsyPowers: [{ name: "Concentration psy", level: 15, attribute: "DEX" as const }],
    };
    expect(getActivePsyPowerAttributeBoost(character, zeroAttributeTotals, "DEX")).toBe(2);
    expect(getActivePsyPowerAttributeBoost(character, zeroAttributeTotals, "REF")).toBe(0);
    expect(getActivePsyPowerAttributeBoost(character, zeroAttributeTotals, "VIT")).toBe(0);
  });

  it("niveau 25 (score 9) : +1 par tranche de 3 = +3 sur REF, DEX ET VIT sans avoir à choisir", () => {
    const character = {
      skills: [],
      psyPowers: [{ name: "Concentration psy", score: 9, discipline: "Maîtrise de soi" }],
      activePsyPowers: [{ name: "Concentration psy", level: 25 }],
    };
    expect(getActivePsyPowerAttributeBoost(character, zeroAttributeTotals, "REF")).toBe(3);
    expect(getActivePsyPowerAttributeBoost(character, zeroAttributeTotals, "DEX")).toBe(3);
    expect(getActivePsyPowerAttributeBoost(character, zeroAttributeTotals, "VIT")).toBe(3);
  });

  it("attribut hors REF/DEX/VIT (ex. INT) : jamais concerné, même à haut palier", () => {
    const character = {
      skills: [],
      psyPowers: [{ name: "Concentration psy", score: 20, discipline: "Maîtrise de soi" }],
      activePsyPowers: [{ name: "Concentration psy", level: 35 }],
    };
    expect(getActivePsyPowerAttributeBoost(character, zeroAttributeTotals, "INT")).toBe(0);
  });

  it("le score total (score + Volonté + Affinité) compte, pas le seul score de base — cas réel Karun : score de base 3, VOL 5, Affinité +7 = total 15, niveau 15 -> +3 REF", () => {
    const character = {
      skills: [{ name: "Affinité", score: 7, isAffinity: true, affinityTargetPowerName: "Concentration psy" }],
      psyPowers: [{ name: "Concentration psy", score: 3, discipline: "Maîtrise de soi" }],
      activePsyPowers: [{ name: "Concentration psy", level: 15, attribute: "REF" as const }],
    };
    const attributeTotals = { ...zeroAttributeTotals, VOL: 5 };
    expect(getActivePsyPowerAttributeBoost(character, attributeTotals, "REF")).toBe(3);
  });
});

describe("hasActivePsyPowerBoost — Concentration psy compte comme un boost", () => {
  it("niveau 25+ (toutes caractéristiques physiques) : détecté même sans attribute choisi", () => {
    expect(hasActivePsyPowerBoost({ activePsyPowers: [{ name: "Concentration psy", level: 25 }] })).toBe(true);
  });

  it("niveau 15/20 avec attribute choisi : détecté", () => {
    expect(
      hasActivePsyPowerBoost({ activePsyPowers: [{ name: "Concentration psy", level: 20, attribute: "DEX" }] }),
    ).toBe(true);
  });

  it("niveau 15/20 sans attribute choisi, ou niveau 10 : pas détecté (aucun effet chiffré)", () => {
    expect(hasActivePsyPowerBoost({ activePsyPowers: [{ name: "Concentration psy", level: 15 }] })).toBe(false);
    expect(hasActivePsyPowerBoost({ activePsyPowers: [{ name: "Concentration psy", level: 10 }] })).toBe(false);
  });
});

describe("getPsyPowerActivationCost — coût en PSP par palier", () => {
  it.each([
    [10, 0],
    [15, 1],
    [20, 2],
    [25, 3],
    [30, 4],
    [35, 5],
  ])("palier %i -> %i PSP", (level, cost) => {
    expect(getPsyPowerActivationCost(level)).toBe(cost);
  });
});

describe("boost générique d'un pouvoir actif (attribut/compétence choisis à l'activation)", () => {
  it("getActivePsyPowerAttributeBoost additionne les boostAmount ciblant l'attribut demandé", () => {
    const character = {
      skills: [],
      psyPowers: [],
      activePsyPowers: [
        { name: "Illusion", level: 20, boostAttribute: "FO" as const, boostAmount: 3 },
        { name: "Vigueur", level: 15, boostAttribute: "FO" as const, boostAmount: 2 },
        { name: "Acuité", level: 15, boostAttribute: "PER" as const, boostAmount: 5 },
      ],
    };
    const attributeTotals: AttributeScores = { FO: 0, VIT: 0, DEX: 0, REF: 0, PER: 0, COM: 0, INT: 0, VOL: 0 };
    expect(getActivePsyPowerAttributeBoost(character, attributeTotals, "FO")).toBe(5);
    expect(getActivePsyPowerAttributeBoost(character, attributeTotals, "PER")).toBe(5);
    expect(getActivePsyPowerAttributeBoost(character, attributeTotals, "VOL")).toBe(0);
  });

  it("getActivePsyPowerSkillBoost additionne les boostAmount ciblant la compétence demandée (nom exact)", () => {
    const character = {
      activePsyPowers: [{ name: "Illusion", level: 20, boostSkillName: "Discretion (DEX)", boostAmount: 4 }],
    };
    expect(getActivePsyPowerSkillBoost(character, "Discretion (DEX)")).toBe(4);
    expect(getActivePsyPowerSkillBoost(character, "Autre compétence")).toBe(0);
  });

  it("hasActivePsyPowerBoost détecte un boost actif (attribut ou compétence), pas une simple activation sans effet", () => {
    expect(hasActivePsyPowerBoost({ activePsyPowers: [{ name: "Illusion", level: 15 }] })).toBe(false);
    expect(
      hasActivePsyPowerBoost({
        activePsyPowers: [{ name: "Illusion", level: 15, boostAttribute: "FO", boostAmount: 2 }],
      }),
    ).toBe(true);
    expect(
      hasActivePsyPowerBoost({
        activePsyPowers: [{ name: "Illusion", level: 15, boostSkillName: "Discretion (DEX)", boostAmount: 2 }],
      }),
    ).toBe(true);
  });
});

describe("getBoostedAttributes — icônes par attribut sur la tuile Suivi des constantes", () => {
  it("liste les attributs dont le boost générique (boostAttribute) est non nul, ignore les autres", () => {
    const character = {
      skills: [],
      psyPowers: [],
      activePsyPowers: [
        { name: "Illusion", level: 20, boostAttribute: "FO" as const, boostAmount: 3 },
        { name: "Acuité", level: 15, boostAttribute: "PER" as const, boostAmount: 0 },
      ],
    };
    const attributeTotals: AttributeScores = { FO: 0, VIT: 0, DEX: 0, REF: 0, PER: 0, COM: 0, INT: 0, VOL: 0 };
    expect(getBoostedAttributes(character, attributeTotals)).toEqual(["FO"]);
  });

  it("inclut REF/DEX/VIT boostés par Concentration psy niveau 25+ (toutes caractéristiques physiques)", () => {
    const character = {
      skills: [],
      psyPowers: [{ name: "Concentration psy", score: 10, discipline: "Maîtrise de soi" }],
      activePsyPowers: [{ name: "Concentration psy", level: 25 }],
    };
    const attributeTotals: AttributeScores = { FO: 0, VIT: 0, DEX: 0, REF: 0, PER: 0, COM: 0, INT: 0, VOL: 0 };
    expect(getBoostedAttributes(character, attributeTotals)).toEqual(["VIT", "DEX", "REF"]);
  });

  it("liste vide si aucun pouvoir actif ne booste un attribut", () => {
    const character = { skills: [], psyPowers: [], activePsyPowers: [] };
    const attributeTotals: AttributeScores = { FO: 0, VIT: 0, DEX: 0, REF: 0, PER: 0, COM: 0, INT: 0, VOL: 0 };
    expect(getBoostedAttributes(character, attributeTotals)).toEqual([]);
  });
});

describe("getBoostedSkillNames — indicateur générique (aucune icône d'attribut ne s'applique)", () => {
  it("liste les noms de compétences boostées (boostSkillName, bonus non nul), dédupliqués", () => {
    const character = {
      activePsyPowers: [
        { name: "Illusion", level: 20, boostSkillName: "Discretion (DEX)", boostAmount: 4 },
        { name: "Ruse", level: 15, boostSkillName: "Discretion (DEX)", boostAmount: 2 },
      ],
    };
    expect(getBoostedSkillNames(character)).toEqual(["Discretion (DEX)"]);
  });

  it("ignore un boostSkillName avec boostAmount à 0 ou absent", () => {
    const character = {
      activePsyPowers: [{ name: "Illusion", level: 20, boostSkillName: "Discretion (DEX)", boostAmount: 0 }],
    };
    expect(getBoostedSkillNames(character)).toEqual([]);
  });
});

describe("getMonthlyIncome — revenu mensuel (500 Cr de base + avantage \"Revenus\")", () => {
  it("500 Cr de base sans avantage \"Revenus\"", () => {
    expect(getMonthlyIncome({ advantages: [] })).toBe(500);
    expect(getMonthlyIncome({ advantages: [{ label: "Ambidextre", value: 10 }] })).toBe(500);
  });

  it("avantage \"Revenus : +20\" ajoute 20 x 100 = 2000 Cr au revenu de base (multiplicateur corrigé en session : x100, pas x1000)", () => {
    expect(getMonthlyIncome({ advantages: [{ label: "Revenus : +20", value: 20 }] })).toBe(2500);
  });

  it("variantes d'espacement/ponctuation du libellé (\"Revenus: +10\" vs \"Revenus : +10\") comptent pareil", () => {
    expect(getMonthlyIncome({ advantages: [{ label: "Revenus: +10", value: 10 }] })).toBe(1500);
  });

  it("plusieurs avantages \"Revenus\" se cumulent", () => {
    expect(
      getMonthlyIncome({
        advantages: [
          { label: "Revenus : +10", value: 10 },
          { label: "Revenus : +20", value: 20 },
        ],
      }),
    ).toBe(500 + 10 * 100 + 20 * 100);
  });
});

describe("parseCatalogPrice — prix catalogue (WeaponDefinition/ArmorDefinition.price)", () => {
  it("nombre déjà propre : retourné tel quel", () => {
    expect(parseCatalogPrice(500)).toBe(500);
  });

  it("texte numérique (saisie via l'éditeur de catalogue admin, toujours une string) : converti", () => {
    expect(parseCatalogPrice("500")).toBe(500);
  });

  it("fourchette texte (ex. \"10-100\"), texte vide, absent ou null : non exploitable, retourne null (jamais bloquant)", () => {
    expect(parseCatalogPrice("10-100")).toBeNull();
    expect(parseCatalogPrice("")).toBeNull();
    expect(parseCatalogPrice(null)).toBeNull();
    expect(parseCatalogPrice(undefined)).toBeNull();
  });
});

describe("getWeaponSkillName", () => {
  it("arme de mêlée -> Mêlée (DEX)", () => {
    expect(getWeaponSkillName("Epées haches 2 mains", "Mêl")).toBe("Mêlée (DEX)");
  });

  it("pistolet connu (Wild Predator) -> Arme de poing (PER)", () => {
    expect(getWeaponSkillName("Wild Predator", "Fire")).toBe("Arme de poing (PER)");
  });

  it("fusil connu (INDRA) -> Fusils (PER)", () => {
    expect(getWeaponSkillName("INDRA", "Fire")).toBe("Fusils (PER)");
  });

  it("arme de jet -> pas de compétence fiable (null)", () => {
    expect(getWeaponSkillName("Grenade à fragmentation", "Jet")).toBeNull();
  });
});

describe("getWeaponSuggestedScore", () => {
  it("cas réel Vagar : Mêlée (DEX) 8 + DEX_total 1 = 9 pour sa hache (Epées haches 2 mains)", () => {
    const vagar: Pick<Character, "skills"> = { skills: [{ name: "Mêlée (DEX)", score: 8 }] };
    const attributeTotals = { ...({} as Character["attributeScores"]), DEX: 1 } as Character["attributeScores"];
    expect(getWeaponSuggestedScore(vagar, attributeTotals, "Epées haches 2 mains", "Mêl")).toBe(9);
  });

  it("cas réel Jonas : Arme de poing (PER) 5 + PER_total 2 = 7 pour son Wild Predator", () => {
    const attributeTotals = getAllAttributeTotals(jonas, referenceData);
    expect(attributeTotals.PER).toBe(2);
    expect(getWeaponSuggestedScore(jonas, attributeTotals, "Wild Predator", "Fire")).toBe(7);
  });

  it("compétence absente de la fiche -> null (le score reste manuel)", () => {
    const noSkill: Pick<Character, "skills"> = { skills: [] };
    const attributeTotals = {} as Character["attributeScores"];
    expect(getWeaponSuggestedScore(noSkill, attributeTotals, "Wild Predator", "Fire")).toBeNull();
  });
});

describe("getPsyPowerTotal", () => {
  it("additionne score du pouvoir + VOL_total + compétence d'affinité (cas réel Stern Tack : Téléportation 6 + VOL 3 + Affinité 5 = 14)", () => {
    const attributeTotals = computeCharacter(sternTack, referenceData).attributeTotals;
    const power = sternTack.psyPowers.find((p) => p.name === "Téléportation")!;
    expect(getPsyPowerTotal(power, sternTack, attributeTotals)).toBe(14);
  });
});

describe("Affinité — ciblage explicite (compétence, pouvoir, ou discipline entière)", () => {
  it("getPowerAffinityBonus : ancien nom figé toujours reconnu (rétrocompatibilité, cas réel Stern Tack)", () => {
    expect(getPowerAffinityBonus(sternTack, { name: "Téléportation", discipline: "Psychokinésie" })).toBe(5);
  });

  it("getPowerAffinityBonus : ciblage explicite d'un pouvoir précis (affinityTargetPowerName)", () => {
    const character = {
      skills: [{ name: "Affinité", score: 7, isAffinity: true, affinityTargetPowerName: "Soin" }],
    };
    expect(getPowerAffinityBonus(character, { name: "Soin", discipline: "Guérison" })).toBe(7);
    expect(getPowerAffinityBonus(character, { name: "Autre pouvoir", discipline: "Guérison" })).toBe(0);
  });

  it("getPowerAffinityBonus : ciblage d'une discipline entière (affinityTargetDiscipline) — s'applique à tous les pouvoirs de cette discipline", () => {
    const character = {
      skills: [{ name: "Affinité", score: 4, isAffinity: true, affinityTargetDiscipline: "Psychokinésie" }],
    };
    expect(getPowerAffinityBonus(character, { name: "Téléportation", discipline: "Psychokinésie" })).toBe(4);
    expect(getPowerAffinityBonus(character, { name: "Pyrokinésie", discipline: "Psychokinésie" })).toBe(4);
    expect(getPowerAffinityBonus(character, { name: "Charme", discipline: "Télépathie" })).toBe(0);
  });

  it("getPowerAffinityBonus : plusieurs compétences d'Affinité ciblant le même pouvoir s'additionnent", () => {
    const character = {
      skills: [
        { name: "Affinité", score: 3, isAffinity: true, affinityTargetPowerName: "Soin" },
        { name: "Affinité Guérison", score: 2, isAffinity: true, affinityTargetDiscipline: "Guérison" },
      ],
    };
    expect(getPowerAffinityBonus(character, { name: "Soin", discipline: "Guérison" })).toBe(5);
  });

  it("getSkillAffinityBonus : une compétence d'Affinité peut aussi cibler une autre compétence (pas seulement un pouvoir)", () => {
    const character = {
      skills: [{ name: "Affinité tir", score: 6, isAffinity: true, affinityTargetSkillName: "Arme de poing (PER)" }],
    };
    expect(getSkillAffinityBonus(character, "Arme de poing (PER)")).toBe(6);
    expect(getSkillAffinityBonus(character, "Mêlée (DEX)")).toBe(0);
  });

  it("getSkillDisplayTotal : une compétence d'Affinité n'ajoute PAS son propre attribut à son total affiché — juste son score de base", () => {
    const character = {
      skills: [{ name: "Affinité (VOL)", score: 5, isAffinity: true, affinityTargetPowerName: "Soin" }],
      activePsyPowers: [],
    };
    const attributeTotals = computeCharacter(sternTack, referenceData).attributeTotals; // VOL non nul
    const display = getSkillDisplayTotal(character.skills[0]!, character, attributeTotals);
    expect(display.attribute).toBeNull();
    expect(display.total).toBe(5); // pas 5 + VOL
  });

  it("getSkillDisplayTotal : une compétence normale ciblée par une Affinité reçoit le bonus en plus de son attribut habituel", () => {
    const character = {
      skills: [
        { name: "Commandement (COM)", score: 6 },
        { name: "Affinité commandement", score: 3, isAffinity: true, affinityTargetSkillName: "Commandement (COM)" },
      ],
      activePsyPowers: [],
    };
    const attributeTotals = computeCharacter(sternTack, referenceData).attributeTotals;
    const display = getSkillDisplayTotal(character.skills[0]!, character, attributeTotals);
    expect(display.attribute).toBe("COM");
    expect(display.affinityBonus).toBe(3);
    expect(display.total).toBe(6 + attributeTotals.COM + 3);
  });
});

describe("budget de points — cas réel Stern Tack", () => {
  it("solde recalculé : avantages coûtent, inconvénients donnent (-68, confirmé par le MJ — contre +2 dans le classeur bugué)", () => {
    const { budget } = computeCharacter(sternTack, referenceData);
    expect(budget.totalDispo).toBe(267);
    expect(budget.skillsCost).toBe(290);
    expect(budget.psyPowersCost).toBe(35);
    // Avantages dérivés du catalogue corrigé : ..., Dans les nuages -30 (pas +20).
    expect(budget.advantagesNet).toBe(10);
    // solde = totalDispo - skillsCost - psyPowersCost - advantagesNet (pas +)
    expect(budget.solde).toBe(-68);
  });
});
