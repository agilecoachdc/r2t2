// Écran "Suivi des constantes" — vue MJ uniquement : tous les personnages
// (joueurs + PNJ) actuellement "en jeu". Chaque tuile est volontairement
// minimale (nom, photo, anneaux PV/PSP, silhouette d'armure) pour tout voir
// d'un coup d'œil en séance. Rafraîchi automatiquement (polling léger)
// puisque les PV/PSP bougent côté joueurs pendant que cet écran reste
// ouvert côté MJ.
//
// Les PNJ sont créés directement depuis cet écran (pas de fiche complète —
// juste nom/photo/race/VIT/VOL, cf. characters.ts POST) et ont, à la
// différence des personnages de joueurs, des boutons +/- pour ajuster leurs
// PV/PSP en direct : ils n'ont pas de joueur pour le faire depuis leur
// propre fiche. PV/PSP max suivent le même calcul que pour un joueur
// (VIT/VOL + race + taille, cf. calc-engine.ts) — le formulaire affiche un
// aperçu en direct de ce calcul pendant la saisie.
//
// Chaque tuile affiche aussi l'XP gagnée depuis la création et l'XP
// disponible (Character.xp/xpAvailable) avec un bouton "+XP" pour en donner
// sans ouvrir la fiche complète — même mécanisme que sur la fiche détaillée
// (BudgetPanel, CharacterSheetPanels.tsx), réservé au MJ côté serveur
// (POST /api/characters/:id/xp). Un montant positif augmente les deux du
// même montant ; un montant négatif ne réduit que l'XP disponible (peut
// devenir négatif) — cf. shared/types.ts.

import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ATTRIBUTES, type Attribute, type AttributeScores, type CharacterSummary, type ReferenceData } from "@shared/types";
import { getHpMax, getPspMax } from "@shared/calc-engine";
import { useAuth } from "../lib/auth-context";
import { api } from "../lib/api";
import { useTranslation } from "../lib/i18n";
import { LocalisationSilhouette, RaceArmorSilhouette } from "../components/RaceArmorSilhouette";
import { resizePortraitToDataUrl } from "../lib/image";

// 2000ms plutôt que 1000ms : GET /api/characters renvoie tous les portraits
// du groupe (jusqu'à ~1 Mo de data URLs JPEG en pratique) — au double de la
// fréquence, deux GM/joueurs simultanés suffisaient à dépasser la limite CPU
// du Worker (503 en rafale, incident du 2026-09-19). cf. aussi le plafond de
// taille resserré dans lib/image.ts (resizePortraitToDataUrl).
const POLL_INTERVAL_MS = 2000;
// Anneaux/photo/silhouette dimensionnés pour tenir sur un écran de 390px de
// large (iPhone 12 Pro) sans scroll horizontal en tuile 1 colonne : silhouette
// (SIL_SIZE + son padding px-3) + rings + photo + paddings/gap du contenu
// tiennent dans les ~358px utiles (390 - px-4 de la page) avec une marge de
// sécurité. Cf. CharacterTile ci-dessous pour le détail des paddings.
const RING_SIZE = 96;
const PHOTO_SIZE = 96;
const SIL_SIZE = 80;
const EMPTY_NPC_ATTRIBUTES: AttributeScores = Object.fromEntries(ATTRIBUTES.map((a) => [a, 0])) as AttributeScores;
// Une icône par attribut pour signaler un boost temporaire (pouvoir psy actif,
// cf. CharacterSummary.boostedAttributes / calc-engine.getBoostedAttributes) —
// affichée sur la tuile de l'écran "Suivi des constantes", à la place de
// l'ancien badge "⚡" générique unique.
const ATTRIBUTE_BOOST_ICONS: Record<Attribute, string> = {
  FO: "💪",
  VIT: "🧘🏻‍♀️",
  DEX: "🎯",
  REF: "⚡",
  PER: "👁️",
  COM: "🗣️",
  INT: "🧠",
  VOL: "🙏",
};
// Libellés pour l'infobulle de chaque icône — même contenu que
// CharacterSheetPanels.ATTRIBUTE_LABELS (non exporté, dupliqué ici plutôt
// que de créer un import croisé pour une simple table d'affichage).
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
// Catalogue par défaut le temps que GET /characters (scopé au groupe du MJ)
// réponde — cf. lib/reference.ts côté worker, plus d'import statique ADD40K.
const EMPTY_REFERENCE_DATA: ReferenceData = {
  races: [],
  skillCostTable: {},
  skills: [],
  weapons: [],
  armor: [],
  psyPowers: [],
  advantages: [],
  equipment: [],
};

