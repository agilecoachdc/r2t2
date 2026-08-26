// Page d'admin "Jeux & règles" — CRUD des jeux, et par jeu des règles
// (rulesets). L'édition d'une règle ouvre un éditeur de catalogue à onglets
// (races/compétences/armes/armures/pouvoirs psy/avantages/table de coût),
// construit sur CatalogTable (composant générique, ../../components/CatalogTable).
// Réservée au rôle admin (route protégée côté App.tsx + API /api/admin/*).

import { useEffect, useState } from "react";
import {
  ATTRIBUTES,
  WEAPON_TYPES,
  type AdvantageDefinition,
  type ArmorDefinition,
  type Game,
  type PsyPowerDefinition,
  type RaceDefinition,
  type ReferenceData,
  type Ruleset,
  type RulesetDetail,
  type SkillDefinition,
  type WeaponDefinition,
} from "@shared/types";
import { api } from "../../lib/api";
import { CatalogTable, type CatalogColumn } from "../../components/CatalogTable";
import { ImagePicker } from "../../components/ImagePicker";
import { AdminNav } from "../../components/AdminNav";

const CATALOG_TABS = [
  "Races",
  "Compétences",
  "Armes",
  "Armures",
  "Pouvoirs psy",
  "Avantages",
  "Table de coût",
] as const;
type CatalogTab = (typeof CATALOG_TABS)[number];

