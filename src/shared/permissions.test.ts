import { describe, expect, it } from "vitest";
import { canAccessGroup, isGmOfGroup } from "./permissions";

const admin = { role: "admin" as const, memberships: [] };
const gm = { role: "gm" as const, memberships: ["g1"] };
const player = { role: "player" as const, memberships: ["g1"] };

describe("canAccessGroup", () => {
  it("admin accède à tout groupe sans en être membre", () => {
    expect(canAccessGroup(admin, "g1")).toBe(true);
    expect(canAccessGroup(admin, "g2")).toBe(true);
  });
  it("MJ/joueur : uniquement leurs groupes approuvés", () => {
    expect(canAccessGroup(gm, "g1")).toBe(true);
    expect(canAccessGroup(gm, "g2")).toBe(false);
    expect(canAccessGroup(player, "g1")).toBe(true);
    expect(canAccessGroup(player, "g2")).toBe(false);
  });
  it("groupe absent → refus, même pour l'admin", () => {
    expect(canAccessGroup(admin, null)).toBe(false);
    expect(canAccessGroup(admin, undefined)).toBe(false);
    expect(canAccessGroup(admin, "")).toBe(false);
  });
});

describe("isGmOfGroup", () => {
  it("admin a les droits MJ sur tout groupe", () => {
    expect(isGmOfGroup(admin, "g1")).toBe(true);
    expect(isGmOfGroup(admin, "g2")).toBe(true);
  });
  it("MJ : uniquement dans ses groupes", () => {
    expect(isGmOfGroup(gm, "g1")).toBe(true);
    expect(isGmOfGroup(gm, "g2")).toBe(false);
  });
  it("joueur : jamais, même membre", () => {
    expect(isGmOfGroup(player, "g1")).toBe(false);
  });
  it("groupe absent → refus", () => {
    expect(isGmOfGroup(admin, null)).toBe(false);
  });
});