/**
 * Anneaux concentriques façon Apple Fitness : PV (rouge) à l'extérieur, PSP
 * (bleu) à l'intérieur. Chaque anneau est un cercle SVG plein tracé en
 * pointillés (stroke-dasharray = circonférence) dont on masque une partie
 * (stroke-dashoffset) selon le pourcentage restant — même technique que les
 * "activity rings". Rotation -90° pour démarrer en haut (12h) comme Apple
 * plutôt qu'à 3h (défaut SVG). Les chiffres PV/PSP sont superposés en HTML
 * normal (pas de rotation) par-dessus le SVG tourné.
 */
function ConstantsRings({
  hpCurrent,
  hpMax,
  pspCurrent,
  pspMax,
  size = 72,
}: {
  hpCurrent: number;
  hpMax: number;
  pspCurrent: number;
  pspMax: number;
  size?: number;
}) {
  const strokeWidth = Math.max(6, Math.round(size / 9));
  const gap = Math.max(2, Math.round(size / 24));
  const center = size / 2;
  const outerRadius = center - strokeWidth / 2;
  const innerRadius = outerRadius - strokeWidth - gap;

  const hpPct = hpMax > 0 ? Math.max(0, Math.min(1, hpCurrent / hpMax)) : 0;
  const pspPct = pspMax > 0 ? Math.max(0, Math.min(1, pspCurrent / pspMax)) : 0;

  function ring(radius: number, pct: number, trackColor: string, fillColor: string) {
    const circumference = 2 * Math.PI * radius;
    return (
      <>
        <circle cx={center} cy={center} r={radius} fill="none" stroke={trackColor} strokeWidth={strokeWidth} />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={fillColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct)}
        />
      </>
    );
  }

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        {ring(outerRadius, hpPct, "rgba(248,113,113,0.15)", "#f87171")}
        {ring(innerRadius, pspPct, "rgba(56,189,248,0.15)", "#38bdf8")}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-tight">
        <span className="font-bold text-red-400" style={{ fontSize: size * 0.15 }}>
          {hpCurrent}
        </span>
        <span className="font-bold text-sky-400" style={{ fontSize: size * 0.15 }}>
          {pspCurrent}
        </span>
      </div>
    </div>
  );
}

/** Petit bouton +/- qui n'active pas la navigation de la tuile (nichée dans un <Link>). */
function StepButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      className="h-6 w-6 rounded bg-slate-800 text-sm leading-none text-slate-200 hover:bg-slate-700"
    >
      {label}
    </button>
  );
}

/**
 * Bouton compact ("+XP", "+Cr"...) — révèle un mini-formulaire inline
 * (montant + Valider) plutôt qu'un prompt() natif, pour rester cohérent avec
 * le reste de l'UI et ne pas bloquer le polling pendant la saisie. Géré en
 * état local à la tuile : chaque tuile est indépendante, pas besoin de le
 * remonter au parent. Générique (label paramétrable) — réutilisé pour l'XP
 * et les crédits, mêmes routes MJ symétriques (POST /:id/xp, /:id/credits).
 */
function GrantAmountControl({
  label,
  onGrant,
  onOpenChange,
}: {
  label: string;
  onGrant: (amount: number) => void | Promise<void>;
  /**
   * Prévient CharacterTile qu'un formulaire est ouvert/fermé, pour qu'il
   * bloque la navigation du <Link> englobant tant que la saisie est en
   * cours (cf. CharacterTile.formOpen) — un clic fantôme retardé (courant
   * sur mobile juste après un changement de layout bouton -> formulaire)
   * peut sinon atterrir sur le <Link> même après un stopPropagation
   * classique sur le clic d'origine, provoquant une redirection en plein
   * milieu de la saisie (cas réel signalé sur le bouton "+Cr" par tuile).
   */
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpenState] = useState(false);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  function setOpen(next: boolean) {
    setOpenState(next);
    onOpenChange?.(next);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    const value = Number(amount);
    if (!value || !Number.isFinite(value)) return;
    setBusy(true);
    try {
      await onGrant(value);
      setAmount("");
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700"
      >
        {label}
      </button>
    );
  }
  return (
    <form
      onClick={(e) => e.stopPropagation()}
      onSubmit={handleSubmit}
      className="flex items-center gap-1"
    >
      <input
        type="number"
        autoFocus
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder="ex. 5"
        className="w-14 rounded border border-slate-700 bg-slate-800 px-1 py-0.5 text-xs"
      />
      <button
        type="submit"
        disabled={busy || !amount}
        className="rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        {busy ? "…" : "OK"}
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          setAmount("");
        }}
        className="text-xs text-slate-500 hover:text-slate-300"
      >
        ×
      </button>
    </form>
  );
}

