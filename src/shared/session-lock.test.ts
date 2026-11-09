import { describe, expect, it } from "vitest";
import type { Character } from "./types";
import { applySessionLock } from "./session-lock";

const base = {
  race: "humain",
  attributeScores: { FO: 5 },
  skills: [{ name: "Tir (DEX)", score: 3 }],
  weapons: [
    { name: "Bolter", type: "distance", damage: 8, ra: 2, baseScore: 10, equipped: false },
    { name: "Couteau", type: "contact", damage: 2, ra: 0, baseScore: 5, equipped: true },
  ],
  armor: [{ name: "Carapace", vpTete: 2, vpBras: 2, vpTorse: 3, vpJambes: 2, active: false }],
  equipment: [{ label: "Medikit" }],
  xp: 10,
  credits: 500,
  hpCurrent: 12,
  notes: "",
} as unknown as Character;

describe("applySessionLock", () => {
  it("ignore les champs de progression et garde les compteurs de jeu", () => {
    const patch = applySessionLock(base, {
      skills: [{ name: "Tir (DEX)", score: 9 }] as Character["skills"],
      attributeScores: { FO: 9 } as Character["attributeScores"],
      equipment: [],
      credits: 0,
      xp: 99,
      hpCurrent: 4,
      notes: "blessé",
    });
    expect(patch).toEqual({ hpCurrent: 4, notes: "blessé" });
  });

  it("laisse passer la bascule équipée/portée mais pas l'ajout ni les stats", () => {
    const patch = applySessionLock(base, {
      weapons: [
        { ...base.weapons[0]!, equipped: true, damage: 99 },
        { ...base.weapons[1]!, equipped: false },
        { name: "Lance-flammes", type: "distance", damage: 12, ra: 3, baseScore: 8, equipped: true },
      ] as Character["weapons"],
      armor: [{ ...base.armor[0]!, active: true, vpTorse: 50 }],
    });
    expect(patch.weapons).toEqual([
      { ...base.weapons[0]!, equipped: true },
      { ...base.weapons[1]!, equipped: false },
    ]);
    expect(patch.armor).toEqual([{ ...base.armor[0]!, active: true }]);
  });

  it("refuse un retrait d'arme (liste raccourcie)", () => {
    const patch = applySessionLock(base, { weapons: [base.weapons[1]!] });
    expect(patch.weapons).toEqual(base.weapons);
  });
});
