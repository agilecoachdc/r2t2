// Page "Mon profil" — accessible à tout rôle (admin/gm/player). Montre
// l'identité du compte et les groupes dont il est membre (un joueur ou un
// MJ peut désormais appartenir à plusieurs groupes en même temps, cf.
// migrations/0005_memberships.sql), avec la règle/le jeu de chacun. Un
// admin (aucun groupe) voit un message dédié plutôt qu'une liste vide.
//
// Joueurs et MJ peuvent aussi y demander à rejoindre un groupe existant
// (n'accorde plus l'accès immédiatement : la demande reste 'pending'
// jusqu'à ce qu'un MJ du groupe l'approuve, cf.
// migrations/0006_join_approval.sql — affichée ici avec un badge "En
// attente d'approbation") ou quitter un groupe (annule aussi une demande en
// attente), et un MJ peut y créer un nouveau groupe (nom, image, dossier
// Drive, règle) — cf. routes/catalog.ts (self-service, distinct des routes
// CRUD complètes /api/admin/*).
//
// Langue de l'interface (cf. migrations/0007_language.sql,
// PublicUser.language) : sélecteur ci-dessous, self-service via
// PUT /api/profile/language — seul champ que le compte modifie lui-même
// sur son propre profil hors de ce qui existait déjà.

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Language, PlayerGroup, ProfileInfo, Ruleset } from "@shared/types";
import { useAuth } from "../lib/auth-context";
import { api } from "../lib/api";
import { useTranslation } from "../lib/i18n";
import { GroupThumb } from "../components/GroupThumb";
import { ImagePicker } from "../components/ImagePicker";

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrateur",
  gm: "Maître du jeu",
  player: "Joueur",
};

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : "Erreur";
}