function CharacterTile({
  c,
  isNpc,
  groupId,
  highlighted,
  onAdjust,
  onRemove,
  onGrantXp,
  onGrantCredits,
}: {
  c: CharacterSummary;
  isNpc: boolean;
  groupId: string;
  /** RA de ce personnage == rang courant du round (cf. currentRank plus bas) — plusieurs tuiles peuvent être surlignées en même temps. */
  highlighted: boolean;
  onAdjust?: (field: "hpCurrent" | "pspCurrent", delta: number) => void;
  onRemove?: () => void;
  onGrantXp?: (amount: number) => void | Promise<void>;
  /** Ajustement individuel de crédits (bouton "+Cr") — cf. characters.ts POST /:id/credits. */
  onGrantCredits?: (amount: number) => void | Promise<void>;
}) {
  const { t } = useTranslation();
  // Bloque la navigation de la tuile tant qu'un formulaire "+XP"/"+Cr" est
  // ouvert dessus — cf. GrantAmountControl.onOpenChange. Deux booléens
  // (pas un seul partagé) : les contrôles XP et Cr sont deux instances
  // indépendantes, potentiellement ouvertes/fermées à des moments différents.
  const [xpFormOpen, setXpFormOpen] = useState(false);
  const [creditsFormOpen, setCreditsFormOpen] = useState(false);
  const formOpen = xpFormOpen || creditsFormOpen;
  return (
    <Link
      to={`/personnages/${c.id}`}
      state={{ from: "suivi", groupId }}
      onClick={(e) => {
        if (formOpen) e.preventDefault();
      }}
      className={`flex items-stretch overflow-hidden rounded-xl bg-slate-900 shadow transition hover:bg-slate-800 ${
        highlighted ? "ring-2 ring-amber-400" : ""
      }`}
    >
      {/* Silhouette d'armure sur toute la hauteur — taille réduite par rapport à la fiche personnage (SIL_SIZE) pour tenir sur mobile. */}
      <div className="flex shrink-0 items-center justify-center self-stretch bg-slate-950/40 px-3">
        <RaceArmorSilhouette race={c.race} armorTotals={c.armorTotals} size={SIL_SIZE} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm font-medium text-slate-100">{c.name}</p>
          {/*
            Une icône par attribut actuellement boosté par un pouvoir psy actif
            (cf. CharacterSummary.boostedAttributes, calc-engine.
            getBoostedAttributes, ATTRIBUTE_BOOST_ICONS ci-dessus), plus un
            indicateur générique si une compétence (pas un attribut) est
            boostée (boostedSkillNames — aucune des 8 icônes ne s'applique).
          */}
          {c.boostedAttributes.map((attr) => (
            <span
              key={attr}
              className="shrink-0 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-xs text-amber-300"
              title={t(ATTRIBUTE_LABELS[attr])}
            >
              {ATTRIBUTE_BOOST_ICONS[attr]}
            </span>
          ))}
          {c.boostedSkillNames.length > 0 && (
            <span
              className="shrink-0 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-xs text-amber-300"
              title={`${t("Compétence boostée")} : ${c.boostedSkillNames.join(", ")}`}
            >
              ✨
            </span>
          )}
          {/*
            Rang d'Action courant — cf. calc-engine.getActionRank (Réflexe,
            arme équipée, Concentration rapide/lente + Concentration psy
            actifs). Plus bas = agit plus tôt.
          */}
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${
              highlighted ? "bg-amber-400 text-slate-950" : "bg-slate-800 text-slate-300"
            }`}
            title="Rang d'Action"
          >
            {t("RA")} {c.actionRank}
          </span>
          {isNpc && onRemove && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onRemove();
              }}
              title="Retirer du suivi"
              aria-label={`Retirer ${c.name} du suivi`}
              className="shrink-0 text-slate-500 hover:text-red-400"
            >
              ×
            </button>
          )}
        </div>
        <div className="mt-2 flex flex-1 items-center gap-3">
          <ConstantsRings hpCurrent={c.hpCurrent} hpMax={c.hpMax} pspCurrent={c.pspCurrent} pspMax={c.pspMax} size={RING_SIZE} />
          {c.portraitUrl ? (
            <img
              src={c.portraitUrl}
              alt={c.name}
              className="shrink-0 rounded-lg object-cover"
              style={{ height: PHOTO_SIZE, width: PHOTO_SIZE }}
            />
          ) : (
            <div
              className="flex shrink-0 items-center justify-center rounded-lg bg-slate-800 text-3xl text-slate-600"
              style={{ height: PHOTO_SIZE, width: PHOTO_SIZE }}
            >
              {c.name.charAt(0)}
            </div>
          )}
        </div>
        {/*
          XP gagnée depuis la création (c.xp) / XP disponible (c.xpAvailable)
          — mêmes libellés que BudgetPanel sur la fiche détaillée, cf.
          Character.xp/xpAvailable dans shared/types.ts. Affiché pour
          joueurs et PNJ, avec le contrôle "+XP" du MJ juste à côté (cette
          page est déjà réservée au MJ, cf. le garde-fou Navigate plus bas).
        */}
        <div className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-400">
          <span>
            {t("XP gagnée")} <span className="font-semibold text-amber-300">{c.xp}</span>
            <span className="text-slate-600"> · {t("dispo")} {c.xpAvailable}</span>
          </span>
          {onGrantXp && <GrantAmountControl label="+XP" onGrant={onGrantXp} onOpenChange={setXpFormOpen} />}
        </div>
        {/*
          Solde en crédits (Character.credits) — même principe d'affichage
          que XP ci-dessus, alimenté par le bouton MJ "+(X) mois 💵" (revenu
          mensuel individuel, cf. handleGrantGroupIncome plus bas) et diminué
          automatiquement à l'achat d'une nouvelle arme/armure/ligne
          d'équipement sur la fiche (cf. WeaponsArmorPanel/EquipmentPanel), ou
          ajusté ponctuellement par le MJ via le bouton "+Cr" ici (cf.
          characters.ts POST /:id/credits — même mécanisme que "+XP").
        */}
        <div className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-400">
          <span>
            💵 <span className="font-semibold text-emerald-300">{c.credits}</span> Cr
          </span>
          {onGrantCredits && <GrantAmountControl label="+Cr" onGrant={onGrantCredits} onOpenChange={setCreditsFormOpen} />}
        </div>
        {isNpc && onAdjust && (
          <div className="mt-2 flex items-center justify-center gap-4 text-xs text-slate-400">
            <div className="flex items-center gap-1.5">
              <span className="text-red-400">PV</span>
              <StepButton label="−" onClick={() => onAdjust("hpCurrent", -1)} />
              <StepButton label="+" onClick={() => onAdjust("hpCurrent", 1)} />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-sky-400">PSP</span>
              <StepButton label="−" onClick={() => onAdjust("pspCurrent", -1)} />
              <StepButton label="+" onClick={() => onAdjust("pspCurrent", 1)} />
            </div>
          </div>
        )}
      </div>
    </Link>
  );
}

export default function GmTracker() {
  const { groupId } = useParams<{ groupId: string }>();
  const { user } = useAuth();
  const { t } = useTranslation();
  const [rows, setRows] = useState<CharacterSummary[] | null>(null);
  const [referenceData, setReferenceData] = useState<ReferenceData>(EMPTY_REFERENCE_DATA);
  // Image du groupe (fond d'écran) — remplace le fond ADD40K en dur, cf.
  // migrations/0004_images.sql.
  const [groupImageUrl, setGroupImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Rang d'Action affiché en haut de l'écran — le MJ avance/recule dans le
  // round au fil des actions (cf. calc-engine.getActionRank : plus bas =
  // agit plus tôt, donc "Suivant" incrémente). État purement local à cette
  // page (pas de synchro serveur) : seul le MJ pilote cet écran, pas besoin
  // de le partager. Initialisé une seule fois, au premier chargement, sur
  // le RA le plus bas parmi les personnages en jeu (celui qui agit en
  // premier) — rankInitialized évite de réinitialiser à chaque poll (1s).
  const [currentRank, setCurrentRank] = useState(0);
  const rankInitialized = useRef(false);
  const [endCombatBusy, setEndCombatBusy] = useState(false);

  const [groupXpOpen, setGroupXpOpen] = useState(false);
  const [groupXpAmount, setGroupXpAmount] = useState("");
  const [groupXpBusy, setGroupXpBusy] = useState(false);

  const [groupIncomeOpen, setGroupIncomeOpen] = useState(false);
  const [groupIncomeMonths, setGroupIncomeMonths] = useState("1");
  const [groupIncomeBusy, setGroupIncomeBusy] = useState(false);

  const [showNpcForm, setShowNpcForm] = useState(false);
  const [npcName, setNpcName] = useState("");
  const [npcRace, setNpcRace] = useState("");
  const [npcVit, setNpcVit] = useState(0);
  const [npcVol, setNpcVol] = useState(0);
  const [npcPortraitUrl, setNpcPortraitUrl] = useState<string | null>(null);
  const [npcSaving, setNpcSaving] = useState(false);
  const [npcError, setNpcError] = useState<string | null>(null);
  const npcFileInputRef = useRef<HTMLInputElement>(null);

  // Aperçu du calcul PV/PSP pendant la saisie — même moteur que la fiche
  // (getHpMax/getPspMax), sur un personnage minimal construit à la volée.
  const npcPreviewCharacter = {
    attributeScores: { ...EMPTY_NPC_ATTRIBUTES, VIT: npcVit, VOL: npcVol },
    attributeTechBonus: {},
    race: npcRace || "humain",
    tailleModifier: referenceData.races.find((r) => r.race === (npcRace || "humain"))?.tailleBonus ?? 0,
  };
  const npcHpPreview = getHpMax(npcPreviewCharacter, referenceData);
  const npcPspPreview = getPspMax(npcPreviewCharacter, referenceData);

  function loadCharacters() {
    if (!groupId) return Promise.resolve();
    return api
      .listCharacters(groupId)
      .then(({ characters, referenceData, groupImageUrl }) => {
        setRows(characters);
        if (referenceData) setReferenceData(referenceData);
        setGroupImageUrl(groupImageUrl);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Erreur"));
  }

  useEffect(() => {
    loadCharacters();
    const interval = setInterval(loadCharacters, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  useEffect(() => {
    if (rankInitialized.current || !rows) return;
    const inGame = rows.filter((c) => c.inGame && !c.archived);
    if (inGame.length === 0) return;
    setCurrentRank(Math.min(...inGame.map((c) => c.actionRank)));
    rankInitialized.current = true;
  }, [rows]);

  // Vue réservée au MJ, membre de ce groupe — un joueur, ou un MJ d'un
  // autre groupe, qui atterrit ici (URL directe) repart à l'accueil.
  if (user && (user.role !== "gm" || !groupId || !user.memberships.includes(groupId))) {
    return <Navigate to="/" replace />;
  }

  const players = rows?.filter((c) => c.inGame && !c.isNpc && !c.archived) ?? null;
  const npcs = rows?.filter((c) => c.inGame && c.isNpc && !c.archived) ?? null;
  // Le plus haut RA parmi les personnages en jeu — "Suivant" reboucle à 0
  // une fois ce rang dépassé, plutôt que de continuer à grimper au-delà de
  // tout personnage réellement en jeu.
  const inGameRows = rows?.filter((c) => c.inGame && !c.archived) ?? [];
  const maxRank = inGameRows.length > 0 ? Math.max(...inGameRows.map((c) => c.actionRank)) : 0;

  // Ajuste PV/PSP d'un PNJ et sauvegarde immédiatement — pas de fiche à
  // ouvrir, c'est tout l'intérêt de ces boutons pour le MJ en cours de jeu.
  async function adjustNpc(npc: CharacterSummary, field: "hpCurrent" | "pspCurrent", delta: number) {
    if (!rows) return;
    const max = field === "hpCurrent" ? npc.hpMax : npc.pspMax;
    const next = Math.max(0, Math.min(max, npc[field] + delta));
    setRows(rows.map((r) => (r.id === npc.id ? { ...r, [field]: next } : r)));
    try {
      await api.updateCharacter(npc.id, { [field]: next });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la sauvegarde");
      setRows((current) => current?.map((r) => (r.id === npc.id ? { ...r, [field]: npc[field] } : r)) ?? current);
    }
  }

  // Distribution d'XP en direct depuis la tuile — pas besoin d'ouvrir la
  // fiche complète pour ça (même esprit que les +/- PV/PSP des PNJ ci-dessus,
  // mais côté API réservé au MJ, cf. POST /characters/:id/xp). Recharge la
  // liste plutôt qu'une mise à jour optimiste : positif ou négatif touche
  // xp/xpAvailable selon le signe côté serveur (routes/characters.ts), plus
  // simple à refléter fidèlement via un GET qu'à recalculer ici.
  async function grantXp(character: CharacterSummary, amount: number) {
    try {
      await api.grantXp(character.id, amount);
      await loadCharacters();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la distribution d'XP");
    }
  }

  // Ajustement individuel de crédits en direct depuis la tuile — même
  // principe que grantXp ci-dessus (POST /characters/:id/credits), pour un
  // ajustement ponctuel hors du revenu mensuel automatique (bouton
  // "+(X) mois", handleGrantGroupIncome plus bas).
  async function grantCredits(character: CharacterSummary, amount: number) {
    try {
      await api.grantCredits(character.id, amount);
      await loadCharacters();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'ajustement de crédits");
    }
  }

  // "Fin de combat" — désactive d'un coup tous les pouvoirs psy actifs des
  // personnages en jeu de ce groupe et rembourse leur coût en PSP (cf.
  // characters.ts POST /end-combat, même mécanisme de remboursement que
  // CharacterSheet.setActivePower pour une désactivation individuelle).
  async function handleEndCombat() {
    if (!groupId) return;
    setError(null);
    setEndCombatBusy(true);
    try {
      await api.endCombat(groupId);
      await loadCharacters();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la fin de combat");
    } finally {
      setEndCombatBusy(false);
    }
  }

  // Distribution d'XP groupée — même montant pour tous les personnages
  // JOUEURS en jeu du groupe (les PNJ ne sont pas concernés, l'XP est un
  // mécanisme de progression des joueurs) en un seul appel côté serveur
  // (cf. characters.ts POST /group-xp), plutôt qu'une boucle de grantXp
  // individuels depuis le client. Recharge la liste pour refléter xp/
  // xpAvailable à jour sur chaque tuile.
  async function handleGrantGroupXp(e: React.FormEvent) {
    e.preventDefault();
    if (!groupId) return;
    const value = Number(groupXpAmount);
    if (!value || !Number.isFinite(value)) return;
    setError(null);
    setGroupXpBusy(true);
    try {
      await api.grantGroupXp(groupId, value);
      await loadCharacters();
      setGroupXpAmount("");
      setGroupXpOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la distribution d'XP groupée");
    } finally {
      setGroupXpBusy(false);
    }
  }

  // Distribution du revenu mensuel groupée — chaque personnage JOUEUR en jeu
  // reçoit SON PROPRE revenu (500 Cr de base + bonus "Revenus" éventuel, cf.
  // calc-engine.getMonthlyIncome) fois le nombre de mois saisi, calculé côté
  // serveur (POST /group-income) plutôt qu'un montant uniforme comme l'XP.
  async function handleGrantGroupIncome(e: React.FormEvent) {
    e.preventDefault();
    if (!groupId) return;
    const months = Number(groupIncomeMonths);
    if (!months || !Number.isFinite(months)) return;
    setError(null);
    setGroupIncomeBusy(true);
    try {
      await api.grantGroupIncome(groupId, months);
      await loadCharacters();
      setGroupIncomeMonths("1");
      setGroupIncomeOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la distribution du revenu mensuel");
    } finally {
      setGroupIncomeBusy(false);
    }
  }

  async function removeNpc(npc: CharacterSummary) {
    if (!rows) return;
    setRows(rows.map((r) => (r.id === npc.id ? { ...r, inGame: false } : r)));
    try {
      await api.updateCharacter(npc.id, { inGame: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la sauvegarde");
      setRows((current) => current?.map((r) => (r.id === npc.id ? { ...r, inGame: true } : r)) ?? current);
    }
  }

  async function handleNpcPhotoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      setNpcPortraitUrl(await resizePortraitToDataUrl(file));
    } catch (err) {
      setNpcError(err instanceof Error ? err.message : "Échec du chargement de l'image");
    }
  }

  async function handleCreateNpc(e: React.FormEvent) {
    e.preventDefault();
    if (!npcName.trim() || !groupId) return;
    setNpcSaving(true);
    setNpcError(null);
    try {
      await api.createNpc(groupId, {
        name: npcName.trim(),
        portraitUrl: npcPortraitUrl,
        race: npcRace || undefined,
        vit: npcVit,
        vol: npcVol,
      });
      setNpcName("");
      setNpcRace("");
      setNpcVit(0);
      setNpcVol(0);
      setNpcPortraitUrl(null);
      setShowNpcForm(false);
      await loadCharacters();
    } catch (err) {
      setNpcError(err instanceof Error ? err.message : "Échec de la création");
    } finally {
      setNpcSaving(false);
    }
  }

  return (
    <div
      className="min-h-dvh bg-cover bg-center bg-no-repeat"
      style={{
        backgroundImage: `linear-gradient(rgba(2,6,23,.82), rgba(2,6,23,.82)), url('${groupImageUrl ?? "/r2t2-banner.jpg"}')`,
      }}
    >
      <div className="mx-auto max-w-5xl px-4 py-6">
        <header className="mb-6 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold">{t("Suivi des constantes")}</h1>
            <p className="text-sm text-slate-400">{t("Personnages en jeu — PV / PSP en direct")}</p>
          </div>
          <Link to={`/groupe/${groupId}`} className="text-sm text-indigo-400 hover:underline">
            {t("← Personnages")}
          </Link>
        </header>

        {/*
          Rang d'Action du round en cours — le MJ avance ("Suivant", RA plus
          haut = agit plus tard) ou recule ("Précédent", pour corriger un
          oubli) au fil des actions. Les tuiles dont le RA correspond
          exactement sont surlignées ci-dessous (plusieurs personnages
          peuvent agir au même rang). "Suivant" reboucle à 0 une fois le
          plus haut RA en jeu dépassé (maxRank) — pas de round qui grimpe
          indéfiniment. Silhouette de localisation générique en repère
          visuel constant, à côté du compteur.
        */}
        <div className="mb-6 flex items-center justify-center gap-4 rounded-xl bg-slate-900 px-4 py-3 shadow">
          <LocalisationSilhouette size={64} />
          <button
            type="button"
            onClick={() => setCurrentRank((r) => r - 1)}
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-700"
          >
            {t("← Précédent")}
          </button>
          <div className="text-center">
            <p className="text-xs uppercase tracking-wide text-slate-500">{t("Rang d'Action")}</p>
            <p className="text-2xl font-bold text-amber-300">{currentRank}</p>
          </div>
          <button
            type="button"
            onClick={() => setCurrentRank((r) => (r >= maxRank ? 0 : r + 1))}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
          >
            {t("Suivant →")}
          </button>
        </div>

        {/*
          "Fin de combat" — désactive tous les pouvoirs psy actifs des
          personnages en jeu du groupe et rembourse leur coût en PSP (cf.
          handleEndCombat ci-dessus, characters.ts POST /end-combat). Les
          pouvoirs "un tour" comme "le combat" (ActivePsyPower.duration) sont
          traités pareil ici : aucune expiration automatique par tour n'est
          codée, seul ce bouton groupé ou une désactivation manuelle par
          fiche y met fin.
        */}
        <div className="mb-6 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={handleEndCombat}
            disabled={endCombatBusy}
            title={t("Désactive tous les pouvoirs psy actifs des personnages en jeu et rembourse leur PSP")}
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700 disabled:opacity-50"
          >
            {endCombatBusy ? "…" : `⚡ ${t("Fin de combat")}`}
          </button>

          {/*
            "Donner de l'XP à tous" — même montant pour tous les personnages
            joueurs en jeu (PNJ exclus), cf. handleGrantGroupXp ci-dessus,
            characters.ts POST /group-xp. Même esprit de mini-formulaire
            inline que GrantAmountControl (par tuile) plutôt qu'un prompt().
          */}
          {!groupXpOpen ? (
            <button
              type="button"
              onClick={() => setGroupXpOpen(true)}
              title={t("Donne le même montant d'XP à tous les personnages joueurs en jeu")}
              className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700"
            >
              {`✦ ${t("Donner de l'XP à tous")}`}
            </button>
          ) : (
            <form onSubmit={handleGrantGroupXp} className="flex items-center gap-1.5">
              <input
                type="number"
                autoFocus
                value={groupXpAmount}
                onChange={(e) => setGroupXpAmount(e.target.value)}
                placeholder="ex. 5"
                className="w-16 rounded border border-slate-700 bg-slate-800 px-1.5 py-1 text-xs"
              />
              <button
                type="submit"
                disabled={groupXpBusy || !groupXpAmount}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {groupXpBusy ? "…" : t("Valider")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setGroupXpOpen(false);
                  setGroupXpAmount("");
                }}
                className="text-xs text-slate-500 hover:text-slate-300"
              >
                ×
              </button>
            </form>
          )}

          {/*
            "+(X) mois 💵" — verse à chaque personnage joueur en jeu SON
            PROPRE revenu mensuel (pas un montant uniforme, contrairement à
            l'XP ci-dessus), cf. handleGrantGroupIncome, characters.ts POST
            /group-income, calc-engine.getMonthlyIncome.
          */}
          {!groupIncomeOpen ? (
            <button
              type="button"
              onClick={() => setGroupIncomeOpen(true)}
              title={t("Verse à chaque personnage joueur en jeu son revenu mensuel (500 Cr + bonus \"Revenus\" éventuel) fois le nombre de mois saisi")}
              className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700"
            >
              {`💵 ${t("+(X) mois")}`}
            </button>
          ) : (
            <form onSubmit={handleGrantGroupIncome} className="flex items-center gap-1.5">
              <input
                type="number"
                autoFocus
                value={groupIncomeMonths}
                onChange={(e) => setGroupIncomeMonths(e.target.value)}
                placeholder="ex. 1"
                className="w-16 rounded border border-slate-700 bg-slate-800 px-1.5 py-1 text-xs"
              />
              <button
                type="submit"
                disabled={groupIncomeBusy || !groupIncomeMonths}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {groupIncomeBusy ? "…" : t("Valider")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setGroupIncomeOpen(false);
                  setGroupIncomeMonths("1");
                }}
                className="text-xs text-slate-500 hover:text-slate-300"
              >
                ×
              </button>
            </form>
          )}
        </div>

        {error && <p className="mb-3 text-red-400">{error}</p>}
        {!rows && !error && <p className="text-slate-400">{t("Chargement…")}</p>}

        {rows && (
          <>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">{t("Joueurs")}</h2>
            {players && players.length === 0 && (
              <p className="mb-6 text-sm text-slate-500">
                {t("Aucun personnage en jeu. Coche \"En jeu\" sur l'écran d'accueil pour l'ajouter ici.")}
              </p>
            )}
            {/*
              Passage à 2 colonnes à `md` (768px, format tablette portrait) :
              tuile mini ≈ 332px (SIL_SIZE 80 + RING_SIZE/PHOTO_SIZE 96 x2 +
              paddings/gap), donc 2 colonnes (2x332 + gap-3) tiennent dès
              ~708px de large — `sm` (640px) serait trop étroit, `md` a de la
              marge. En dessous de 768px (téléphone), 1 colonne pour éviter le
              scroll horizontal (cf. RING_SIZE/PHOTO_SIZE/SIL_SIZE ci-dessus).
            */}
            <ul className="mb-8 grid grid-cols-1 gap-3 md:grid-cols-2">
              {players?.map((c) => (
                <li key={c.id}>
                  <CharacterTile
                    c={c}
                    isNpc={false}
                    groupId={groupId!}
                    highlighted={c.actionRank === currentRank}
                    onGrantXp={(amount) => grantXp(c, amount)}
                    onGrantCredits={(amount) => grantCredits(c, amount)}
                  />
                </li>
              ))}
            </ul>

            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">{t("PNJ")}</h2>
              <button
                type="button"
                onClick={() => setShowNpcForm((v) => !v)}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
              >
                {showNpcForm ? t("Annuler") : t("+ Nouveau PNJ")}
              </button>
            </div>

            {showNpcForm && (
              <form onSubmit={handleCreateNpc} className="mb-4 rounded-xl bg-slate-900 p-4 shadow">
                <div className="flex flex-wrap items-start gap-4">
                  <button
                    type="button"
                    onClick={() => npcFileInputRef.current?.click()}
                    className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-800 text-slate-500 hover:bg-slate-700"
                  >
                    {npcPortraitUrl ? (
                      <img src={npcPortraitUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-xs">{t("Photo")}</span>
                    )}
                  </button>
                  <input
                    ref={npcFileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleNpcPhotoChange}
                  />
                  <div className="flex-1 space-y-3">
                    <div>
                      <label className="mb-1 block text-xs text-slate-500">{t("Nom")}</label>
                      <input
                        type="text"
                        required
                        value={npcName}
                        onChange={(e) => setNpcName(e.target.value)}
                        className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm"
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="mb-1 block text-xs text-slate-500">{t("Race")}</label>
                        <select
                          value={npcRace}
                          onChange={(e) => setNpcRace(e.target.value)}
                          className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm"
                        >
                          <option value="">—</option>
                          {referenceData.races.map((r) => (
                            <option key={r.race} value={r.race}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-slate-500">{t("Vitalité (VIT)")}</label>
                        <input
                          type="number"
                          value={npcVit}
                          onChange={(e) => setNpcVit(Number(e.target.value))}
                          className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-slate-500">{t("Volonté (VOL)")}</label>
                        <input
                          type="number"
                          value={npcVol}
                          onChange={(e) => setNpcVol(Number(e.target.value))}
                          className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm"
                        />
                      </div>
                    </div>
                    <p className="text-xs text-slate-500">
                      {t("PV max")} : <span className="text-red-400">{npcHpPreview}</span> · {t("PSP max")} :{" "}
                      <span className="text-sky-400">{npcPspPreview}</span> ({t("même calcul que pour un joueur — VIT/VOL + race + taille")})
                    </p>
                  </div>
                </div>
                {npcError && <p className="mt-3 text-sm text-red-400">{npcError}</p>}
                <button
                  type="submit"
                  disabled={npcSaving}
                  className="mt-3 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  {npcSaving ? t("Création…") : t("Créer le PNJ")}
                </button>
              </form>
            )}

            {npcs && npcs.length === 0 && !showNpcForm && (
              <p className="text-sm text-slate-500">{t("Aucun PNJ en jeu.")}</p>
            )}
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {npcs?.map((c) => (
                <li key={c.id}>
                  <CharacterTile
                    c={c}
                    isNpc
                    groupId={groupId!}
                    highlighted={c.actionRank === currentRank}
                    onAdjust={(field, delta) => adjustNpc(c, field, delta)}
                    onRemove={() => removeNpc(c)}
                    onGrantXp={(amount) => grantXp(c, amount)}
                    onGrantCredits={(amount) => grantCredits(c, amount)}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
