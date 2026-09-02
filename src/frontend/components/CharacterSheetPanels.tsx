// Sections de la fiche personnage. Chaque panneau reçoit le personnage
// "en cours d'édition" (état local de CharacterSheet.tsx), les valeurs
// calculées en direct (calc-engine), et — en mode édition — un `update`
// pour muter une portion du personnage. Tout est lecture seule si `editing`
// est faux.

import { useRef, useState } from "react";
import {
  ATTRIBUTES,
  WEAPON_TYPES,
  type ActivePsyPower,
  type Attribute,
  type Character,
  type ReferenceData,
  type SkillJustification,
  type WeaponModifier,
  type WeaponType,
} from "@shared/types";
import type { CharacterComputed } from "@shared/calc-engine";
import {
  CONCENTRATION_PSY_ATTRIBUTES,
  getActivePsyPowerAttributeBoost,
  getActivePsyPowerSkillBoost,
  getDualWieldPenalty,
  getMonthlyIncome,
  getPowerAffinityBonus,
  getPsyPowerActivationCost,
  getPsyPowerTotal,
  getSkillDisplayTotal,
  getSkillJustifications,
  getSkillJustifiedScore,
  getSkillTotal,
  getWeaponSuggestedScore,
  getWeaponTotals,
  parseCatalogPrice,
  PSY_POWER_LEVELS,
} from "@shared/calc-engine";
import { LocalisationSilhouette, RaceArmorSilhouette } from "./RaceArmorSilhouette";
import { resizePortraitToDataUrl } from "../lib/image";
import { useTranslation } from "../lib/i18n";

type Update = (patch: Partial<Character>) => void;

const ATTRIBUTE_LABELS: Record<Attribute, string> = {
  FO: "Force",
  VIT: "Vitalité",
  DEX: "Dextérité",
  REF: "Réflexe",
  PER: "Perception",
  COM: "Communication",
  INT: "Intelligence",
  VOL: "Volonté",
};

/**
 * Toutes les sections de la fiche passent par ce wrapper — le rendre
 * repliable ici les rend TOUTES repliables d'un coup, sans toucher chaque
 * panneau. Ouvert par défaut (pas de régression de visibilité) ; l'état
 * n'est pas persisté (juste un confort d'affichage pendant la session,
 * pas une préférence à retenir entre deux visites).
 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="rounded-xl bg-slate-900 p-4 shadow">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mb-3 flex w-full items-center justify-between text-left text-sm font-semibold uppercase tracking-wide text-slate-400 hover:text-slate-200"
        aria-expanded={open}
      >
        <span>{title}</span>
        <span className="text-slate-500">{open ? "▾" : "▸"}</span>
      </button>
      {open && children}
    </section>
  );
}

function NumberInput({ value, onChange, className = "" }: { value: number; onChange: (n: number) => void; className?: string }) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className={`w-16 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-center text-sm ${className}`}
    />
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  className = "",
}: {
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm ${className}`}
    />
  );
}

/**
 * Sélecteur d'un nom/libellé depuis le catalogue de référence (feuille
 * `listes` du classeur Excel — src/shared/reference-data.ts), plutôt qu'un
 * champ texte libre : évite les fautes de frappe et permet d'auto-remplir
 * les caractéristiques associées (dégâts/RA d'une arme, VP d'une armure,
 * discipline d'un pouvoir, valeur d'un avantage...) au choix, via `onPick`.
 */
