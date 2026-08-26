import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import type { ActivePsyPower, Character, ReferenceData } from "@shared/types";
import { computeCharacter, getPsyPowerActivationCost, MAX_EQUIPPED_WEAPONS, type CharacterComputed } from "@shared/calc-engine";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { useTranslation } from "../lib/i18n";
import {
  IdentityHeader,
  HpPspBar,
  AttributesPanel,
  SkillsPanel,
  WeaponsArmorPanel,
  PsyPowersPanel,
  AdvantagesPanel,
  EquipmentPanel,
  BudgetPanel,
} from "../components/CharacterSheetPanels";

export default function CharacterSheet() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { t } = useTranslation();
  // Distribution d'XP réservée au MJ (jamais au joueur propriétaire, même
  // avec canEdit) — cf. BudgetPanel/routes/characters.ts.
  const isGm = user?.role === "gm";
  // Retour contextuel : la liste et le suivi des constantes passent chacun
  // leur origine + le groupe via l'état de navigation (state.from/groupId)
  // au clic sur une fiche (un compte peut être membre de plusieurs
  // groupes, cf. migrations/0005_memberships.sql, donc plus de "groupe
  // courant" implicite) ; sans état (accès direct par URL), on retombe sur
  // l'accueil (liste des groupes).
  const location = useLocation();
  const navState = location.state as { from?: string; groupId?: string } | null;
  const backTo = navState?.groupId
    ? navState.from === "suivi"
      ? `/suivi/${navState.groupId}`
      : `/groupe/${navState.groupId}`
    : "/";
  const backLabel = navState?.groupId
    ? navState.from === "suivi"
      ? t("← Suivi des constantes")
      : t("← Personnages")
    : t("← Groupes");
  const [character, setCharacter] = useState<Character | null>(null);
  // Catalogue du groupe de ce personnage — renvoyé par GET /characters/:id
  // (scopé serveur via sa règle), plus d'import statique ADD40K.
  const [referenceData, setReferenceData] = useState<ReferenceData | null>(null);
  // Image du groupe de ce personnage — remplace le fond ADD40K en dur (cf.
  // migrations/0004_images.sql) ; image plateforme par défaut si absente.
  const [groupImageUrl, setGroupImageUrl] = useState<string | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api
      .getCharacter(id)
      .then(({ character, canEdit, referenceData, groupImageUrl }) => {
        setCharacter(character);
        setCanEdit(canEdit);
        setReferenceData(referenceData);
        setGroupImageUrl(groupImageUrl);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Erreur"));
  }, [id]);

  if (error) return <p className="p-6 text-red-400">{error}</p>;
  if (!character || !referenceData) return <p className="p-6 text-slate-400">{t("Chargement…")}</p>;

  const computed: CharacterComputed = computeCharacter(character, referenceData);

  function update(patch: Partial<Character>) {
    setCharacter((c) => (c ? { ...c, ...patch } : c));
  }

  // Bascule active/inactive d'une armure et sauvegarde immédiatement, sans
  // passer par le mode édition (Modifier/Enregistrer) : l'utilisateur veut
  // voir le calcul de protection (armorTotals) se mettre à jour en jouant,
  // sans devoir éditer toute la fiche. On envoie uniquement `{ armor }` —
  // le PUT fusionne côté worker (characters.ts), le reste de la fiche n'est
  // pas touché.
  // PV/PSP : mêmes +/- toujours actifs (hors mode édition) que l'armure —
  // sauvegarde immédiate, sinon la valeur affichée divergeait silencieusement
  // de celle en base au premier rechargement (bug signalé).
  async function adjustVital(field: "hpCurrent" | "pspCurrent", value: number) {
    if (!character || !id) return;
    const previous = character[field];
    update({ [field]: value });
    try {
      await api.updateCharacter(id, { [field]: value });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la sauvegarde");
      update({ [field]: previous });
    }
  }

  async function toggleArmor(index: number) {
    if (!character || !id) return;
    const previousArmor = character.armor;
    const nextArmor = previousArmor.map((a, i) => (i === index ? { ...a, active: !a.active } : a));
    update({ armor: nextArmor });
    try {
      await api.updateCharacter(id, { armor: nextArmor });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la sauvegarde de l'armure");
      update({ armor: previousArmor });
    }
  }

  // Active/désactive un pouvoir "à la demande" et sauvegarde immédiatement
  // — même principe que toggleArmor/toggleWeaponEquipped. Un seul pouvoir
  // actif par nom (activePsyPowers est une petite liste, pas indexée par
  // pouvoir) : on retire l'entrée existante puis on ajoute la nouvelle si
  // `next` n'est pas null. Le PSP du palier (10 gratuit, +1 par palier de 5
  // jusqu'à 35, cf. calc-engine.getPsyPowerActivationCost) est décompté à
  // l'activation et remboursé à la désactivation — clampé entre 0 et
  // pspMax, comme les autres ajustements de compteur (adjustVital
  // ci-dessus). Même mécanisme groupé côté MJ pour "Fin de combat", cf.
  // characters.ts POST /end-combat.
  async function setActivePower(powerName: string, next: ActivePsyPower | null) {
    if (!character || !id) return;
    const previous = character.activePsyPowers ?? [];
    const previousEntry = previous.find((p) => p.name === powerName);
    const nextActivePowers = previous.filter((p) => p.name !== powerName);
    if (next) nextActivePowers.push(next);
    const previousPsp = character.pspCurrent;
    let nextPsp = previousPsp;
    if (previousEntry) nextPsp = Math.min(computed.pspMax, nextPsp + getPsyPowerActivationCost(previousEntry.level));
    if (next) nextPsp = Math.max(0, nextPsp - getPsyPowerActivationCost(next.level));
    update({ activePsyPowers: nextActivePowers, pspCurrent: nextPsp });
    try {
      await api.updateCharacter(id, { activePsyPowers: nextActivePowers, pspCurrent: nextPsp });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'activation du pouvoir");
      update({ activePsyPowers: previous, pspCurrent: previousPsp });
    }
  }

  // Bascule "arme équipée" et sauvegarde immédiatement, même principe que
  // toggleArmor ci-dessus — seule l'arme équipée compte dans le Rang
  // d'Action (cf. calc-engine.getActionRank), pas besoin d'ouvrir le mode
  // édition pour ça. Deux armes équipées maximum, avec ou sans l'avantage
  // "Ambidextre" (cf. MAX_EQUIPPED_WEAPONS) — sans lui, chaque arme
  // équipée subit un malus de score (cf. getDualWieldPenalty, appliqué à
  // l'affichage dans WeaponsArmorPanel, pas ici). Équiper une arme au-delà
  // du plafond déséquipe automatiquement la/les plus anciennes en trop
  // plutôt que d'empiler sans limite.
  async function toggleWeaponEquipped(index: number) {
    if (!character || !id) return;
    const previousWeapons = character.weapons;
    const target = previousWeapons[index];
    if (!target) return;
    const nowEquipping = !target.equipped;
    let nextWeapons = previousWeapons.map((w, i) => (i === index ? { ...w, equipped: nowEquipping } : w));
    if (nowEquipping) {
      const equippedIndexes = nextWeapons.map((w, i) => (w.equipped ? i : -1)).filter((i) => i !== -1);
      const overflow = equippedIndexes.length - MAX_EQUIPPED_WEAPONS;
      if (overflow > 0) {
        const toUnequip = new Set(equippedIndexes.filter((i) => i !== index).slice(0, overflow));
        nextWeapons = nextWeapons.map((w, i) => (toUnequip.has(i) ? { ...w, equipped: false } : w));
      }
    }
    update({ weapons: nextWeapons });
    try {
      await api.updateCharacter(id, { weapons: nextWeapons });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la sauvegarde de l'arme");
      update({ weapons: previousWeapons });
    }
  }

  async function handleGrantXp(amount: number) {
    if (!id) return;
    setError(null);
    try {
      const { character: saved, referenceData: savedReferenceData } = await api.grantXp(id, amount);
      setCharacter(saved);
      setReferenceData(savedReferenceData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la distribution d'XP");
    }
  }

  // "Donner des crédits" (panneau Budget de points, section Crédits) — repli
  // fiable sur la fiche elle-même pour l'ajustement individuel de crédits
  // (cf. characters.ts POST /:id/credits), le bouton "+Cr" par tuile de
  // l'écran Suivi des constantes ayant été signalé comme redirigeant parfois
  // vers cette même fiche avant que le montant ne soit validé.
  async function handleGrantCredits(amount: number) {
    if (!id) return;
    setError(null);
    try {
      const { character: saved, referenceData: savedReferenceData } = await api.grantCredits(id, amount);
      setCharacter(saved);
      setReferenceData(savedReferenceData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'ajustement de crédits");
    }
  }

  // Le MJ "accepte" un solde négatif (avertissement rouge de BudgetPanel) en
  // absorbant le déficit dans les points de départ — plutôt que de laisser
  // le personnage hors budget indéfiniment ou de forcer une réduction de
  // compétences. Ramène le solde à 0 exactement (le déficit ajouté = le
  // manque actuel).
  async function handleAcceptDeficit() {
    if (!character || !id) return;
    const deficit = Math.abs(computed.budget.solde);
    if (deficit === 0) return;
    setError(null);
    try {
      const { character: saved, referenceData: savedReferenceData } = await api.updateCharacter(id, {
        pointsDepart: character.pointsDepart + deficit,
      });
      setCharacter(saved);
      setReferenceData(savedReferenceData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la correction du solde");
    }
  }

  async function save() {
    if (!character || !id) return;
    // Bloque l'enregistrement si l'édition en cours dépasse le budget de
    // points — le solde négatif doit être résolu (ajuster la fiche, ou
    // demander au MJ un octroi d'XP / d'accepter le déficit via
    // BudgetPanel, disponibles même hors édition) avant de sauvegarder.
    if (computed.budget.solde < 0) {
      setError("Solde négatif : ajustez la fiche avant d'enregistrer (ou demandez au MJ de l'XP ou d'accepter le déficit).");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { character: saved, referenceData: savedReferenceData } = await api.updateCharacter(id, character);
      setCharacter(saved);
      setReferenceData(savedReferenceData);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la sauvegarde");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-dvh">
      {/* Bandeau de fond en haut de fiche uniquement — dégradé vers la
          couleur de fond (slate-950) pour rester lisible et se fondre avec
          le reste de la page, qui garde le fond uni. */}
      <div
        className="bg-cover bg-center bg-no-repeat"
        style={{
          backgroundImage: `linear-gradient(to bottom, rgba(2,6,23,.55), rgba(2,6,23,.93)), url('${groupImageUrl ?? "/r2t2-banner.jpg"}')`,
        }}
      >
        <div className="mx-auto max-w-3xl space-y-4 px-4 pb-8 pt-6">
          <header className="flex items-center justify-between">
            <Link to={backTo} className="text-sm text-indigo-400 hover:underline">
              {backLabel}
            </Link>
            {canEdit &&
              (editing ? (
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditing(false)}
                    className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-700"
                  >
                    {t("Annuler")}
                  </button>
                  <button
                    onClick={save}
                    disabled={saving || computed.budget.solde < 0}
                    title={computed.budget.solde < 0 ? "Solde négatif — ajustez la fiche avant d'enregistrer" : undefined}
                    className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                  >
                    {saving ? t("Enregistrement…") : t("Enregistrer")}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setEditing(true)}
                  className="rounded-lg bg-slate-800 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-700"
                >
                  {t("Modifier")}
                </button>
              ))}
          </header>

          {error && <p className="text-red-400">{error}</p>}

          <IdentityHeader character={character} editing={editing} update={update} referenceData={referenceData} />
        </div>
      </div>

      <div className="mx-auto max-w-3xl space-y-4 px-4 pb-16 pt-4">
        <HpPspBar character={character} computed={computed} onAdjust={adjustVital} />
      <AttributesPanel character={character} computed={computed} editing={editing} update={update} referenceData={referenceData} />
      <SkillsPanel character={character} computed={computed} editing={editing} update={update} referenceData={referenceData} />
      <WeaponsArmorPanel
        character={character}
        computed={computed}
        editing={editing}
        canEdit={canEdit}
        update={update}
        onToggleArmor={toggleArmor}
        onToggleWeaponEquipped={toggleWeaponEquipped}
        referenceData={referenceData}
      />
      <PsyPowersPanel
        character={character}
        computed={computed}
        editing={editing}
        canEdit={canEdit}
        update={update}
        onSetActivePower={setActivePower}
        referenceData={referenceData}
      />
      <AdvantagesPanel character={character} editing={editing} update={update} referenceData={referenceData} />
      <EquipmentPanel character={character} editing={editing} update={update} />
      <BudgetPanel
        character={character}
        computed={computed}
        isGm={isGm}
        onGrantXp={handleGrantXp}
        onGrantCredits={handleGrantCredits}
        onAcceptDeficit={handleAcceptDeficit}
      />
      </div>
    </div>
  );
}