function TextInput({ value, onChange, className = "" }: { value: string; onChange: (v: string) => void; className?: string }) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm ${className}`}
    />
  );
}

export default function GamesRulesets() {
  const [games, setGames] = useState<Game[]>([]);
  const [gameName, setGameName] = useState("");
  const [gameDescription, setGameDescription] = useState("");
  const [gameImageUrl, setGameImageUrl] = useState<string | null>(null);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);

  const [rulesets, setRulesets] = useState<Ruleset[]>([]);
  const [rulesetName, setRulesetName] = useState("");
  const [rulesetDescription, setRulesetDescription] = useState("");
  const [rulesetImageUrl, setRulesetImageUrl] = useState<string | null>(null);
  const [selectedRulesetId, setSelectedRulesetId] = useState<string | null>(null);

  const [draft, setDraft] = useState<RulesetDetail | null>(null);
  const [tab, setTab] = useState<CatalogTab>("Races");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function loadGames() {
    return api.listGames().then(({ games }) => setGames(games)).catch((err) => setError(errMsg(err)));
  }
  useEffect(() => {
    loadGames();
  }, []);

  function loadRulesets(gameId: string) {
    return api.listRulesets(gameId).then(({ rulesets }) => setRulesets(rulesets)).catch((err) => setError(errMsg(err)));
  }
  useEffect(() => {
    if (selectedGameId) loadRulesets(selectedGameId);
    else setRulesets([]);
    setSelectedRulesetId(null);
    setDraft(null);
  }, [selectedGameId]);

  useEffect(() => {
    if (!selectedRulesetId) {
      setDraft(null);
      return;
    }
    api.getRuleset(selectedRulesetId).then(({ ruleset }) => setDraft(ruleset)).catch((err) => setError(errMsg(err)));
  }, [selectedRulesetId]);

  async function handleCreateGame(e: React.FormEvent) {
    e.preventDefault();
    if (!gameName.trim()) return;
    try {
      const { game } = await api.createGame({
        name: gameName.trim(),
        description: gameDescription.trim(),
        imageUrl: gameImageUrl,
      });
      setGameName("");
      setGameDescription("");
      setGameImageUrl(null);
      await loadGames();
      setSelectedGameId(game.id);
    } catch (err) {
      setError(errMsg(err));
    }
  }

  async function handleDeleteGame(id: string) {
    try {
      await api.deleteGame(id);
      if (selectedGameId === id) setSelectedGameId(null);
      await loadGames();
    } catch (err) {
      setError(errMsg(err));
    }
  }

  async function handleCreateRuleset(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedGameId || !rulesetName.trim()) return;
    try {
      const { ruleset } = await api.createRuleset({
        gameId: selectedGameId,
        name: rulesetName.trim(),
        description: rulesetDescription.trim(),
        imageUrl: rulesetImageUrl,
      });
      setRulesetName("");
      setRulesetDescription("");
      setRulesetImageUrl(null);
      await loadRulesets(selectedGameId);
      setSelectedRulesetId(ruleset.id);
    } catch (err) {
      setError(errMsg(err));
    }
  }

  async function handleDeleteRuleset(id: string) {
    try {
      await api.deleteRuleset(id);
      if (selectedRulesetId === id) setSelectedRulesetId(null);
      if (selectedGameId) await loadRulesets(selectedGameId);
    } catch (err) {
      setError(errMsg(err));
    }
  }

  async function handleSaveRuleset() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const { ruleset } = await api.updateRuleset(draft.id, {
        name: draft.name,
        description: draft.description,
        imageUrl: draft.imageUrl,
        referenceData: draft.referenceData,
      });
      setDraft(ruleset);
      if (selectedGameId) await loadRulesets(selectedGameId);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setSaving(false);
    }
  }

  function updateReferenceData(patch: Partial<ReferenceData>) {
    setDraft((d) => (d ? { ...d, referenceData: { ...d.referenceData, ...patch } } : d));
  }

  return (
    <div className="min-h-dvh bg-slate-950">
      <div className="mx-auto max-w-5xl px-4 py-6">
        <header className="mb-6 flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold">Jeux &amp; règles</h1>
          <AdminNav current="jeux" />
        </header>

        {error && <p className="mb-4 text-red-400">{error}</p>}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Jeux */}
          <section className="rounded-xl bg-slate-900 p-4 shadow">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Jeux</h2>
            <ul className="mb-3 space-y-1">
              {games.map((g) => (
                <li key={g.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedGameId(g.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm ${
                      selectedGameId === g.id ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-200 hover:bg-slate-700"
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {g.imageUrl ? (
                        <img src={g.imageUrl} alt="" className="h-6 w-6 shrink-0 rounded object-cover" />
                      ) : (
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-slate-700 text-xs">{g.name.charAt(0)}</span>
                      )}
                      <span className="truncate">{g.name}</span>
                    </span>
                    <span
                      role="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteGame(g.id);
                      }}
                      className="shrink-0 text-slate-400 hover:text-red-400"
                      aria-label={`Supprimer ${g.name}`}
                    >
                      ×
                    </span>
                  </button>
                </li>
              ))}
              {games.length === 0 && <p className="text-sm text-slate-500">Aucun jeu.</p>}
            </ul>
            <form onSubmit={handleCreateGame} className="space-y-2">
              <div className="flex items-start gap-3">
                <ImagePicker value={gameImageUrl} onChange={setGameImageUrl} sizePx={64} />
                <div className="flex-1 space-y-2">
                  <TextInput value={gameName} onChange={setGameName} className="w-full" />
                  <TextInput value={gameDescription} onChange={setGameDescription} className="w-full" />
                </div>
              </div>
              <button type="submit" className="w-full rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">
                + Nouveau jeu
              </button>
            </form>
          </section>

          {/* Règles du jeu sélectionné */}
          <section className="rounded-xl bg-slate-900 p-4 shadow">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Règles</h2>
            {!selectedGameId && <p className="text-sm text-slate-500">Choisissez un jeu.</p>}
            {selectedGameId && (
              <>
                <ul className="mb-3 space-y-1">
                  {rulesets.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedRulesetId(r.id)}
                        className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm ${
                          selectedRulesetId === r.id ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-200 hover:bg-slate-700"
                        }`}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          {r.imageUrl ? (
                            <img src={r.imageUrl} alt="" className="h-6 w-6 shrink-0 rounded object-cover" />
                          ) : (
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-slate-700 text-xs">{r.name.charAt(0)}</span>
                          )}
                          <span className="truncate">{r.name}</span>
                        </span>
                        <span
                          role="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteRuleset(r.id);
                          }}
                          className="shrink-0 text-slate-400 hover:text-red-400"
                          aria-label={`Supprimer ${r.name}`}
                        >
                          ×
                        </span>
                      </button>
                    </li>
                  ))}
                  {rulesets.length === 0 && <p className="text-sm text-slate-500">Aucune règle.</p>}
                </ul>
                <form onSubmit={handleCreateRuleset} className="space-y-2">
                  <div className="flex items-start gap-3">
                    <ImagePicker value={rulesetImageUrl} onChange={setRulesetImageUrl} sizePx={64} />
                    <div className="flex-1 space-y-2">
                      <TextInput value={rulesetName} onChange={setRulesetName} className="w-full" />
                      <TextInput value={rulesetDescription} onChange={setRulesetDescription} className="w-full" />
                    </div>
                  </div>
                  <button type="submit" className="w-full rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">
                    + Nouvelle règle
                  </button>
                </form>
              </>
            )}
          </section>

          {/* Résumé de la règle sélectionnée */}
          <section className="rounded-xl bg-slate-900 p-4 shadow">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Détails</h2>
            {!draft && <p className="text-sm text-slate-500">Choisissez une règle.</p>}
            {draft && (
              <div className="space-y-2">
                <ImagePicker
                  value={draft.imageUrl}
                  onChange={(v) => setDraft((d) => (d ? { ...d, imageUrl: v } : d))}
                  sizePx={80}
                />
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Nom</label>
                  <TextInput
                    value={draft.name}
                    onChange={(v) => setDraft((d) => (d ? { ...d, name: v } : d))}
                    className="w-full"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-slate-500">Description</label>
                  <TextInput
                    value={draft.description}
                    onChange={(v) => setDraft((d) => (d ? { ...d, description: v } : d))}
                    className="w-full"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleSaveRuleset}
                  disabled={saving}
                  className="w-full rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  {saving ? "Enregistrement…" : "Enregistrer"}
                </button>
              </div>
            )}
          </section>
        </div>

        {/* Catalogue de la règle sélectionnée */}
        {draft && (
          <section className="mt-4 rounded-xl bg-slate-900 p-4 shadow">
            <div className="mb-3 flex flex-wrap gap-2">
              {CATALOG_TABS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTab(t)}
                  className={`rounded-lg px-3 py-1.5 text-sm ${tab === t ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
                >
                  {t}
                </button>
              ))}
            </div>

            {tab === "Races" && (
              <CatalogTable<RaceDefinition>
                rows={draft.referenceData.races}
                onChange={(races) => updateReferenceData({ races })}
                addLabel="+ Ajouter une race"
                emptyRow={() => ({
                  race: "",
                  label: "",
                  attributeBonus: Object.fromEntries(ATTRIBUTES.map((a) => [a, 0])) as RaceDefinition["attributeBonus"],
                  tailleBonus: 0,
                  skillPoints: 0,
                })}
                columns={[
                  { key: "race", label: "Clé", kind: "text", get: (r) => r.race, set: (r, v) => ({ ...r, race: v as RaceDefinition["race"] }) },
                  { key: "label", label: "Nom", kind: "text", get: (r) => r.label, set: (r, v) => ({ ...r, label: v }) },
                  { key: "tailleBonus", label: "Taille", kind: "number", get: (r) => r.tailleBonus, set: (r, v) => ({ ...r, tailleBonus: Number(v) || 0 }) },
                  { key: "skillPoints", label: "Pts compét.", kind: "number", get: (r) => r.skillPoints, set: (r, v) => ({ ...r, skillPoints: Number(v) || 0 }) },
                  ...ATTRIBUTES.map(
                    (attr): CatalogColumn<RaceDefinition> => ({
                      key: attr,
                      label: attr,
                      kind: "number",
                      get: (r) => r.attributeBonus[attr] ?? 0,
                      set: (r, v) => ({ ...r, attributeBonus: { ...r.attributeBonus, [attr]: Number(v) || 0 } }),
                    }),
                  ),
                ]}
              />
            )}

            {tab === "Compétences" && (
              <CatalogTable<SkillDefinition>
                rows={draft.referenceData.skills}
                onChange={(skills) => updateReferenceData({ skills })}
                addLabel="+ Ajouter une compétence"
                emptyRow={() => ({ name: "", attribute: null })}
                columns={[
                  { key: "name", label: "Nom", kind: "text", get: (r) => r.name, set: (r, v) => ({ ...r, name: v }) },
                  {
                    key: "attribute",
                    label: "Attribut",
                    kind: "select",
                    options: [...ATTRIBUTES],
                    get: (r) => r.attribute ?? "",
                    set: (r, v) => ({ ...r, attribute: v ? (v as SkillDefinition["attribute"]) : null }),
                  },
                  { key: "description", label: "Description", kind: "text", get: (r) => r.description ?? "", set: (r, v) => ({ ...r, description: v || undefined }) },
                ]}
              />
            )}

            {tab === "Armes" && (
              <CatalogTable<WeaponDefinition>
                rows={draft.referenceData.weapons}
                onChange={(weapons) => updateReferenceData({ weapons })}
                addLabel="+ Ajouter une arme"
                emptyRow={() => ({ name: "", type: null, damage: null, price: null, ra: null })}
                columns={[
                  { key: "name", label: "Nom", kind: "text", get: (r) => r.name, set: (r, v) => ({ ...r, name: v }) },
                  {
                    key: "type",
                    label: "Type",
                    kind: "select",
                    options: [...WEAPON_TYPES],
                    get: (r) => r.type ?? "",
                    set: (r, v) => ({ ...r, type: v ? (v as WeaponDefinition["type"]) : null }),
                  },
                  { key: "damage", label: "Dégâts", kind: "number", get: (r) => r.damage ?? "", set: (r, v) => ({ ...r, damage: v === "" ? null : Number(v) }) },
                  { key: "ra", label: "RA", kind: "number", get: (r) => r.ra ?? "", set: (r, v) => ({ ...r, ra: v === "" ? null : Number(v) }) },
                  { key: "price", label: "Prix", kind: "text", get: (r) => r.price ?? "", set: (r, v) => ({ ...r, price: v || null }) },
                ]}
              />
            )}

            {tab === "Armures" && (
              <CatalogTable<ArmorDefinition>
                rows={draft.referenceData.armor}
                onChange={(armor) => updateReferenceData({ armor })}
                addLabel="+ Ajouter une armure"
                emptyRow={() => ({ name: "", vpTete: 0, vpBras: 0, vpTorse: 0, vpJambes: 0, price: null })}
                columns={[
                  { key: "name", label: "Nom", kind: "text", get: (r) => r.name, set: (r, v) => ({ ...r, name: v }) },
                  { key: "vpTete", label: "VP tête", kind: "number", get: (r) => r.vpTete, set: (r, v) => ({ ...r, vpTete: Number(v) || 0 }) },
                  { key: "vpBras", label: "VP bras", kind: "number", get: (r) => r.vpBras, set: (r, v) => ({ ...r, vpBras: Number(v) || 0 }) },
                  { key: "vpTorse", label: "VP torse", kind: "number", get: (r) => r.vpTorse, set: (r, v) => ({ ...r, vpTorse: Number(v) || 0 }) },
                  { key: "vpJambes", label: "VP jambes", kind: "number", get: (r) => r.vpJambes, set: (r, v) => ({ ...r, vpJambes: Number(v) || 0 }) },
                  { key: "price", label: "Prix", kind: "text", get: (r) => r.price ?? "", set: (r, v) => ({ ...r, price: v || null }) },
                ]}
              />
            )}

            {tab === "Pouvoirs psy" && (
              <CatalogTable<PsyPowerDefinition>
                rows={draft.referenceData.psyPowers}
                onChange={(psyPowers) => updateReferenceData({ psyPowers })}
                addLabel="+ Ajouter un pouvoir"
                emptyRow={() => ({ name: "", discipline: "" })}
                columns={[
                  { key: "name", label: "Nom", kind: "text", get: (r) => r.name, set: (r, v) => ({ ...r, name: v }) },
                  { key: "discipline", label: "Discipline", kind: "text", get: (r) => r.discipline, set: (r, v) => ({ ...r, discipline: v }) },
                  { key: "description", label: "Description", kind: "text", get: (r) => r.description ?? "", set: (r, v) => ({ ...r, description: v || undefined }) },
                ]}
              />
            )}

            {tab === "Avantages" && (
              <CatalogTable<AdvantageDefinition>
                rows={draft.referenceData.advantages}
                onChange={(advantages) => updateReferenceData({ advantages })}
                addLabel="+ Ajouter un avantage"
                emptyRow={() => ({ label: "", value: 0 })}
                columns={[
                  { key: "label", label: "Libellé", kind: "text", get: (r) => r.label, set: (r, v) => ({ ...r, label: v }) },
                  { key: "value", label: "Valeur", kind: "number", get: (r) => r.value, set: (r, v) => ({ ...r, value: Number(v) || 0 }) },
                  { key: "description", label: "Description", kind: "text", get: (r) => r.description ?? "", set: (r, v) => ({ ...r, description: v || undefined }) },
                ]}
              />
            )}

            {tab === "Table de coût" && (
              <SkillCostTableEditor
                table={draft.referenceData.skillCostTable}
                onChange={(skillCostTable) => updateReferenceData({ skillCostTable })}
              />
            )}
          </section>
        )}
      </div>
    </div>
  );
}

// La table de coût est un Record<score, coût> plutôt qu'une liste — on
// l'édite comme une liste de paires {score, coût} et on la reconstruit en
// Record au changement (les clés dupliquées écrasent silencieusement,
// comme un objet JS normal).
function SkillCostTableEditor({
  table,
  onChange,
}: {
  table: ReferenceData["skillCostTable"];
  onChange: (table: ReferenceData["skillCostTable"]) => void;
}) {
  const rows = Object.entries(table)
    .map(([score, cost]) => ({ score: Number(score), cost }))
    .sort((a, b) => a.score - b.score);

  function setRows(next: { score: number; cost: number }[]) {
    const rebuilt: ReferenceData["skillCostTable"] = {};
    for (const r of next) rebuilt[r.score] = r.cost;
    onChange(rebuilt);
  }

  return (
    <CatalogTable<{ score: number; cost: number }>
      rows={rows}
      onChange={setRows}
      addLabel="+ Ajouter un palier"
      emptyRow={() => ({ score: 0, cost: 0 })}
      columns={[
        { key: "score", label: "Score", kind: "number", get: (r) => r.score, set: (r, v) => ({ ...r, score: Number(v) || 0 }) },
        { key: "cost", label: "Coût", kind: "number", get: (r) => r.cost, set: (r, v) => ({ ...r, cost: Number(v) || 0 }) },
      ]}
    />
  );
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : "Erreur";
}