function CatalogSelect({
  value,
  options,
  onPick,
  placeholder = "— choisir —",
  className = "",
}: {
  value: string;
  options: string[];
  onPick: (name: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onPick(e.target.value)}
      className={`rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm ${className}`}
    >
      <option value="">{placeholder}</option>
      {options.map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </select>
  );
}

// ---------------------------------------------------------------------------

export function IdentityHeader({
  character,
  editing,
  update,
  referenceData,
}: {
  character: Character;
  editing: boolean;
  update: Update;
  referenceData: ReferenceData;
}) {
  const { t } = useTranslation();
  const fields: [string, keyof Character][] = [
    [t("Faction"), "faction"],
    [t("Fonction"), "fonction"],
    [t("Loyauté"), "loyaute"],
    [t("Poids"), "weightLabel"],
  ];
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [portraitError, setPortraitError] = useState<string | null>(null);

  async function handlePortraitChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // permet de resélectionner le même fichier ensuite
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setPortraitError("Le fichier doit être une image");
      return;
    }
    try {
      const dataUrl = await resizePortraitToDataUrl(file);
      update({ portraitUrl: dataUrl });
      setPortraitError(null);
    } catch (err) {
      setPortraitError(err instanceof Error ? err.message : "Échec du chargement de l'image");
    }
  }

  return (
    <Section title={t("Identité")}>
      <div className="flex flex-wrap items-start gap-4">
        {editing ? (
          <div className="flex flex-col items-center gap-1">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="group relative h-24 w-24 overflow-hidden rounded-lg bg-slate-800 text-3xl text-slate-600"
            >
              {character.portraitUrl ? (
                <img src={character.portraitUrl} alt={character.name} className="h-full w-full object-cover" />
              ) : (
                <span className="flex h-full w-full items-center justify-center">{character.name.charAt(0)}</span>
              )}
              <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100">
                {t("Changer")}
              </span>
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePortraitChange} />
            {character.portraitUrl && (
              <button
                type="button"
                onClick={() => update({ portraitUrl: null })}
                className="text-xs text-slate-500 hover:text-red-400"
              >
                {t("Retirer la photo")}
              </button>
            )}
            {portraitError && <p className="w-24 text-center text-xs text-red-400">{portraitError}</p>}
          </div>
        ) : character.portraitUrl ? (
          <img src={character.portraitUrl} alt={character.name} className="h-24 w-24 rounded-lg object-cover" />
        ) : (
          <div className="flex h-24 w-24 items-center justify-center rounded-lg bg-slate-800 text-3xl text-slate-600">
            {character.name.charAt(0)}
          </div>
        )}
        <div className="flex-1 space-y-2">
          {editing ? (
            <TextInput value={character.name} onChange={(v) => update({ name: v })} className="text-lg font-semibold" />
          ) : (
            <h1 className="text-lg font-semibold text-slate-100">{character.name}</h1>
          )}
          <p className="text-sm text-slate-400">
            {referenceData.races.find((r) => r.race === character.race)?.label ?? character.race}
            {character.age != null && ` · ${character.age} ans`}
            {character.heightM != null && ` · ${character.heightM} m`}
          </p>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            {fields.map(([label, key]) => (
              <div key={key}>
                <p className="text-slate-500">{label}</p>
                {editing ? (
                  <TextInput
                    value={String(character[key] ?? "")}
                    onChange={(v) => update({ [key]: v } as Partial<Character>)}
                    className="w-full"
                  />
                ) : (
                  <p className="text-slate-200">{String(character[key] ?? "—")}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </Section>
  );
}

export function HpPspBar({
  character,
  computed,
  onAdjust,
}: {
  character: Character;
  computed: CharacterComputed;
  onAdjust: (field: "hpCurrent" | "pspCurrent", value: number) => void;
}) {
  const { t } = useTranslation();
  function Bar(label: string, current: number, max: number, onChange: (n: number) => void, color: string) {
    const pct = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0;
    return (
      <div className="flex-1">
        <div className="mb-1 flex items-center justify-between text-sm">
          <span className="font-medium text-slate-300">{label}</span>
          <span className="text-slate-400">
            {current} / {max}
          </span>
        </div>
        <div className="mb-2 h-2 overflow-hidden rounded-full bg-slate-800">
          <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
        </div>
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => onChange(Math.max(0, current - 1))}
            className="h-8 w-8 rounded bg-slate-800 text-lg text-slate-200 hover:bg-slate-700"
            aria-label={`-1 ${label}`}
          >
            −
          </button>
          <button
            onClick={() => onChange(Math.min(max, current + 1))}
            className="h-8 w-8 rounded bg-slate-800 text-lg text-slate-200 hover:bg-slate-700"
            aria-label={`+1 ${label}`}
          >
            +
          </button>
        </div>
      </div>
    );
  }

  return (
    <Section title={t("PV / PSP")}>
      <div className="flex gap-6">
        {Bar(t("PV"), character.hpCurrent, computed.hpMax, (n) => onAdjust("hpCurrent", n), "bg-red-500")}
        {Bar(t("PSP"), character.pspCurrent, computed.pspMax, (n) => onAdjust("pspCurrent", n), "bg-sky-500")}
      </div>
    </Section>
  );
}

/**
 * Attributs : la fiche n'affiche toujours que le total (comme l'Excel), mais
 * en édition on peut "drill through" un attribut pour voir/éditer sa
 * décomposition base + racial (lecture seule, dépend de la race) + tech.
 */
export function AttributesPanel({
  character,
  computed,
  editing,
  update,
  referenceData,
}: {
  character: Character;
  computed: CharacterComputed;
  editing: boolean;
  update: Update;
  referenceData: ReferenceData;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Attribute | null>(null);
  const raceDef = referenceData.races.find((r) => r.race === character.race);

  return (
    <Section title={t("Attributs")}>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        {ATTRIBUTES.map((attr) => {
          const isOpen = editing && selected === attr;
          const boost = getActivePsyPowerAttributeBoost(character, computed.attributeTotals, attr);
          return (
            <div key={attr} className="overflow-hidden rounded-lg bg-slate-800/50">
              <button
                type="button"
                onClick={() => editing && setSelected(isOpen ? null : attr)}
                className={`flex w-full items-center justify-between px-3 py-2 text-left ${editing ? "cursor-pointer hover:bg-slate-800" : "cursor-default"}`}
              >
                <span className="text-sm text-slate-300">{t(ATTRIBUTE_LABELS[attr])}</span>
                <span className="flex items-center gap-1.5">
                  <span className="text-lg font-semibold text-slate-100">{computed.attributeTotals[attr] + boost}</span>
                  {boost !== 0 && (
                    <span
                      className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-xs font-semibold text-amber-300"
                      title={t("Bonus de pouvoir psy actif")}
                    >
                      {boost > 0 ? "+" : ""}
                      {boost}
                    </span>
                  )}
                </span>
              </button>
              {isOpen && (
                <div className="space-y-1.5 border-t border-slate-700 px-3 py-2 text-xs text-slate-400" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-between">
                    <span>{t("Base")}</span>
                    <NumberInput
                      value={character.attributeScores[attr]}
                      onChange={(n) => update({ attributeScores: { ...character.attributeScores, [attr]: n } })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span>{t("Racial")} ({raceDef?.label ?? character.race})</span>
                    <span className="text-slate-300">{raceDef?.attributeBonus[attr] ?? 0}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>{t("Tech")}</span>
                    <NumberInput
                      value={character.attributeTechBonus[attr] ?? 0}
                      onChange={(n) =>
                        update({ attributeTechBonus: { ...character.attributeTechBonus, [attr]: n } })
                      }
                    />
                  </div>
                  {boost !== 0 && (
                    <div className="flex items-center justify-between text-amber-300">
                      <span>{t("Bonus de pouvoir psy actif")}</span>
                      <span>
                        {boost > 0 ? "+" : ""}
                        {boost}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between border-t border-slate-700 pt-1.5 font-semibold text-slate-200">
                    <span>{t("Total")}</span>
                    <span>{computed.attributeTotals[attr] + boost}</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

export function SkillsPanel({
  character,
  computed,
  editing,
  update,
  referenceData,
}: {
  character: Character;
  computed: CharacterComputed;
  editing: boolean;
  update: Update;
  referenceData: ReferenceData;
}) {
  const { t } = useTranslation();
  const skills = character.skills;
  const [expandedJustifications, setExpandedJustifications] = useState<number | null>(null);
  // Disciplines/sciences du catalogue de la règle (dédupliquées) — cible
  // possible d'une compétence d'Affinité "science entière" (cf. plus bas).
  const disciplines = [...new Set(referenceData.psyPowers.map((p) => p.discipline))];
  function setSkill(i: number, patch: Partial<(typeof skills)[number]>) {
    update({ skills: skills.map((s, idx) => (idx === i ? { ...s, ...patch } : s)) });
  }
  // Écrit toujours dans le nouveau champ `justifications` (plusieurs lignes,
  // comme WeaponEntry.modifiers) et efface l'ancien `justification` (une
  // seule ligne) dès qu'on édite — la lecture reste rétro-compatible via
  // getSkillJustifications, mais l'écriture ne duplique jamais les deux.
  function setSkillJustifications(i: number, justifications: SkillJustification[]) {
    setSkill(i, { justifications, justification: undefined });
  }
  function affinityKindOf(s: (typeof skills)[number]): "skill" | "power" | "discipline" {
    if (s.affinityTargetPowerName != null) return "power";
    if (s.affinityTargetDiscipline != null) return "discipline";
    return "skill";
  }
  function affinityTargetLabel(s: (typeof skills)[number]): string {
    if (s.affinityTargetPowerName) return `${t("Pouvoir")} : ${s.affinityTargetPowerName}`;
    if (s.affinityTargetDiscipline) return `${t("Discipline")} : ${s.affinityTargetDiscipline}`;
    if (s.affinityTargetSkillName) return `${t("Compétence")} : ${s.affinityTargetSkillName}`;
    return t("— cible non choisie —");
  }
  // Version courte (juste le nom de la cible, sans préfixe "Pouvoir :"/etc.)
  // pour le badge — affiche la cible réelle plutôt que de répéter le mot
  // "Affinité" (redondant quand le nom de la ligne contient déjà ce mot,
  // ex. une compétence catalogue littéralement nommée "Affinité, cf. cas
  // réel Conrad Lingus vs. Karun où seule la première a un ciblage
  // explicite — signalé comme "Affinité Affinité" à l'écran).
  function affinityTargetShort(s: (typeof skills)[number]): string {
    return s.affinityTargetPowerName || s.affinityTargetDiscipline || s.affinityTargetSkillName || t("— cible non choisie —");
  }
  return (
    <Section title={t("Compétences")}>
      <div className="mb-1 hidden grid-cols-[1fr_auto_auto_auto] gap-2 px-1 text-xs text-slate-500 sm:grid">
        <span>{t("Compétence")}</span>
        <span className="text-right">{t("Score")}</span>
        <span className="text-right">{t("Attribut")}</span>
        <span className="text-right">{t("Total")}</span>
      </div>
      {editing && (
        <>
          <datalist id="skill-free-justification-source">
            {character.advantages.map((a, ai) => (
              <option key={`a-${ai}`} value={a.label} />
            ))}
            {character.equipment.map((e, ei) => (
              <option key={`e-${ei}`} value={e.label} />
            ))}
          </datalist>
          <datalist id="affinity-skill-target-source">
            {referenceData.skills.map((sd, sdi) => (
              <option key={sdi} value={sd.name} />
            ))}
          </datalist>
        </>
      )}
      <ul className="space-y-1">
        {skills.map((s, i) => {
          const justifications = getSkillJustifications(s);
          const justifiedScore = getSkillJustifiedScore(s);
          const display = getSkillDisplayTotal(s, character, computed.attributeTotals);
          const extra = display.affinityBonus + display.activeBoost;
          return (
            <li key={i} className="space-y-1">
              <div className="grid grid-cols-[1fr_auto_auto_auto_auto] items-center gap-2 text-sm">
                {editing ? (
                  s.free || s.isAffinity ? (
                    <TextInput
                      value={s.name}
                      onChange={(v) => setSkill(i, { name: v })}
                      placeholder={t("Nom de la compétence")}
                      className="flex-1"
                    />
                  ) : (
                    <CatalogSelect
                      value={s.name}
                      options={referenceData.skills.map((sd) => sd.name)}
                      onPick={(name) => setSkill(i, { name })}
                      placeholder={t("— choisir une compétence —")}
                      className="flex-1"
                    />
                  )
                ) : (
                  <span className="text-slate-200" title={referenceData.skills.find((sd) => sd.name === s.name)?.description}>
                    {s.name}
                    {s.free && (
                      <span
                        className="ml-1.5 rounded-full bg-emerald-600/20 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300"
                        title={justifications.map((j) => j.justification).join(", ") || undefined}
                      >
                        {t("Gratuite")}
                      </span>
                    )}
                    {s.isAffinity && (
                      <span
                        className="ml-1.5 rounded-full bg-sky-600/20 px-1.5 py-0.5 text-[10px] font-medium text-sky-300"
                        title={affinityTargetLabel(s)}
                      >
                        → {affinityTargetShort(s)}
                      </span>
                    )}
                  </span>
                )}
                {editing ? (
                  <NumberInput value={s.score} onChange={(n) => setSkill(i, { score: n })} />
                ) : (
                  <span className="w-10 text-right tabular-nums text-slate-300">{justifiedScore}</span>
                )}
                <span className="w-14 text-right text-xs tabular-nums text-slate-500">
                  {display.attribute ? `+${display.attributeValue} ${display.attribute}` : "—"}
                </span>
                <span className="flex w-14 items-center justify-end gap-1 text-right">
                  <span className="font-semibold tabular-nums text-indigo-300">{display.total}</span>
                  {extra !== 0 && (
                    <span
                      className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300"
                      title={t("Bonus d'affinité et/ou de pouvoir actif")}
                    >
                      {extra > 0 ? "+" : ""}
                      {extra}
                    </span>
                  )}
                </span>
                {editing && (
                  <button
                    onClick={() => update({ skills: skills.filter((_, idx) => idx !== i) })}
                    className="text-slate-500 hover:text-red-400"
                    aria-label="Retirer"
                  >
                    ×
                  </button>
                )}
              </div>
              {editing && (
                <div className="flex flex-wrap items-center gap-2 pl-1 text-xs text-slate-400">
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={s.free ?? false}
                      onChange={(e) => setSkill(i, { free: e.target.checked })}
                    />
                    {t("Gratuite (avantage/matériel)")}
                  </label>
                  {s.free && !s.isAffinity && (
                    <>
                      <select
                        value={s.attribute ?? ""}
                        onChange={(e) => setSkill(i, { attribute: (e.target.value || null) as Attribute | null })}
                        className="rounded border border-slate-700 bg-slate-800 px-1 py-0.5"
                      >
                        <option value="">{t("— attribut —")}</option>
                        {ATTRIBUTES.map((a) => (
                          <option key={a} value={a}>
                            {a}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => setExpandedJustifications(expandedJustifications === i ? null : i)}
                        className="text-indigo-400 hover:underline"
                      >
                        {justifications.length > 0 ? `${t("Justifications")} (${justifications.length})` : t("+ Justification")}
                      </button>
                    </>
                  )}
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={s.isAffinity ?? false}
                      onChange={(e) =>
                        setSkill(i, {
                          isAffinity: e.target.checked,
                          attribute: e.target.checked ? null : s.attribute,
                          affinityTargetSkillName: e.target.checked ? (s.affinityTargetSkillName ?? "") : undefined,
                          affinityTargetPowerName: e.target.checked ? s.affinityTargetPowerName : undefined,
                          affinityTargetDiscipline: e.target.checked ? s.affinityTargetDiscipline : undefined,
                        })
                      }
                    />
                    {t("Affinité")}
                  </label>
                  {s.isAffinity && (
                    <>
                      <select
                        value={affinityKindOf(s)}
                        onChange={(e) => {
                          const kind = e.target.value as "skill" | "power" | "discipline";
                          setSkill(i, {
                            affinityTargetSkillName: kind === "skill" ? "" : undefined,
                            affinityTargetPowerName: kind === "power" ? "" : undefined,
                            affinityTargetDiscipline: kind === "discipline" ? "" : undefined,
                          });
                        }}
                        className="rounded border border-slate-700 bg-slate-800 px-1 py-0.5"
                      >
                        <option value="skill">{t("Compétence")}</option>
                        <option value="power">{t("Pouvoir")}</option>
                        <option value="discipline">{t("Discipline")}</option>
                      </select>
                      {affinityKindOf(s) === "skill" && (
                        <input
                          list="affinity-skill-target-source"
                          type="text"
                          value={s.affinityTargetSkillName ?? ""}
                          onChange={(e) => setSkill(i, { affinityTargetSkillName: e.target.value })}
                          placeholder={t("— choisir une compétence —")}
                          className="min-w-[160px] flex-1 rounded border border-slate-700 bg-slate-800 px-2 py-1"
                        />
                      )}
                      {affinityKindOf(s) === "power" && (
                        <select
                          value={s.affinityTargetPowerName ?? ""}
                          onChange={(e) => setSkill(i, { affinityTargetPowerName: e.target.value })}
                          className="rounded border border-slate-700 bg-slate-800 px-2 py-1"
                        >
                          <option value="">{t("— choisir un pouvoir —")}</option>
                          {character.psyPowers.map((p) => (
                            <option key={p.name} value={p.name}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      )}
                      {affinityKindOf(s) === "discipline" && (
                        <select
                          value={s.affinityTargetDiscipline ?? ""}
                          onChange={(e) => setSkill(i, { affinityTargetDiscipline: e.target.value })}
                          className="rounded border border-slate-700 bg-slate-800 px-2 py-1"
                        >
                          <option value="">{t("— choisir une discipline —")}</option>
                          {disciplines.map((d) => (
                            <option key={d} value={d}>
                              {d}
                            </option>
                          ))}
                        </select>
                      )}
                    </>
                  )}
                </div>
              )}
              {editing && s.free && expandedJustifications === i && (
                <div className="ml-1 space-y-2 border-t border-slate-700 pt-2">
                  {justifications.map((j, ji) => (
                    <div key={ji} className="flex flex-wrap items-center gap-2 text-xs">
                      <input
                        list="skill-free-justification-source"
                        type="text"
                        value={j.justification}
                        onChange={(e) =>
                          setSkillJustifications(
                            i,
                            justifications.map((x, idx) => (idx === ji ? { ...x, justification: e.target.value } : x)),
                          )
                        }
                        placeholder={t("Justification (avantage / matériel)")}
                        className="min-w-[160px] flex-1 rounded border border-slate-700 bg-slate-800 px-2 py-1"
                      />
                      <span className="flex items-center gap-1">
                        {t("Score")}
                        <NumberInput
                          value={j.score ?? 0}
                          onChange={(n) => setSkillJustifications(i, justifications.map((x, idx) => (idx === ji ? { ...x, score: n } : x)))}
                          className="w-12"
                        />
                      </span>
                      <button
                        type="button"
                        onClick={() => setSkillJustifications(i, justifications.filter((_, idx) => idx !== ji))}
                        className="text-slate-500 hover:text-red-400"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setSkillJustifications(i, [...justifications, { justification: "", score: 0 }])}
                    className="text-xs text-indigo-400 hover:underline"
                  >
                    {t("+ Ajouter une justification")}
                  </button>
                  <p className="text-xs text-slate-500">
                    {t("Score total joué")} : {s.score} + {justifications.reduce((sum, j) => sum + (j.score ?? 0), 0)} = {justifiedScore}
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {editing && (
        <button
          onClick={() => update({ skills: [...skills, { name: "", score: 0 }] })}
          className="mt-2 text-sm text-indigo-400 hover:underline"
        >
          {t("+ Ajouter une compétence")}
        </button>
      )}
    </Section>
  );
}

/**
 * Tente de débiter `rawPrice` (prix catalogue, cf. parseCatalogPrice) du
 * solde courant — retourne le nouveau solde si l'achat passe, ou `null` si
 * le solde ne suffit pas (achat BLOQUÉ, tranché via AskUserQuestion en
 * session). Un prix inconnu (fourchette, texte non numérique, absent du
 * catalogue) n'est jamais bloquant : retourne le solde inchangé, rien n'est
 * déduit. Utilisé uniquement à l'ajout d'une NOUVELLE ligne (arme, armure,
 * objet d'équipement) — modifier une ligne déjà existante n'a aucun effet
 * sur le solde.
 */
function tryPurchase(credits: number, rawPrice: number | string | null | undefined): number | null {
  const price = parseCatalogPrice(rawPrice);
  if (price == null) return credits;
  if (price > credits) return null;
  return credits - price;
}

export function WeaponsArmorPanel({
  character,
  computed,
  editing,
  canEdit,
  update,
  onToggleArmor,
  onToggleWeaponEquipped,
  referenceData,
}: {
  character: Character;
  computed: CharacterComputed;
  editing: boolean;
  canEdit: boolean;
  update: Update;
  onToggleArmor: (index: number) => void;
  onToggleWeaponEquipped: (index: number) => void;
  referenceData: ReferenceData;
}) {
  const { t } = useTranslation();
  const weapons = character.weapons;
  const armor = character.armor;
  const activeArmor = armor.filter((a) => a.active);
  const [expandedWeapon, setExpandedWeapon] = useState<number | null>(null);
  // Message d'achat bloqué (solde insuffisant) — cf. tryPurchase, onPick des
  // armes/armures ci-dessous. Partagé entre les deux colonnes (une seule
  // erreur affichée à la fois suffit, l'achat qui échoue est toujours le
  // dernier tenté).
  const [purchaseError, setPurchaseError] = useState<string | null>(null);

  function setWeaponModifiers(i: number, modifiers: WeaponModifier[]) {
    update({ weapons: weapons.map((x, idx) => (idx === i ? { ...x, modifiers } : x)) });
  }

  const dualWieldPenalty = getDualWieldPenalty(character);

  return (
    <div>
      {/*
        Solde en crédits, visible au moment où le joueur/MJ va justement
        acheter arme/armure (cf. Character.credits, BudgetPanel pour le
        revenu mensuel détaillé) — et message d'achat bloqué le cas échéant
        (cf. tryPurchase).
      */}
      {editing && (
        <p className="mb-3 text-sm text-slate-300">
          💵 {t("Solde")} : <span className="font-semibold text-emerald-300">{character.credits ?? 0}</span> Cr
        </p>
      )}
      {purchaseError && (
        <p className="mb-3 rounded-lg bg-red-950 px-3 py-2 text-xs text-red-300">⚠️ {purchaseError}</p>
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Section title={t("Armes")}>
        {dualWieldPenalty !== 0 && (
          <p className="mb-2 text-xs text-red-400">
            {t("Combat à deux armes sans Ambidextre : -3 au score de chaque arme équipée")}
          </p>
        )}
        <ul className="space-y-2">
          {weapons.map((w, i) => {
            const totals = getWeaponTotals(w, computed.attributeTotals.REF, w.equipped ? dualWieldPenalty : 0);
            const modifiers = w.modifiers ?? [];
            return (
              <li key={i} className="rounded-lg bg-slate-800/50 p-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    {/*
                      Arme en main — même principe que la case "équipée" des
                      armures : seule l'arme équipée compte dans le calcul du
                      Rang d'Action (cf. calc-engine.getActionRank). Visible
                      même hors édition (comme l'armure) pour un changement
                      rapide en séance ; en lecture seule pour qui n'a pas
                      canEdit.
                    */}
                    {canEdit ? (
                      <input
                        type="checkbox"
                        checked={w.equipped ?? false}
                        onChange={() => onToggleWeaponEquipped(i)}
                        title="Arme équipée"
                        aria-label={`${w.name || "Cette arme"} équipée`}
                        className="shrink-0"
                      />
                    ) : (
                      w.equipped && (
                        <span className="shrink-0 text-xs text-emerald-400" title="Arme équipée">
                          ●
                        </span>
                      )
                    )}
                    {editing ? (
                    <CatalogSelect
                      value={w.name}
                      // Exclut les lignes "Amélioration ..." : ce sont les 3 emplacements
                      // fixes (listes!L58:L60) que le classeur d'origine bricolait dans la
                      // formule de l'arme n°1, pas de vraies armes sélectionnables — cf.
                      // investigation du 16/08 et le système de modificateurs justifiés
                      // par équipement, qui les remplace proprement.
                      options={referenceData.weapons
                        .map((wd) => wd.name)
                        .filter((name) => !name.startsWith("Amélioration"))}
                      onPick={(name) => {
                        // Auto-remplit type/dégâts/RA depuis le catalogue (listes!I:R) et le
                        // score de base depuis la compétence liée (Mêlée/Arme de poing/Fusils
                        // — cf. getWeaponSuggestedScore) si le personnage la possède ; sinon
                        // le score reste manuel (armes de jet, compétence absente de la fiche).
                        const def = referenceData.weapons.find((wd) => wd.name === name);
                        const type = (def?.type as WeaponType) ?? w.type;
                        const suggestedScore = getWeaponSuggestedScore(character, computed.attributeTotals, name, type);
                        // Achat : uniquement quand cette ligne n'avait pas encore de nom (arme
                        // vraiment NOUVELLE, cf. "+ Ajouter une arme" plus bas) — changer le
                        // choix d'une arme déjà nommée est une correction, pas un achat. Prix
                        // inconnu au catalogue (fourchette, absent) = pas de déduction. Solde
                        // insuffisant = achat bloqué, la sélection n'est pas appliquée.
                        const isNewPurchase = w.name === "";
                        let nextCredits = character.credits ?? 0;
                        if (isNewPurchase) {
                          const result = tryPurchase(character.credits ?? 0, def?.price);
                          if (result == null) {
                            setPurchaseError(
                              `${t("Solde insuffisant pour")} "${name}" (${parseCatalogPrice(def?.price)} Cr, ${t("solde")} ${character.credits ?? 0} Cr).`,
                            );
                            return;
                          }
                          nextCredits = result;
                          setPurchaseError(null);
                        }
                        update({
                          weapons: weapons.map((x, idx) =>
                            idx === i
                              ? {
                                  ...x,
                                  name,
                                  type,
                                  damage: def?.damage ?? x.damage,
                                  ra: def?.ra ?? x.ra,
                                  baseScore: suggestedScore ?? x.baseScore,
                                }
                              : x,
                          ),
                          ...(isNewPurchase ? { credits: nextCredits } : {}),
                        });
                      }}
                      placeholder={t("— choisir une arme —")}
                      className="flex-1"
                    />
                    ) : (
                      <span className="font-medium text-slate-100">{w.name}</span>
                    )}
                  </div>
                  {editing && (
                    <button
                      onClick={() => update({ weapons: weapons.filter((_, idx) => idx !== i) })}
                      className="text-slate-500 hover:text-red-400"
                    >
                      ×
                    </button>
                  )}
                </div>
                {/* Score/Dmg/RA : en édition on saisit la valeur DE BASE (comme
                    avant) ; en lecture on affiche le TOTAL joué. Score/Dmg =
                    base + somme des modificateurs justifiés ci-dessous ; RA =
                    BASE_RA(5) - Réflexe total + (base + modificateurs), cf.
                    getWeaponTotals. */}
                <div className="mt-1 flex flex-wrap items-center gap-3 text-slate-400">
                  <span>
                    {t("Score")}{" "}
                    {editing ? (
                      <NumberInput
                        value={w.baseScore}
                        onChange={(n) => update({ weapons: weapons.map((x, idx) => (idx === i ? { ...x, baseScore: n } : x)) })}
                      />
                    ) : (
                      <span className="font-semibold text-indigo-300">{totals.baseScore}</span>
                    )}
                  </span>
                  <span>
                    {t("Dmg")}{" "}
                    {editing ? (
                      <NumberInput
                        value={w.damage}
                        onChange={(n) => update({ weapons: weapons.map((x, idx) => (idx === i ? { ...x, damage: n } : x)) })}
                      />
                    ) : (
                      totals.damage
                    )}
                  </span>
                  <span>
                    {t("RA")}{" "}
                    {editing ? (
                      <NumberInput
                        value={w.ra}
                        onChange={(n) => update({ weapons: weapons.map((x, idx) => (idx === i ? { ...x, ra: n } : x)) })}
                      />
                    ) : (
                      totals.ra
                    )}
                  </span>
                  {editing ? (
                    <select
                      value={w.type}
                      onChange={(e) =>
                        update({ weapons: weapons.map((x, idx) => (idx === i ? { ...x, type: e.target.value as WeaponType } : x)) })
                      }
                      className="rounded border border-slate-700 bg-slate-800 px-1 py-0.5 text-xs"
                    >
                      {WEAPON_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span>{w.type}</span>
                  )}
                  {editing && (
                    <button
                      type="button"
                      onClick={() => setExpandedWeapon(expandedWeapon === i ? null : i)}
                      className="text-xs text-indigo-400 hover:underline"
                    >
                      {modifiers.length > 0 ? `${t("Modificateurs")} (${modifiers.length})` : t("+ Modificateur")}
                    </button>
                  )}
                  {!editing && modifiers.length > 0 && (
                    <span
                      className="text-xs text-emerald-400"
                      title={modifiers.map((m) => m.justification || "(sans justification)").join(", ")}
                    >
                      {t("base")} {w.baseScore}/{w.damage}/{w.ra} + {modifiers.length} {t("modif.")}
                    </span>
                  )}
                </div>

                {editing && expandedWeapon === i && (
                  <div className="mt-2 space-y-2 border-t border-slate-700 pt-2">
                    <datalist id={`weapon-mod-equipment-${i}`}>
                      {character.equipment.map((e, ei) => (
                        <option key={ei} value={e.label} />
                      ))}
                    </datalist>
                    {modifiers.map((m, mi) => (
                      <div key={mi} className="flex flex-wrap items-center gap-2 text-xs">
                        <input
                          list={`weapon-mod-equipment-${i}`}
                          type="text"
                          value={m.justification}
                          onChange={(e) =>
                            setWeaponModifiers(
                              i,
                              modifiers.map((x, idx) => (idx === mi ? { ...x, justification: e.target.value } : x)),
                            )
                          }
                          placeholder={t("Justification (ligne d'équipement)")}
                          className="min-w-[160px] flex-1 rounded border border-slate-700 bg-slate-800 px-2 py-1"
                        />
                        <span className="flex items-center gap-1">
                          {t("RA")}
                          <NumberInput
                            value={m.ra ?? 0}
                            onChange={(n) => setWeaponModifiers(i, modifiers.map((x, idx) => (idx === mi ? { ...x, ra: n } : x)))}
                            className="w-12"
                          />
                        </span>
                        <span className="flex items-center gap-1">
                          {t("Dmg")}
                          <NumberInput
                            value={m.damage ?? 0}
                            onChange={(n) => setWeaponModifiers(i, modifiers.map((x, idx) => (idx === mi ? { ...x, damage: n } : x)))}
                            className="w-12"
                          />
                        </span>
                        <span className="flex items-center gap-1">
                          {t("Score")}
                          <NumberInput
                            value={m.score ?? 0}
                            onChange={(n) => setWeaponModifiers(i, modifiers.map((x, idx) => (idx === mi ? { ...x, score: n } : x)))}
                            className="w-12"
                          />
                        </span>
                        <button
                          type="button"
                          onClick={() => setWeaponModifiers(i, modifiers.filter((_, idx) => idx !== mi))}
                          className="text-slate-500 hover:text-red-400"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() =>
                        setWeaponModifiers(i, [...modifiers, { justification: "", ra: 0, damage: 0, score: 0 }])
                      }
                      className="text-xs text-indigo-400 hover:underline"
                    >
                      {t("+ Ajouter un modificateur")}
                    </button>
                    <p className="text-xs text-slate-500">
                      {t("Total joué")} : {t("Score")} {totals.baseScore} · {t("Dmg")} {totals.damage} · {t("RA")} {totals.ra}
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {editing && (
          <button
            onClick={() => update({ weapons: [...weapons, { name: "", type: "Fire", damage: 0, ra: 0, baseScore: 0 }] })}
            className="mt-2 text-sm text-indigo-400 hover:underline"
          >
            {t("+ Ajouter une arme")}
          </button>
        )}
      </Section>

      <Section title={t("Armures")}>
        {/*
          Silhouette d'armure (VP par membre) et silhouette de localisation
          (table de touches d10, générique — remplace l'ancienne section
          texte "Localisations" en fin de fiche) côte à côte, pour associer
          d'un coup d'œil "combien de VP ici" et "quel jet touche ici".
        */}
        <div className="mb-3 flex justify-center gap-4">
          <RaceArmorSilhouette race={character.race} armorTotals={computed.armorTotals} size={110} />
          <LocalisationSilhouette size={110} />
        </div>

        {!editing && canEdit && (
          <ul className="space-y-1 text-sm text-slate-300">
            {armor.length === 0 && <li className="text-slate-500">{t("Aucune armure sur la fiche")}</li>}
            {armor.map((a, i) => (
              <li key={i} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={a.active}
                  onChange={() => onToggleArmor(i)}
                  aria-label={`${a.name} équipée`}
                />
                <span className={a.active ? "" : "text-slate-500 line-through"}>{a.name}</span>
              </li>
            ))}
          </ul>
        )}

        {!editing && !canEdit && (
          <ul className="space-y-1 text-sm text-slate-300">
            {activeArmor.length === 0 && <li className="text-slate-500">{t("Aucune armure équipée")}</li>}
            {activeArmor.map((a, i) => (
              <li key={i}>{a.name}</li>
            ))}
          </ul>
        )}

        {editing && (
          <ul className="space-y-2">
            {armor.map((a, i) => (
              <li key={i} className="rounded-lg bg-slate-800/50 p-2 text-sm">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={a.active}
                    onChange={(e) => update({ armor: armor.map((x, idx) => (idx === i ? { ...x, active: e.target.checked } : x)) })}
                    aria-label={`${a.name} équipée`}
                  />
                  <CatalogSelect
                    value={a.name}
                    options={referenceData.armor.map((ad) => ad.name)}
                    onPick={(name) => {
                      // Auto-remplit les VP tête/bras/torse/jambes depuis le
                      // catalogue (listes!T:AD) — restent éditables si le
                      // joueur veut surcharger (ex. armure améliorée).
                      const def = referenceData.armor.find((ad) => ad.name === name);
                      // Achat : même logique que pour les armes (cf. onPick
                      // ci-dessus) — uniquement pour une armure vraiment
                      // NOUVELLE (nom encore vide), prix inconnu = pas de
                      // déduction, solde insuffisant = achat bloqué.
                      const isNewPurchase = a.name === "";
                      let nextCredits = character.credits ?? 0;
                      if (isNewPurchase) {
                        const result = tryPurchase(character.credits ?? 0, def?.price);
                        if (result == null) {
                          setPurchaseError(
                            `${t("Solde insuffisant pour")} "${name}" (${parseCatalogPrice(def?.price)} Cr, ${t("solde")} ${character.credits ?? 0} Cr).`,
                          );
                          return;
                        }
                        nextCredits = result;
                        setPurchaseError(null);
                      }
                      update({
                        armor: armor.map((x, idx) =>
                          idx === i
                            ? {
                                ...x,
                                name,
                                vpTete: def?.vpTete ?? x.vpTete,
                                vpBras: def?.vpBras ?? x.vpBras,
                                vpTorse: def?.vpTorse ?? x.vpTorse,
                                vpJambes: def?.vpJambes ?? x.vpJambes,
                              }
                            : x,
                        ),
                        ...(isNewPurchase ? { credits: nextCredits } : {}),
                      });
                    }}
                    placeholder={t("— choisir une armure —")}
                    className="flex-1"
                  />
                  <button
                    onClick={() => update({ armor: armor.filter((_, idx) => idx !== i) })}
                    className="text-slate-500 hover:text-red-400"
                  >
                    ×
                  </button>
                </div>
                <div className="mt-1 flex flex-wrap gap-3 text-slate-400">
                  <span>
                    {t("Tête")} <NumberInput value={a.vpTete} onChange={(n) => update({ armor: armor.map((x, idx) => (idx === i ? { ...x, vpTete: n } : x)) })} />
                  </span>
                  <span>
                    {t("Bras")} <NumberInput value={a.vpBras} onChange={(n) => update({ armor: armor.map((x, idx) => (idx === i ? { ...x, vpBras: n } : x)) })} />
                  </span>
                  <span>
                    {t("Torse")} <NumberInput value={a.vpTorse} onChange={(n) => update({ armor: armor.map((x, idx) => (idx === i ? { ...x, vpTorse: n } : x)) })} />
                  </span>
                  <span>
                    {t("Jambes")} <NumberInput value={a.vpJambes} onChange={(n) => update({ armor: armor.map((x, idx) => (idx === i ? { ...x, vpJambes: n } : x)) })} />
                  </span>
                </div>
              </li>
            ))}
            <button
              onClick={() => update({ armor: [...armor, { name: "", vpTete: 0, vpBras: 0, vpTorse: 0, vpJambes: 0, active: true }] })}
              className="text-sm text-indigo-400 hover:underline"
            >
              {t("+ Ajouter une armure")}
            </button>
          </ul>
        )}
      </Section>
      </div>
    </div>
  );
}

/** Datalist partagée (id global) pour l'autocomplétion du nom de compétence boostée — cf. PsyPowersPanel. */
const PSY_BOOST_SKILL_DATALIST_ID = "psy-boost-skill-source";

/**
 * Active/désactive un pouvoir "à la demande" (bouton dédié, réservé au
 * joueur propriétaire ou au MJ — canEdit) : choix d'un palier, coût en PSP
 * affiché par palier (cf. calc-engine.getPsyPowerActivationCost —
 * décompté/remboursé côté CharacterSheet.setActivePower). Le jet de dé
 * (1-10) s'ajoute AU score total du pouvoir (score + Volonté + Affinité,
 * cf. PsyPowersPanel) — pas au palier — et c'est ce résultat qui détermine
 * la réussite : l'effet de tout palier ≤ au résultat devient accessible.
 * Aucun calcul de jet côté app (se joue à table) ; le palier choisi ici
 * sert seulement à fixer le coût en PSP et l'effet de l'activation.
 * "Concentration psy" a un effet chiffré codé (cf.
 * calc-engine.getConcentrationPsyAttributeBonus) qui module une ou
 * plusieurs caractéristiques physiques (REF/DEX/VIT) selon le palier :
 * choix obligatoire d'UNE caractéristique aux paliers 15/20 (sélecteur
 * dédié, toujours visible à ces paliers) ; à partir du palier 25, les TROIS
 * sont boostées automatiquement, sans choix (simple repère informatif). Pour
 * tout autre pouvoir, un "effet" optionnel peut être choisi à l'activation —
 * caractéristique ET/OU compétence boostée, valeur du bonus, et durée
 * indicative (un tour / combat) — puisque leur formule n'est pas codée dans
 * ce moteur (cf. ActivePsyPower.boostAttribute/boostSkillName/boostAmount),
 * replié derrière "+ Effet (optionnel)" pour rester discret quand inutilisé.
 * Sauvegarde immédiate via `onChange`, comme le reste des toggles hors mode
 * édition (armure, arme équipée) — pas besoin d'ouvrir la fiche en édition
 * pour ça, c'est une action de jeu, pas une modification de la fiche
 * elle-même.
 */
function PsyPowerActivation({
  powerName,
  active,
  onChange,
}: {
  powerName: string;
  active: ActivePsyPower | undefined;
  onChange: (next: ActivePsyPower | null) => void;
}) {
  const { t } = useTranslation();
  const isConcentrationPsy = powerName === CONCENTRATION_PSY_NAME;
  // Tous les paliers restent sélectionnables — le palier fixe le coût en
  // PSP et l'effet de l'activation, pas un seuil que l'app validerait
  // elle-même (le jet + score, comparés au palier, se jouent à table). Pour
  // "Concentration psy" spécifiquement, palier par
  // défaut 15 (pas le plus bas palier générique, 10) : c'est le premier
  // palier qui a un effet chiffré pour ce pouvoir (cf.
  // calc-engine.getConcentrationPsyAttributeBonus) — au palier 10 il n'y a
  // ni sélecteur de caractéristique ni note, sans indice pour l'utilisateur
  // qu'il faut changer le palier pour en voir un (signalé sur la fiche de
  // Karun : le sélecteur semblait absent alors qu'il fallait juste changer
  // de palier).
  const [level, setLevel] = useState(active?.level ?? (isConcentrationPsy ? 15 : PSY_POWER_LEVELS[0]));
  const [attribute, setAttribute] = useState<Attribute>(active?.attribute ?? "REF");
  const [boostAttribute, setBoostAttribute] = useState<Attribute | "">(active?.boostAttribute ?? "");
  const [boostSkillName, setBoostSkillName] = useState(active?.boostSkillName ?? "");
  const [boostAmount, setBoostAmount] = useState(active?.boostAmount ?? 0);
  const [duration, setDuration] = useState<"turn" | "combat">(active?.duration ?? "turn");
  // Repliée par défaut — n'apparaît qu'au clic sur "+ Effet (optionnel)",
  // pour garder la ligne d'activation courte quand ce pouvoir n'a rien à
  // configurer (cf. même principe que les justifications de compétence).
  const [showEffect, setShowEffect] = useState(false);

  const needsAttribute = isConcentrationPsy && (level === 15 || level === 20);
  const isAllPhysicalAttributes = isConcentrationPsy && level >= 25;

  if (active) {
    const cost = getPsyPowerActivationCost(active.level);
    return (
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-emerald-600/20 px-2 py-0.5 text-emerald-300">
          {t("Actif · niveau")} {active.level} ({cost} PSP)
          {active.attribute ? ` · ${active.attribute}` : ""}
          {isConcentrationPsy && active.level >= 25 ? ` · ${CONCENTRATION_PSY_ATTRIBUTES.join("/")}` : ""}
          {active.boostAttribute ? ` · +${active.boostAmount ?? 0} ${active.boostAttribute}` : ""}
          {active.boostSkillName ? ` · +${active.boostAmount ?? 0} ${active.boostSkillName}` : ""}
          {active.duration ? ` · ${active.duration === "combat" ? t("le combat") : t("un tour")}` : ""}
        </span>
        <button type="button" onClick={() => onChange(null)} className="text-slate-500 hover:text-red-400">
          {t("Désactiver")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={level}
          onChange={(e) => setLevel(Number(e.target.value))}
          className="rounded border border-slate-700 bg-slate-800 px-1 py-0.5"
        >
          {PSY_POWER_LEVELS.map((lvl) => {
            const cost = getPsyPowerActivationCost(lvl);
            return (
              <option key={lvl} value={lvl}>
                {t("Niveau")} {lvl} ({cost === 0 ? t("gratuit") : `${cost} PSP`})
              </option>
            );
          })}
        </select>
        {needsAttribute && (
          <span className="flex items-center gap-1">
            <span className="text-slate-400">{t("Caractéristique boostée")} :</span>
            <select
              value={attribute}
              onChange={(e) => setAttribute(e.target.value as Attribute)}
              className="rounded border border-slate-700 bg-slate-800 px-1 py-0.5"
            >
              {CONCENTRATION_PSY_ATTRIBUTES.map((attr) => (
                <option key={attr} value={attr}>
                  {attr}
                </option>
              ))}
            </select>
          </span>
        )}
        {isAllPhysicalAttributes && (
          <span className="text-slate-400">
            {t("Toutes les caractéristiques physiques")} ({CONCENTRATION_PSY_ATTRIBUTES.join("/")})
          </span>
        )}
        {isConcentrationPsy && level === 10 && (
          <span className="text-slate-500">{t("Aucun effet chiffré à ce palier — choisir 15 ou plus")}</span>
        )}
        <button
          type="button"
          onClick={() =>
            onChange({
              name: powerName,
              level,
              attribute: needsAttribute ? attribute : undefined,
              boostAttribute: !isConcentrationPsy && boostAttribute ? boostAttribute : undefined,
              boostSkillName: !isConcentrationPsy && boostSkillName.trim() ? boostSkillName.trim() : undefined,
              boostAmount:
                !isConcentrationPsy && (boostAttribute || boostSkillName.trim()) && boostAmount !== 0
                  ? boostAmount
                  : undefined,
              duration: !isConcentrationPsy && (boostAttribute || boostSkillName.trim()) ? duration : undefined,
            })
          }
          className="rounded bg-indigo-600 px-2 py-0.5 font-medium text-white hover:bg-indigo-500"
        >
          {t("Activer")}
        </button>
        {!isConcentrationPsy && (
          <button type="button" onClick={() => setShowEffect((v) => !v)} className="text-indigo-400 hover:underline">
            {boostAttribute || boostSkillName.trim()
              ? `${t("Effet")} : +${boostAmount} ${boostAttribute || boostSkillName}`
              : t("+ Effet (optionnel)")}
          </button>
        )}
      </div>
      {!isConcentrationPsy && showEffect && (
        <div className="flex flex-wrap items-center gap-1.5 text-slate-400">
          <span>{t("Effet (optionnel)")} :</span>
          <select
            value={boostAttribute}
            onChange={(e) => setBoostAttribute((e.target.value || "") as Attribute | "")}
            className="rounded border border-slate-700 bg-slate-800 px-1 py-0.5"
          >
            <option value="">{t("— caractéristique —")}</option>
            {ATTRIBUTES.map((attr) => (
              <option key={attr} value={attr}>
                {attr}
              </option>
            ))}
          </select>
          <input
            list={PSY_BOOST_SKILL_DATALIST_ID}
            type="text"
            value={boostSkillName}
            onChange={(e) => setBoostSkillName(e.target.value)}
            placeholder={t("ou compétence")}
            className="w-32 rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5"
          />
          <NumberInput value={boostAmount} onChange={setBoostAmount} className="w-12" />
          <select
            value={duration}
            onChange={(e) => setDuration(e.target.value as "turn" | "combat")}
            className="rounded border border-slate-700 bg-slate-800 px-1 py-0.5"
          >
            <option value="turn">{t("Un tour")}</option>
            <option value="combat">{t("Le combat")}</option>
          </select>
        </div>
      )}
    </div>
  );
}

const CONCENTRATION_PSY_NAME = "Concentration psy";

export function PsyPowersPanel({
  character,
  computed,
  editing,
  canEdit,
  update,
  onSetActivePower,
  referenceData,
}: {
  character: Character;
  computed: CharacterComputed;
  editing: boolean;
  canEdit: boolean;
  update: Update;
  onSetActivePower: (powerName: string, next: ActivePsyPower | null) => void;
  referenceData: ReferenceData;
}) {
  const { t } = useTranslation();
  const powers = character.psyPowers;
  const activePowers = character.activePsyPowers ?? [];
  if (powers.length === 0 && !editing) return null;
  return (
    <Section title={t("Pouvoirs Psy")}>
      {!editing && canEdit && (
        <datalist id={PSY_BOOST_SKILL_DATALIST_ID}>
          {character.skills.map((s, si) => (
            <option key={si} value={s.name} />
          ))}
        </datalist>
      )}
      <ul className="space-y-1">
        {powers.map((p, i) => {
          const total = getPsyPowerTotal(p, character, computed.attributeTotals);
          const affinityBonus = getPowerAffinityBonus(character, p);
          const active = activePowers.find((ap) => ap.name === p.name);
          return (
            <li key={i} className="space-y-1 text-sm">
              <div className="flex items-center justify-between gap-2">
                {editing ? (
                  <CatalogSelect
                    value={p.name}
                    options={referenceData.psyPowers.map((pd) => pd.name)}
                    onPick={(name) => {
                      const def = referenceData.psyPowers.find((pd) => pd.name === name);
                      update({
                        psyPowers: powers.map((x, idx) =>
                          idx === i ? { ...x, name, discipline: def?.discipline ?? x.discipline } : x,
                        ),
                      });
                    }}
                    placeholder={t("— choisir un pouvoir —")}
                    className="flex-1"
                  />
                ) : (
                  <span
                    className="text-slate-200"
                    title={referenceData.psyPowers.find((pd) => pd.name === p.name)?.description}
                  >
                    {p.name} <span className="text-slate-500">({p.discipline})</span>
                  </span>
                )}
                <div className="flex items-center gap-3">
                  {editing ? (
                    <NumberInput
                      value={p.score}
                      onChange={(n) => update({ psyPowers: powers.map((x, idx) => (idx === i ? { ...x, score: n } : x)) })}
                    />
                  ) : (
                    <span className="text-slate-300">{p.score}</span>
                  )}
                  <span className="w-8 text-right text-xs text-slate-500" title="Score + Volonté + Affinité">
                    Σ
                  </span>
                  <span className="flex w-14 items-center justify-end gap-1 text-right">
                    <span className="font-semibold tabular-nums text-indigo-300">{total}</span>
                    {affinityBonus !== 0 && (
                      <span
                        className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-amber-300"
                        title={t("Bonus d'affinité")}
                      >
                        {affinityBonus > 0 ? "+" : ""}
                        {affinityBonus}
                      </span>
                    )}
                  </span>
                </div>
              </div>
              {!editing && canEdit && p.name && (
                <PsyPowerActivation powerName={p.name} active={active} onChange={(next) => onSetActivePower(p.name, next)} />
              )}
            </li>
          );
        })}
      </ul>
      {editing && (
        <button
          onClick={() => update({ psyPowers: [...powers, { name: "", score: 0, discipline: "" }] })}
          className="mt-2 text-sm text-indigo-400 hover:underline"
        >
          {t("+ Ajouter un pouvoir")}
        </button>
      )}
    </Section>
  );
}

export function AdvantagesPanel({
  character,
  editing,
  update,
  referenceData,
}: {
  character: Character;
  editing: boolean;
  update: Update;
  referenceData: ReferenceData;
}) {
  const { t } = useTranslation();
  const advantages = character.advantages;
  return (
    <Section title={t("Avantages et inconvénients")}>
      <ul className="space-y-1">
        {advantages.map((a, i) => (
          <li key={i} className="flex items-center justify-between gap-2 text-sm">
            {editing ? (
              <CatalogSelect
                value={a.label}
                options={referenceData.advantages.map((ad) => ad.label)}
                onPick={(label) => {
                  // La valeur (points) vient toujours du catalogue par
                  // libellé, jamais saisie à la main — c'est ce qui a
                  // corrigé le bug "Dans les nuages" à l'import (cf.
                  // calc-engine.ts) ; laisser la même règle ici évite de
                  // le réintroduire.
                  const def = referenceData.advantages.find((ad) => ad.label === label);
                  update({
                    advantages: advantages.map((x, idx) => (idx === i ? { label, value: def?.value ?? 0 } : x)),
                  });
                }}
                placeholder={t("— choisir —")}
                className="flex-1"
              />
            ) : (
              <span className="text-slate-200" title={referenceData.advantages.find((ad) => ad.label === a.label)?.description}>
                {a.label}
              </span>
            )}
            <span className={a.value >= 0 ? "text-emerald-400" : "text-red-400"}>
              {a.value >= 0 ? "+" : ""}
              {a.value}
            </span>
            {editing && (
              <button
                onClick={() => update({ advantages: advantages.filter((_, idx) => idx !== i) })}
                className="text-slate-500 hover:text-red-400"
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
      {editing && (
        <button
          onClick={() => update({ advantages: [...advantages, { label: "", value: 0 }] })}
          className="mt-2 text-sm text-indigo-400 hover:underline"
        >
          {t("+ Ajouter un avantage/inconvénient")}
        </button>
      )}
    </Section>
  );
}

export function EquipmentPanel({
  character,
  editing,
  update,
  referenceData,
}: {
  character: Character;
  editing: boolean;
  update: Update;
  referenceData: ReferenceData;
}) {
  const { t } = useTranslation();
  const equipment = character.equipment;
  // Catalogue "Équipement & cyber" de la règle, groupé par rubrique pour le
  // sélecteur d'achat ci-dessous (choisir une ligne pré-remplit nom + prix,
  // l'achat lui-même passe par le même `handleAdd` que la saisie libre).
  const catalogByCategory = referenceData.equipment.reduce<Record<string, typeof referenceData.equipment>>((acc, item) => {
    (acc[item.category] ??= []).push(item);
    return acc;
  }, {});
  // Mini-formulaire d'achat (nom + prix) plutôt que l'ancien ajout instantané
  // d'une ligne vide : l'AJOUT d'un objet est le seul moment où le prix est
  // déduit du solde (cf. WeaponsArmorPanel.tryPurchase, même principe) —
  // modifier le libellé/prix d'une ligne déjà existante n'a jamais d'effet
  // sur le solde. Un prix laissé vide/à 0 ajoute l'objet sans rien déduire
  // (comportement identique à avant l'ajout de ce champ).
  const [newLabel, setNewLabel] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [purchaseError, setPurchaseError] = useState<string | null>(null);

  function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const label = newLabel.trim();
    if (!label) return;
    const credits = character.credits ?? 0;
    const price = newPrice.trim() === "" ? undefined : Number(newPrice);
    if (price != null && Number.isFinite(price) && price > 0) {
      if (price > credits) {
        setPurchaseError(`${t("Solde insuffisant pour")} "${label}" (${price} Cr, ${t("solde")} ${credits} Cr).`);
        return;
      }
      update({ equipment: [...equipment, { label, price }], credits: credits - price });
    } else {
      update({ equipment: [...equipment, { label }] });
    }
    setPurchaseError(null);
    setNewLabel("");
    setNewPrice("");
  }

  return (
    <Section title={t("Équipement")}>
      <ul className="list-inside list-disc space-y-1 text-sm text-slate-200">
        {equipment.map((e, i) => (
          <li key={i} className="flex items-center gap-2">
            {editing ? (
              <>
                <TextInput
                  value={e.label}
                  onChange={(v) => update({ equipment: equipment.map((x, idx) => (idx === i ? { ...x, label: v } : x)) })}
                  className="flex-1"
                />
                <NumberInput
                  value={e.price ?? 0}
                  onChange={(n) =>
                    update({ equipment: equipment.map((x, idx) => (idx === i ? { ...x, price: n || undefined } : x)) })
                  }
                  className="w-20"
                />
                <span className="text-xs text-slate-500">Cr</span>
                <button
                  onClick={() => update({ equipment: equipment.filter((_, idx) => idx !== i) })}
                  className="text-slate-500 hover:text-red-400"
                >
                  ×
                </button>
              </>
            ) : (
              <span>
                {e.label}
                {e.price != null && <span className="text-slate-500"> ({e.price} Cr)</span>}
              </span>
            )}
          </li>
        ))}
      </ul>
      {editing && (
        <>
          {purchaseError && (
            <p className="mt-2 rounded-lg bg-red-950 px-3 py-2 text-xs text-red-300">⚠️ {purchaseError}</p>
          )}
          {referenceData.equipment.length > 0 && (
            <select
              value=""
              onChange={(e) => {
                const item = referenceData.equipment.find((x) => x.name === e.target.value);
                if (!item) return;
                setNewLabel(item.name);
                const price = parseCatalogPrice(item.price);
                setNewPrice(price != null ? String(price) : "");
                setPurchaseError(null);
              }}
              className="mt-2 w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm"
            >
              <option value="">{t("— depuis le catalogue Équipement & cyber —")}</option>
              {Object.entries(catalogByCategory).map(([category, items]) => (
                <optgroup key={category} label={category}>
                  {items.map((item) => (
                    <option key={`${category}-${item.name}`} value={item.name}>
                      {item.name}
                      {parseCatalogPrice(item.price) != null ? ` — ${parseCatalogPrice(item.price)} Cr` : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          )}
          <form onSubmit={handleAdd} className="mt-2 flex flex-wrap items-center gap-2">
            <TextInput value={newLabel} onChange={setNewLabel} placeholder={t("Nom de l'objet")} className="flex-1" />
            <NumberInput value={newPrice === "" ? 0 : Number(newPrice)} onChange={(n) => setNewPrice(n ? String(n) : "")} className="w-20" />
            <span className="text-xs text-slate-500">Cr</span>
            <button
              type="submit"
              disabled={!newLabel.trim()}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {t("+ Ajouter un objet")}
            </button>
          </form>
        </>
      )}
    </Section>
  );
}

/**
 * `isGm` : distribution d'XP réservée au MJ (jamais au joueur propriétaire,
 * même si celui-ci a `canEdit`) — cf. POST /api/characters/:id/xp,
 * routes/characters.ts. `onGrantXp` absent = pas encore câblé côté parent
 * (ne devrait pas arriver si `isGm` est vrai).
 */
export function BudgetPanel({
  character,
  computed,
  isGm,
  onGrantXp,
  onGrantCredits,
  onAcceptDeficit,
}: {
  character: Pick<Character, "pointsDepart" | "xp" | "xpAvailable" | "credits" | "advantages">;
  computed: CharacterComputed;
  isGm?: boolean;
  onGrantXp?: (amount: number) => void | Promise<void>;
  /**
   * Ajustement de crédits (Cr) réservé au MJ — cf. POST
   * /api/characters/:id/credits. Un montant en Cr directement, PAS un
   * nombre de mois (ça, c'est le bouton groupé "+(X) mois" du Suivi des
   * constantes, sans équivalent ici) : cf. corrigé en session suite au
   * signalement que le bouton "+Cr" par tuile ne permettait pas de saisir
   * le montant voulu (redirection accidentelle vers la fiche) — ce
   * contrôle sur la fiche elle-même en est le repli fiable.
   */
  onGrantCredits?: (amount: number) => void | Promise<void>;
  /** Absorbe le solde négatif dans les points de départ — réservé au MJ, cf. CharacterSheet.tsx handleAcceptDeficit. */
  onAcceptDeficit?: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const { budget } = computed;
  const [xpAmount, setXpAmount] = useState("");
  const [xpBusy, setXpBusy] = useState(false);
  const [creditsAmount, setCreditsAmount] = useState("");
  const [creditsBusy, setCreditsBusy] = useState(false);
  const [deficitBusy, setDeficitBusy] = useState(false);

  async function handleAcceptDeficit() {
    if (!onAcceptDeficit) return;
    setDeficitBusy(true);
    try {
      await onAcceptDeficit();
    } finally {
      setDeficitBusy(false);
    }
  }
  // Coût net réellement consommé sur le total dispo (compétences + pouvoirs
  // psy + avantages) — équivalent à `totalDispo - solde`, affiché comme un
  // seul chiffre en plus du détail par poste ci-dessous.
  const xpUsed = budget.totalDispo - budget.solde;

  async function handleGrant() {
    const amount = Number(xpAmount);
    if (!onGrantXp || !amount || !Number.isFinite(amount)) return;
    setXpBusy(true);
    try {
      await onGrantXp(amount);
      setXpAmount("");
    } finally {
      setXpBusy(false);
    }
  }

  async function handleGrantCredits() {
    const amount = Number(creditsAmount);
    if (!onGrantCredits || !amount || !Number.isFinite(amount)) return;
    setCreditsBusy(true);
    try {
      await onGrantCredits(amount);
      setCreditsAmount("");
    } finally {
      setCreditsBusy(false);
    }
  }

  return (
    <Section title="Budget de points">
      {/*
        Deux groupes : ce qui alimente le total dispo (points raciaux +
        points de départ + XP gagnée = Total), puis ce qui en est consommé
        (coûts + solde). "XP gagnée" (character.xp) est un total net
        ("depuis la création") qui contribue au total dispo ; "XP
        disponible" (character.xpAvailable) suit à part ce qui reste à
        dépenser — diminue quand le coût de la fiche augmente (compétence/
        pouvoir psy monté, avantage ajouté) ou qu'un retrait est décidé par
        le MJ, augmente symétriquement sinon (cf. PUT et POST
        /api/characters/:id/xp) — et ne compte PAS dans le total dispo.
      */}
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("Total dispo")}</p>
      <dl className="mb-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
        <Metric label={t("Points raciaux")} value={budget.raceSkillPoints} />
        <Metric label={t("Points de départ")} value={character.pointsDepart} />
        <Metric label={t("XP gagnée (depuis la création)")} value={character.xp} />
        <Metric label={t("XP disponible")} value={character.xpAvailable} />
        <Metric label={t("Total")} value={budget.totalDispo} emphasis />
      </dl>
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("Dépenses")}</p>
      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
        <Metric label={t("Coût compétences")} value={-budget.skillsCost} />
        <Metric label={t("Coût pouvoirs psy")} value={-budget.psyPowersCost} />
        <Metric label={t("Net avantages")} value={budget.advantagesNet} />
        <Metric label={t("XP utilisée")} value={xpUsed} />
        <Metric label={t("Solde")} value={budget.solde} emphasis />
      </dl>
      {budget.solde < 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-red-950 px-3 py-2 text-sm text-red-300">
          <span>
            ⚠️ {t("Solde négatif : ce personnage dépasse son budget de points de")} {Math.abs(budget.solde)}.
          </span>
          {isGm && onAcceptDeficit && (
            <button
              type="button"
              onClick={handleAcceptDeficit}
              disabled={deficitBusy}
              title="Ajoute le déficit aux points de départ pour ramener le solde à 0"
              className="shrink-0 rounded-lg bg-red-800 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {deficitBusy ? "…" : t("Accepter")}
            </button>
          )}
        </div>
      )}
      {/*
        Crédits (Cr, monnaie du jeu) — distinct du budget de points ci-dessus.
        Solde alimenté par le bouton MJ "+(X) mois 💵" (écran "Suivi des
        constantes", pas ici : cf. GmTracker.tsx) et diminué automatiquement
        à l'achat d'une nouvelle arme/armure/ligne d'équipement (cf.
        WeaponsArmorPanel/EquipmentPanel). Revenu mensuel affiché en info
        seule, pour transparence sur "ce que ce personnage devrait recevoir".
      */}
      <div className="mt-3 border-t border-slate-800 pt-3">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("Crédits")}</p>
        <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
          <Metric label={t("Solde")} value={character.credits ?? 0} emphasis />
          <Metric label={t("Revenu mensuel")} value={getMonthlyIncome(character)} />
        </dl>
        {isGm && onGrantCredits && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="text-sm text-slate-400">{t("Donner des crédits")}</label>
            <input
              type="number"
              value={creditsAmount}
              onChange={(e) => setCreditsAmount(e.target.value)}
              placeholder="ex. 500 ou -200"
              className="w-28 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm"
            />
            <span className="text-xs text-slate-500">Cr</span>
            <button
              type="button"
              onClick={handleGrantCredits}
              disabled={creditsBusy || !creditsAmount}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {creditsBusy ? "…" : t("Valider")}
            </button>
          </div>
        )}
      </div>
      {isGm && onGrantXp && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-3">
          <label className="text-sm text-slate-400">{t("Donner de l'XP")}</label>
          <input
            type="number"
            value={xpAmount}
            onChange={(e) => setXpAmount(e.target.value)}
            placeholder="ex. 5 ou -3"
            className="w-24 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm"
          />
          <button
            type="button"
            onClick={handleGrant}
            disabled={xpBusy || !xpAmount}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {xpBusy ? "…" : t("Valider")}
          </button>
        </div>
      )}
    </Section>
  );
}

function Metric({ label, value, emphasis }: { label: string; value: number; emphasis?: boolean }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className={emphasis ? `text-lg font-semibold ${value < 0 ? "text-red-400" : "text-emerald-400"}` : "text-slate-200"}>
        {value}
      </dd>
    </div>
  );
}

// LocalisationsPanel (section texte "Localisations" en fin de fiche) a été
// remplacé par LocalisationSilhouette, affichée à côté de la silhouette
// d'armure dans WeaponsArmorPanel ci-dessus — plus lisible d'un coup d'œil
// en jeu, cf. RaceArmorSilhouette.tsx.
