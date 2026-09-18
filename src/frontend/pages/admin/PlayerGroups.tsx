// Page d'admin "Groupes" — CRUD des groupes de joueurs (nom, description,
// règle assignée, image, dossier Drive) et gestion de leurs membres :
// assigner un compte existant au groupe, en créer un nouveau directement
// rattaché, ou en retirer un. Un compte peut être membre de plusieurs
// groupes en même temps (cf. migrations/0005_memberships.sql) — le rôle
// (gm/player) reste global au compte, ces routes ne gèrent que
// l'appartenance. Réservée au rôle admin (route protégée côté App.tsx +
// API /api/admin/*).

import { useEffect, useState } from "react";
import type { PlayerGroupDetail, PublicUser, Ruleset, UserRole } from "@shared/types";
import { api } from "../../lib/api";
import { ImagePicker } from "../../components/ImagePicker";
import { AdminNav } from "../../components/AdminNav";
import { useTranslation } from "../../lib/i18n";

// Valeurs en français : servent de clé au dictionnaire i18n (cf.
// src/frontend/lib/i18n.ts), traduites via t() au point d'affichage — même
// principe que Profile.tsx ROLE_LABELS. Page admin sinon non traduite
// (hors périmètre actuel), seuls les libellés de rôle le sont ici.
const ROLE_LABELS: Record<UserRole, string> = { admin: "Admin", gm: "MJ", player: "Joueur" };

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

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : "Erreur";
}

