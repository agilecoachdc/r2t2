#!/usr/bin/env node
// Génère migrations/0009_race_attributes.sql — propage le catalogue courant
// de src/shared/reference-data.ts (table `races` alignée sur la dernière
// table de règles du MJ : 11 peuples, dont Thri-Kreen/Gobelin/Drow ajoutés
// et Orc/Gnome/Rohirim corrigés) à la règle "add40k" DÉJÀ présente en base.
//
// Même astuce que generate_book_prices_migration.mjs : on transpile le
// module TypeScript à la volée plutôt que de recopier ~1000 lignes de
// données.
//
// Usage : node scripts/generate_race_attributes_migration.mjs
// Écrit : migrations/0009_race_attributes.sql

import ts from "typescript";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function loadReferenceData() {
  const source = readFileSync(path.join(ROOT, "src/shared/reference-data.ts"), "utf-8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  const tmpDir = mkdtempSync(path.join(tmpdir(), "r2t2-refdata-"));
  const tmpFile = path.join(tmpDir, "reference-data.mjs");
  writeFileSync(tmpFile, outputText);
  try {
    const mod = await import(pathToFileURL(tmpFile).href);
    return mod.referenceData;
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  const referenceData = await loadReferenceData();
  const json = JSON.stringify(referenceData);
  const sql = `-- Généré par scripts/generate_race_attributes_migration.mjs — NE PAS ÉDITER À LA MAIN.
-- Aligne le catalogue de la règle "add40k" (rulesets.reference_data) sur
-- src/shared/reference-data.ts après la mise à jour de la table \`races\` :
--   * Rohirim renommé "Rohirrim" et passé à 10 points de compétence ;
--   * Orc : INT 0 -> -1, bonus de taille 1 -> 0 ;
--   * Gnome : INT 0 -> +1 ;
--   * 3 nouveaux peuples : Thri-Kreen, Gobelin, Drow.
-- La migration 0003 (backfill initial) a été régénérée avec les mêmes
-- valeurs pour les bases neuves ; cette migration-ci met à jour la base de
-- production, où 0003/0008 ont déjà tourné avec l'ancienne table \`races\`.
-- Idempotente : réappliquée, elle réécrit la même valeur.

UPDATE rulesets SET reference_data = ${sqlString(json)} WHERE id = 'add40k';
`;
  writeFileSync(path.join(ROOT, "migrations/0009_race_attributes.sql"), sql);
  console.log("Écrit migrations/0009_race_attributes.sql");
}

main();
