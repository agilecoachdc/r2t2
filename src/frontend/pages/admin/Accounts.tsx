// Page d'admin "Comptes" — vue d'ensemble de tous les comptes de la
// plateforme, de leur rôle, et des groupes dont ils sont membres (un compte
// peut désormais appartenir à plusieurs groupes en même temps, cf.
// migrations/0005_memberships.sql — l'affectation aux groupes se gère
// depuis la page Groupes, PlayerGroups.tsx ; cette page se concentre sur le
// rôle et la vue d'ensemble des appartenances).
//
// Existe aussi pour repérer rapidement une rétrogradation accidentelle :
// affecter un compte à un groupe force son rôle en joueur/MJ — utilisé par
// erreur sur un compte admin, ça le rétrograde silencieusement (incident du
// 18/08). PlayerGroups.tsx exclut désormais les comptes admin de son
// sélecteur d'assignation ; cette page permet en plus de voir tous les
// comptes d'un coup d'œil et de corriger un rôle directement.
//
// Permet aussi de réinitialiser le mot de passe d'un compte (joueur oublieux)
// en saisissant le nouveau — cf. PUT /api/admin/users/:id/password, qui ferme
// les sessions ouvertes de ce compte.

import { useEffect, useState } from "react";
import type { PlayerGroup, PublicUser, UserRole } from "@shared/types";
import { api } from "../../lib/api";
import { AdminNav } from "../../components/AdminNav";
import { useTranslation } from "../../lib/i18n";

// Valeurs en français : servent de clé au dictionnaire i18n (cf.
// src/frontend/lib/i18n.ts), traduites via t() au point d'affichage — même
// principe que Profile.tsx ROLE_LABELS. Page admin sinon non traduite
// (hors périmètre actuel), seuls les libellés de rôle le sont ici.
const ROLE_LABELS: Record<UserRole, string> = { admin: "Admin", gm: "MJ", player: "Joueur" };

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : "Erreur";
}

export default function Accounts() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [groups, setGroups] = useState<PlayerGroup[]>([]);
  const [drafts, setDrafts] = useState<Record<string, UserRole>>({});
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, string>>({});
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function loadAll() {
    return Promise.all([api.listUsers(), api.listGroups()])
      .then(([{ users }, { groups }]) => {
        setUsers(users);
        setGroups(groups);
        setDrafts(Object.fromEntries(users.map((u) => [u.id, u.role])));
      })
      .catch((err) => setError(errMsg(err)));
  }

  useEffect(() => {
    loadAll();
  }, []);

  function groupNames(ids: string[]): string {
    if (ids.length === 0) return "—";
    return ids.map((id) => groups.find((g) => g.id === id)?.name ?? id).join(", ");
  }

  async function handleSave(id: string) {
    const role = drafts[id];
    if (!role) return;
    setSavingId(id);
    setError(null);
    try {
      await api.updateUser(id, { role });
      await loadAll();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setSavingId(null);
    }
  }

  async function handleResetPassword(u: PublicUser) {
    const password = passwordDrafts[u.id] ?? "";
    if (password.length < 8) {
      setError("Mot de passe trop court (8 caractères minimum)");
      return;
    }
    setResettingId(u.id);
    setError(null);
    setNotice(null);
    try {
      await api.resetUserPassword(u.id, password);
      setPasswordDrafts((d) => ({ ...d, [u.id]: "" }));
      setNotice(`Mot de passe de « ${u.username} » réinitialisé — à lui communiquer hors-ligne.`);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setResettingId(null);
    }
  }

  const sorted = [...users].sort((a, b) => a.displayName.localeCompare(b.displayName));

  return (
    <div className="min-h-dvh bg-slate-950">
      <div className="mx-auto max-w-4xl px-4 py-6">
        <header className="mb-6 flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold">Comptes</h1>
          <AdminNav current="comptes" />
        </header>

        {error && <p className="mb-4 text-red-400">{error}</p>}
        {notice && <p className="mb-4 text-emerald-400">{notice}</p>}
        <p className="mb-4 text-sm text-slate-500">
          L'appartenance aux groupes se gère depuis la page « Groupes » (assigner/retirer un membre). Cette page ne
          modifie que le rôle du compte et, si besoin, son mot de passe (saisir le nouveau puis « Réinitialiser » —
          le joueur est déconnecté de ses sessions en cours).
        </p>

        <div className="overflow-x-auto rounded-xl bg-slate-900 shadow">
          <table className="w-full min-w-max border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2">Nom</th>
                <th className="px-4 py-2">Identifiant</th>
                <th className="px-4 py-2">Rôle</th>
                <th className="px-4 py-2">Groupes</th>
                <th className="px-4 py-2" />
                <th className="px-4 py-2">Nouveau mot de passe</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((u) => {
                const draft = drafts[u.id] ?? u.role;
                const dirty = draft !== u.role;
                return (
                  <tr key={u.id} className="border-t border-slate-800">
                    <td className="px-4 py-2 text-slate-200">{u.displayName}</td>
                    <td className="px-4 py-2 text-slate-400">{u.username}</td>
                    <td className="px-4 py-2">
                      <select
                        value={draft}
                        onChange={(e) => setDrafts((d) => ({ ...d, [u.id]: e.target.value as UserRole }))}
                        className="rounded border border-slate-700 bg-slate-800 px-2 py-1"
                      >
                        {(Object.keys(ROLE_LABELS) as UserRole[]).map((role) => (
                          <option key={role} value={role}>
                            {t(ROLE_LABELS[role])}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2 text-slate-400">{groupNames(u.memberships)}</td>
                    <td className="px-4 py-2 text-right">
                      <button
                        type="button"
                        onClick={() => handleSave(u.id)}
                        disabled={!dirty || savingId === u.id}
                        className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
                      >
                        {savingId === u.id ? "…" : "Enregistrer"}
                      </button>
                    </td>
                    <td className="px-4 py-2">
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          handleResetPassword(u);
                        }}
                        className="flex items-center gap-2"
                      >
                        <input
                          type="text"
                          autoComplete="off"
                          value={passwordDrafts[u.id] ?? ""}
                          onChange={(e) => setPasswordDrafts((d) => ({ ...d, [u.id]: e.target.value }))}
                          placeholder="8 caractères min."
                          className="w-40 rounded border border-slate-700 bg-slate-800 px-2 py-1 font-mono"
                        />
                        <button
                          type="submit"
                          disabled={!passwordDrafts[u.id] || resettingId === u.id}
                          className="rounded-lg bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-500 disabled:opacity-40"
                        >
                          {resettingId === u.id ? "…" : "Réinitialiser"}
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-3 text-sm text-slate-500">
                    Aucun compte.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