export default function Profile() {
  const { user, refreshUser } = useAuth();
  const { t } = useTranslation();
  const [info, setInfo] = useState<ProfileInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [languageBusy, setLanguageBusy] = useState(false);

  const [groups, setGroups] = useState<PlayerGroup[]>([]);
  const [rulesets, setRulesets] = useState<Ruleset[]>([]);
  const [busyGroupId, setBusyGroupId] = useState<string | null>(null);

  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newRulesetId, setNewRulesetId] = useState("");
  const [newImageUrl, setNewImageUrl] = useState<string | null>(null);
  const [newDriveUrl, setNewDriveUrl] = useState("");
  const [creating, setCreating] = useState(false);

  const canJoinOrCreate = user?.role === "player" || user?.role === "gm";

  function loadProfile() {
    return api
      .getProfile()
      .then(setInfo)
      .catch((err) => setError(errMsg(err)));
  }

  function loadCatalog() {
    if (!canJoinOrCreate) return;
    Promise.all([api.browseGroups(), api.browseRulesets()])
      .then(([{ groups }, { rulesets }]) => {
        setGroups(groups);
        setRulesets(rulesets);
      })
      .catch((err) => setError(errMsg(err)));
  }

  useEffect(() => {
    loadProfile();
    loadCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleLanguageChange(language: Language) {
    setError(null);
    setLanguageBusy(true);
    try {
      await api.updateLanguage(language);
      await refreshUser();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLanguageBusy(false);
    }
  }

  async function handleJoin(groupId: string) {
    setError(null);
    setBusyGroupId(groupId);
    try {
      await api.joinGroup(groupId);
      await refreshUser();
      await loadProfile();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusyGroupId(null);
    }
  }

  async function handleLeave(groupId: string) {
    setError(null);
    setBusyGroupId(groupId);
    try {
      await api.leaveGroup(groupId);
      await refreshUser();
      await loadProfile();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusyGroupId(null);
    }
  }

  async function handleCreateGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim() || !newRulesetId) return;
    setCreating(true);
    setError(null);
    try {
      await api.createGroupSelf({
        name: newName.trim(),
        description: newDescription.trim(),
        rulesetId: newRulesetId,
        imageUrl: newImageUrl,
        driveUrl: newDriveUrl.trim() || null,
      });
      setNewName("");
      setNewDescription("");
      setNewRulesetId("");
      setNewImageUrl(null);
      setNewDriveUrl("");
      await refreshUser();
      await loadProfile();
      loadCatalog();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setCreating(false);
    }
  }

  const joinedIds = new Set(info?.memberships.map((m) => m.group.id));
  const joinableGroups = groups.filter((g) => !joinedIds.has(g.id));

  return (
    <div
      className="min-h-dvh bg-cover bg-center bg-no-repeat"
      style={{ backgroundImage: "linear-gradient(rgba(2,6,23,.82), rgba(2,6,23,.82)), url('/r2t2-banner.jpg')" }}
    >
      <div className="mx-auto max-w-2xl px-4 py-6">
        <header className="mb-6 flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold">{t("Mon profil")}</h1>
          <Link to="/" className="text-sm text-indigo-400 hover:underline">
            {t("← Retour")}
          </Link>
        </header>

        {error && <p className="mb-4 text-red-400">{error}</p>}
        {!info && !error && <p className="text-slate-400">{t("Chargement…")}</p>}

        {info && (
          <div className="space-y-4">
            <section className="rounded-xl bg-slate-900 p-4 shadow">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">{t("Identité")}</h2>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-slate-500">{t("Nom")}</dt>
                  <dd className="text-slate-200">{info.user.displayName}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">{t("Identifiant")}</dt>
                  <dd className="text-slate-200">{info.user.username}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">{t("Rôle")}</dt>
                  <dd className="text-slate-200">{t(ROLE_LABELS[info.user.role] ?? info.user.role)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">{t("Langue de l'interface")}</dt>
                  <dd>
                    <select
                      value={user?.language ?? "fr"}
                      onChange={(e) => handleLanguageChange(e.target.value as Language)}
                      disabled={languageBusy}
                      className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-slate-200 disabled:opacity-50"
                    >
                      <option value="fr">{t("Français")}</option>
                      <option value="en">{t("Anglais")}</option>
                    </select>
                  </dd>
                </div>
                {user?.characterId && (
                  <div>
                    <dt className="text-slate-500">{t("Personnage")}</dt>
                    <dd>
                      <Link to={`/personnages/${user.characterId}`} className="text-indigo-400 hover:underline">
                        {t("Voir la fiche")}
                      </Link>
                    </dd>
                  </div>
                )}
              </dl>
            </section>

            <section className="rounded-xl bg-slate-900 p-4 shadow">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">{t("Mes parties")}</h2>
              {info.memberships.length > 0 ? (
                <ul className="space-y-3">
                  {info.memberships.map(({ group, ruleset, game, status }) => (
                    <li key={group.id} className="flex gap-3 rounded-lg bg-slate-800/50 p-3">
                      <GroupThumb url={group.imageUrl} name={group.name} />
                      <dl className="grid flex-1 grid-cols-2 gap-2 text-sm">
                        <div className="col-span-2 flex items-center gap-2">
                          <dt className="sr-only">{t("Parties")}</dt>
                          <dd className="text-slate-200">{group.name}</dd>
                          {status === "pending" && (
                            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-300">
                              {t("En attente d'approbation du MJ")}
                            </span>
                          )}
                        </div>
                        <div>
                          <dt className="text-slate-500">{t("Jeu")}</dt>
                          <dd className="text-slate-200">{game?.name ?? "—"}</dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">{t("Règle")}</dt>
                          <dd className="text-slate-200">{ruleset?.name ?? "—"}</dd>
                        </div>
                        {group.description && (
                          <div className="col-span-2">
                            <dt className="text-slate-500">{t("Description")}</dt>
                            <dd className="text-slate-300">{group.description}</dd>
                          </div>
                        )}
                      </dl>
                      <button
                        type="button"
                        onClick={() => handleLeave(group.id)}
                        disabled={busyGroupId === group.id}
                        className="shrink-0 self-start text-xs text-slate-500 hover:text-red-400 disabled:opacity-50"
                      >
                        {busyGroupId === group.id ? "…" : t(status === "pending" ? "Annuler la demande" : "Quitter")}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-500">
                  {t(
                    info.user.role === "admin"
                      ? "Compte administrateur — pas de groupe de joueurs assigné."
                      : "Vous n'êtes membre d'aucun groupe pour l'instant.",
                  )}
                </p>
              )}
            </section>

            {canJoinOrCreate && (
              <section className="rounded-xl bg-slate-900 p-4 shadow">
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
                  {t("Demander à rejoindre un groupe")}
                </h2>
                {joinableGroups.length === 0 && (
                  <p className="text-sm text-slate-500">{t("Aucun autre groupe disponible.")}</p>
                )}
                <ul className="space-y-2">
                  {joinableGroups.map((g) => (
                    <li key={g.id} className="flex items-center gap-3 rounded-lg bg-slate-800/50 p-2">
                      <GroupThumb url={g.imageUrl} name={g.name} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-100">{g.name}</p>
                        {g.description && <p className="truncate text-xs text-slate-500">{g.description}</p>}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleJoin(g.id)}
                        disabled={busyGroupId === g.id}
                        className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                      >
                        {busyGroupId === g.id ? "…" : t("Demander")}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {user?.role === "gm" && (
              <section className="rounded-xl bg-slate-900 p-4 shadow">
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
                  {t("Créer un nouveau groupe")}
                </h2>
                <form onSubmit={handleCreateGroup} className="space-y-3">
                  <div className="flex items-start gap-4">
                    <ImagePicker value={newImageUrl} onChange={setNewImageUrl} sizePx={80} />
                    <div className="flex-1 space-y-2">
                      <input
                        type="text"
                        required
                        placeholder={t("Nom du groupe")}
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm"
                      />
                      <input
                        type="text"
                        placeholder={t("Description (optionnel)")}
                        value={newDescription}
                        onChange={(e) => setNewDescription(e.target.value)}
                        className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm"
                      />
                      <input
                        type="url"
                        placeholder={t("Lien du dossier Drive (optionnel)")}
                        value={newDriveUrl}
                        onChange={(e) => setNewDriveUrl(e.target.value)}
                        className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm"
                      />
                      <select
                        required
                        value={newRulesetId}
                        onChange={(e) => setNewRulesetId(e.target.value)}
                        className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm"
                      >
                        <option value="">{t("— Règle —")}</option>
                        {rulesets.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={creating}
                    className="w-full rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                  >
                    {creating ? t("Création…") : t("Créer et rejoindre")}
                  </button>
                </form>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