export default function PlayerGroups() {
  const { t } = useTranslation();
  const [groups, setGroups] = useState<PlayerGroupDetail[]>([]);
  const [rulesets, setRulesets] = useState<Ruleset[]>([]);
  const [allUsers, setAllUsers] = useState<PublicUser[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastPassword, setLastPassword] = useState<{ username: string; password: string } | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [rulesetId, setRulesetId] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [driveUrl, setDriveUrl] = useState("");

  const [newUsername, setNewUsername] = useState("");
  const [newDisplayName, setNewDisplayName] = useState("");
  const [newRole, setNewRole] = useState<UserRole>("player");
  const [assignUserId, setAssignUserId] = useState("");

  function loadAll() {
    return Promise.all([
      api.listGroups().then(({ groups }) => Promise.all(groups.map((g) => api.getGroup(g.id).then((r) => r.group)))),
      api.listRulesets(),
      api.listUsers(),
    ])
      .then(([groupDetails, { rulesets }, { users }]) => {
        setGroups(groupDetails);
        setRulesets(rulesets);
        setAllUsers(users);
      })
      .catch((err) => setError(errMsg(err)));
  }

  useEffect(() => {
    loadAll();
  }, []);

  const selected = groups.find((g) => g.id === selectedId) ?? null;
  // Un compte admin n'appartient à aucun groupe (cf. lib/session.ts /
  // routes/admin.ts) — l'exclure ici. Un compte déjà membre du groupe
  // sélectionné n'a plus besoin d'être ré-assignable (INSERT OR IGNORE
  // côté serveur le rendrait de toute façon sans effet).
  const unassignedUsers = allUsers.filter((u) => u.role !== "admin" && !u.memberships.includes(selectedId ?? ""));

  async function handleCreateGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !rulesetId) return;
    try {
      const { group } = await api.createGroup({
        name: name.trim(),
        description: description.trim(),
        rulesetId,
        imageUrl,
        driveUrl: driveUrl.trim() || null,
      });
      setName("");
      setDescription("");
      setRulesetId("");
      setImageUrl(null);
      setDriveUrl("");
      await loadAll();
      setSelectedId(group.id);
    } catch (err) {
      setError(errMsg(err));
    }
  }

  async function handleDeleteGroup(id: string) {
    try {
      await api.deleteGroup(id);
      if (selectedId === id) setSelectedId(null);
      await loadAll();
    } catch (err) {
      setError(errMsg(err));
    }
  }

  async function handleSaveGroup() {
    if (!selected) return;
    try {
      await api.updateGroup(selected.id, {
        name: selected.name,
        description: selected.description,
        rulesetId: selected.rulesetId,
        imageUrl: selected.imageUrl,
        driveUrl: selected.driveUrl,
      });
      await loadAll();
    } catch (err) {
      setError(errMsg(err));
    }
  }

  function updateSelected(patch: Partial<PlayerGroupDetail>) {
    setGroups((gs) => gs.map((g) => (g.id === selectedId ? { ...g, ...patch } : g)));
  }

  async function handleCreateUserInGroup(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !newUsername.trim() || !newDisplayName.trim()) return;
    setError(null);
    try {
      const { user, password } = await api.createUser({
        username: newUsername.trim(),
        displayName: newDisplayName.trim(),
        role: newRole,
        groupId: selected.id,
      });
      setLastPassword({ username: user.username, password });
      setNewUsername("");
      setNewDisplayName("");
      setNewRole("player");
      await loadAll();
    } catch (err) {
      setError(errMsg(err));
    }
  }

  async function handleAssignExisting(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !assignUserId) return;
    try {
      await api.addGroupMember(selected.id, assignUserId);
      setAssignUserId("");
      await loadAll();
    } catch (err) {
      setError(errMsg(err));
    }
  }

  async function handleRemoveMember(userId: string) {
    if (!selected) return;
    try {
      await api.removeGroupMember(selected.id, userId);
      await loadAll();
    } catch (err) {
      setError(errMsg(err));
    }
  }

  // Réassigne le propriétaire d'un personnage du groupe à un membre — cf.
  // api.assignCharacterOwner (met à jour characters.owner_username, la
  // source de vérité pour les permissions d'édition et le badge "Ma
  // fiche", cf. routes/admin.ts PUT /characters/:id/owner).
  async function handleAssignCharacter(characterId: string, userId: string) {
    try {
      await api.assignCharacterOwner(characterId, userId);
      await loadAll();
    } catch (err) {
      setError(errMsg(err));
    }
  }

  return (
    <div className="min-h-dvh bg-slate-950">
      <div className="mx-auto max-w-4xl px-4 py-6">
        <header className="mb-6 flex items-center justify-between gap-3">
          <h1 className="text-lg font-semibold">Groupes de joueurs</h1>
          <AdminNav current="groupes" />
        </header>

        {error && <p className="mb-4 text-red-400">{error}</p>}
        {lastPassword && (
          <p className="mb-4 rounded-lg bg-emerald-950 px-3 py-2 text-sm text-emerald-300">
            Compte « {lastPassword.username} » créé — mot de passe : <span className="font-mono">{lastPassword.password}</span>{" "}
            (à communiquer hors-ligne, ne sera plus affiché).
          </p>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <section className="rounded-xl bg-slate-900 p-4 shadow md:col-span-1">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Groupes</h2>
            <ul className="mb-3 space-y-1">
              {groups.map((g) => (
                <li key={g.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(g.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm ${
                      selectedId === g.id ? "bg-indigo-600 text-white" : "bg-slate-800 text-slate-200 hover:bg-slate-700"
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {g.imageUrl ? (
                        <img src={g.imageUrl} alt="" className="h-6 w-6 shrink-0 rounded object-cover" />
                      ) : (
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-slate-700 text-xs">{g.name.charAt(0)}</span>
                      )}
                      <span className="truncate">
                        {g.name} <span className="text-xs opacity-70">({g.members.length})</span>
                      </span>
                    </span>
                    <span
                      role="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteGroup(g.id);
                      }}
                      className="shrink-0 text-slate-400 hover:text-red-400"
                      aria-label={`Supprimer ${g.name}`}
                    >
                      ×
                    </span>
                  </button>
                </li>
              ))}
              {groups.length === 0 && <p className="text-sm text-slate-500">Aucun groupe.</p>}
            </ul>
            <form onSubmit={handleCreateGroup} className="space-y-2">
              <div className="flex items-start gap-3">
                <ImagePicker value={imageUrl} onChange={setImageUrl} sizePx={64} />
                <div className="flex-1 space-y-2">
                  <TextInput value={name} onChange={setName} className="w-full" />
                  <TextInput value={description} onChange={setDescription} className="w-full" />
                  <input
                    type="url"
                    placeholder="Lien du dossier Drive (optionnel)"
                    value={driveUrl}
                    onChange={(e) => setDriveUrl(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm"
                  />
                  <select
                    value={rulesetId}
                    onChange={(e) => setRulesetId(e.target.value)}
                    className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm"
                  >
                    <option value="">— Règle —</option>
                    {rulesets.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <button type="submit" className="w-full rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">
                + Nouveau groupe
              </button>
            </form>
          </section>

          <section className="rounded-xl bg-slate-900 p-4 shadow md:col-span-2">
            {!selected && <p className="text-sm text-slate-500">Choisissez un groupe.</p>}
            {selected && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Réglages</h2>
                  <ImagePicker
                    value={selected.imageUrl}
                    onChange={(v) => updateSelected({ imageUrl: v })}
                    sizePx={80}
                  />
                  <TextInput value={selected.name} onChange={(v) => updateSelected({ name: v })} className="w-full" />
                  <TextInput value={selected.description} onChange={(v) => updateSelected({ description: v })} className="w-full" />
                  <input
                    type="url"
                    placeholder="Lien du dossier Drive (optionnel)"
                    value={selected.driveUrl ?? ""}
                    onChange={(e) => updateSelected({ driveUrl: e.target.value || null })}
                    className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm"
                  />
                  <select
                    value={selected.rulesetId}
                    onChange={(e) => updateSelected({ rulesetId: e.target.value })}
                    className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm"
                  >
                    {rulesets.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleSaveGroup}
                    className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
                  >
                    Enregistrer
                  </button>
                </div>

                <div>
                  <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">Membres</h2>
                  <ul className="space-y-1">
                    {selected.members.map((m) => (
                      <li key={m.id} className="flex items-center justify-between rounded-lg bg-slate-800/50 px-3 py-2 text-sm">
                        <span>
                          {m.displayName} <span className="text-slate-500">({m.username})</span> ·{" "}
                          <span className="text-slate-400">{t(ROLE_LABELS[m.role])}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRemoveMember(m.id)}
                          className="text-xs text-slate-500 hover:text-red-400"
                        >
                          Retirer du groupe
                        </button>
                      </li>
                    ))}
                    {selected.members.length === 0 && <p className="text-sm text-slate-500">Aucun membre.</p>}
                  </ul>
                </div>

                <div>
                  <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">Personnages</h2>
                  <ul className="space-y-1">
                    {selected.characters.map((ch) => {
                      // Membre actuellement propriétaire (owner_username, source de vérité — cf.
                      // lib/session.ts canEditCharacter) — absent des options si le propriétaire
                      // actuel n'est plus/pas membre de CE groupe (ex. personnage mal rattaché) ;
                      // le nom d'utilisateur brut reste affiché à côté pour le repérer quand même.
                      const ownerMember = selected.members.find((m) => m.username === ch.ownerUsername);
                      return (
                        <li key={ch.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-800/50 px-3 py-2 text-sm">
                          <span className="text-slate-200">
                            {ch.name} <span className="text-xs text-slate-500">({ch.ownerUsername})</span>
                          </span>
                          <select
                            value={ownerMember?.id ?? ""}
                            onChange={(e) => {
                              if (e.target.value) handleAssignCharacter(ch.id, e.target.value);
                            }}
                            className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200"
                          >
                            <option value="">— choisir un joueur —</option>
                            {selected.members.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.displayName} ({m.username})
                              </option>
                            ))}
                          </select>
                        </li>
                      );
                    })}
                    {selected.characters.length === 0 && <p className="text-sm text-slate-500">Aucun personnage dans ce groupe.</p>}
                  </ul>
                </div>

                <form onSubmit={handleAssignExisting} className="space-y-2 rounded-lg bg-slate-800/50 p-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Assigner un compte existant</h3>
                  <div className="flex flex-wrap gap-2">
                    <select
                      value={assignUserId}
                      onChange={(e) => setAssignUserId(e.target.value)}
                      className="flex-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm"
                    >
                      <option value="">— Compte —</option>
                      {unassignedUsers.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.displayName} ({u.username}) — {t(ROLE_LABELS[u.role])}
                        </option>
                      ))}
                    </select>
                    <button type="submit" className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">
                      Assigner
                    </button>
                  </div>
                </form>

                <form onSubmit={handleCreateUserInGroup} className="space-y-2 rounded-lg bg-slate-800/50 p-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Créer un nouveau compte</h3>
                  <div className="flex flex-wrap gap-2">
                    <TextInput value={newUsername} onChange={setNewUsername} className="flex-1" />
                    <TextInput value={newDisplayName} onChange={setNewDisplayName} className="flex-1" />
                    <select
                      value={newRole}
                      onChange={(e) => setNewRole(e.target.value as UserRole)}
                      className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm"
                    >
                      <option value="player">{t(ROLE_LABELS.player)}</option>
                      <option value="gm">{t(ROLE_LABELS.gm)}</option>
                    </select>
                    <button type="submit" className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">
                      Créer
                    </button>
                  </div>
                  <p className="text-xs text-slate-500">Identifiant, puis nom affiché.</p>
                </form>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
