// Page "Documentation" d'un groupe — accessible depuis l'écran
// "Personnages" (CharacterList.tsx, l'écran d'accueil "du jeu" une fois un
// groupe choisi). Deux volets : le guide générique d'utilisation de la
// plateforme (platform-guide.ts, bilingue, sections communes + spécifiques
// au rôle joueur/MJ) et les règles du jeu effectivement utilisées par ce
// groupe (ReferenceData de sa règle, via GET /api/groups/:id/reference —
// ouvert à tout membre approuvé, pas seulement au MJ). Le contenu du
// catalogue reste dans sa langue source (français, celle des règles
// importées) — seul le chrome de la page (titres, libellés) suit la langue
// choisie sur le profil, via useTranslation().

import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { ReferenceData } from "@shared/types";
import { useAuth } from "../lib/auth-context";
import { api } from "../lib/api";
import { useTranslation } from "../lib/i18n";
import { getPlatformGuide, type GuideSection } from "../lib/platform-guide";

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : "Erreur";
}

/** Section de guide en <details> natif — replié par défaut pour les catalogues volumineux, ouvert par défaut pour le guide (peu de sections, on veut qu'elles soient visibles d'emblée). */
function DocSection({ title, defaultOpen = true, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  return (
    <details open={defaultOpen} className="rounded-xl bg-slate-900 p-4 shadow">
      <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-slate-300 hover:text-slate-100">
        {title}
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}

function GuideSectionBlock({ section }: { section: GuideSection }) {
  return (
    <div className="space-y-1.5">
      <h3 className="text-sm font-medium text-indigo-300">{section.title}</h3>
      {section.paragraphs.map((p, i) => (
        <p key={i} className="text-sm leading-relaxed text-slate-300">
          {p}
        </p>
      ))}
    </div>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max text-left text-sm">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-slate-500">
            {headers.map((h, i) => (
              <th key={i} className="px-2 py-1 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-t border-slate-800">
              {row.map((cell, ci) => (
                <td key={ci} className="px-2 py-1.5 text-slate-300">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RulesetReference({ referenceData, t }: { referenceData: ReferenceData; t: (s: string) => string }) {
  return (
    <div className="space-y-3">
      <DocSection title={t("Races")} defaultOpen={false}>
        <Table
          headers={[t("Race"), t("Bonus par attribut"), t("Bonus de taille"), t("Points raciaux")]}
          rows={referenceData.races.map((r) => [
            r.label,
            Object.entries(r.attributeBonus)
              .filter(([, v]) => v !== 0)
              .map(([a, v]) => `${v >= 0 ? "+" : ""}${v} ${a}`)
              .join(", ") || "—",
            r.tailleBonus,
            r.skillPoints,
          ])}
        />
      </DocSection>

      <DocSection title={t("Compétences")} defaultOpen={false}>
        <Table
          headers={[t("Compétence"), t("Attribut"), t("Description")]}
          rows={referenceData.skills.map((s) => [s.name, s.attribute ?? "—", s.description ?? "—"])}
        />
      </DocSection>

      <DocSection title={t("Armes")} defaultOpen={false}>
        <Table
          headers={["Arme", "Type", t("Dmg"), t("RA"), "Prix"]}
          rows={referenceData.weapons.map((w) => [w.name, w.type ?? "—", w.damage ?? "—", w.ra ?? "—", w.price ?? "—"])}
        />
      </DocSection>

      <DocSection title={t("Armures")} defaultOpen={false}>
        <Table
          headers={["Armure", t("Tête"), t("Bras"), t("Torse"), t("Jambes"), "Prix"]}
          rows={referenceData.armor.map((a) => [a.name, a.vpTete, a.vpBras, a.vpTorse, a.vpJambes, a.price ?? "—"])}
        />
      </DocSection>

      {referenceData.equipment.length > 0 && (
        <DocSection title={t("Équipement & cyber")} defaultOpen={false}>
          <Table
            headers={[t("Catégorie"), t("Nom de l'objet"), t("Essence"), "Prix", t("Description")]}
            rows={[...referenceData.equipment]
              .sort((a, b) => a.category.localeCompare(b.category, "fr"))
              .map((e) => [e.category, e.name, e.essence ?? "—", e.price ?? "—", e.description ?? "—"])}
          />
        </DocSection>
      )}

      <DocSection title={t("Pouvoirs Psy")} defaultOpen={false}>
        <Table
          headers={[t("Pouvoirs Psy"), "Discipline", t("Description")]}
          rows={referenceData.psyPowers.map((p) => [p.name, p.discipline, p.description ?? "—"])}
        />
      </DocSection>

      <DocSection title={t("Avantages et inconvénients")} defaultOpen={false}>
        <Table
          headers={[t("Avantages et inconvénients"), t("Score"), t("Description")]}
          rows={referenceData.advantages.map((a) => [a.label, a.value, a.description ?? "—"])}
        />
      </DocSection>

      <DocSection title={t("Coût compétences")} defaultOpen={false}>
        <Table
          headers={[t("Score"), t("Coût compétences")]}
          rows={Object.entries(referenceData.skillCostTable)
            .map(([score, cost]) => [Number(score), cost] as [number, number])
            .sort((a, b) => a[0] - b[0])}
        />
      </DocSection>
    </div>
  );
}

export default function Documentation() {
  const { groupId } = useParams<{ groupId: string }>();
  const { user } = useAuth();
  const { t } = useTranslation();
  const [referenceData, setReferenceData] = useState<ReferenceData | null>(null);
  const [rulesetName, setRulesetName] = useState<string>("");
  const [gameName, setGameName] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!groupId) return;
    api
      .getGroupReference(groupId)
      .then(({ referenceData, rulesetName, gameName }) => {
        setReferenceData(referenceData);
        setRulesetName(rulesetName);
        setGameName(gameName);
      })
      .catch((err) => setError(errMsg(err)));
  }, [groupId]);

  const guide = getPlatformGuide(user?.language ?? "fr");
  const roleSections = user?.role === "gm" ? guide.gm : user?.role === "player" ? guide.player : [];

  return (
    <div className="min-h-dvh bg-slate-950">
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
        <header className="flex items-center justify-between gap-3">
          <Link to={groupId ? `/groupe/${groupId}` : "/"} className="text-sm text-indigo-400 hover:underline">
            {t("← Personnages")}
          </Link>
          <h1 className="text-lg font-semibold">{t("Documentation")}</h1>
        </header>

        {error && <p className="text-red-400">{error}</p>}

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">{t("Guide de la plateforme")}</h2>
          <DocSection title={t("Généralités")}>
            <div className="space-y-4">
              {guide.common.map((s, i) => (
                <GuideSectionBlock key={i} section={s} />
              ))}
            </div>
          </DocSection>
          {roleSections.length > 0 && (
            <DocSection title={user?.role === "gm" ? t("Pour le MJ") : t("Pour le joueur")}>
              <div className="space-y-4">
                {roleSections.map((s, i) => (
                  <GuideSectionBlock key={i} section={s} />
                ))}
              </div>
            </DocSection>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">
            {t("Règles du jeu")}
            {rulesetName ? ` — ${rulesetName}` : ""}
            {gameName ? ` (${gameName})` : ""}
          </h2>
          {referenceData ? (
            <RulesetReference referenceData={referenceData} t={t} />
          ) : (
            !error && <p className="text-slate-400">{t("Chargement…")}</p>
          )}
        </section>
      </div>
    </div>
  );
}
