// Écran "Personnages" d'un groupe — deuxième étage de la navigation
// (Accueil "Parties" -> ce groupe -> personnages -> Suivi des constantes),
// cf. Home.tsx. Le groupe vient de l'URL (/groupe/:groupId) — un compte
// peut être membre de plusieurs groupes en même temps (cf.
// migrations/0005_memberships.sql), il n'y a plus de "groupe courant"
// implicite. Un admin (aucun groupe) n'atteint jamais cette route. Le MJ y
// voit aussi les demandes d'adhésion en attente d'approbation pour ce
// groupe (cf. migrations/0006_join_approval.sql) — un joueur qui demande à
// rejoindre n'a accès à rien tant que le MJ n'a pas approuvé.

import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { CharacterSummary, JoinRequest, ReferenceData } from "@shared/types";
import { useAuth } from "../lib/auth-context";
import { api } from "../lib/api";
import { canAccessGroup, isGmOfGroup } from "@shared/permissions";
import { useTranslation } from "../lib/i18n";

export default function CharacterList() {
  const { groupId } = useParams<{ groupId: string }>();
  const { user, logout } = useAuth();
  const { t } = useTranslation();
  const [rows, setRows] = useState<CharacterSummary[] | null>(null);
  // Catalogue du groupe — renvoyé par GET /characters (scopé serveur), plus
  // d'import statique ADD40K (cf. lib/reference.ts).
  const [referenceData, setReferenceData] = useState<ReferenceData | null>(null);
  // Image et dossier Drive du groupe — remplacent le fond et le lien Drive
  // ADD40K en dur : chaque groupe ont les siens (cf.
  // migrations/0004_images.sql, 0005_memberships.sql), plateforme par
  // défaut si non renseignés.
  const [groupImageUrl, setGroupImageUrl] = useState<string | null>(null);
  const [groupDriveUrl, setGroupDriveUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  // Demandes d'adhésion en attente pour ce groupe — MJ uniquement (cf.
  // migrations/0006_join_approval.sql). Un joueur qui demande à rejoindre
  // n'a aucun accès tant que le MJ n'a pas approuvé ; c'est donc bien le MJ,
  // pas l'admin, qui gère ce flux au quotidien.
  const [joinRequests, setJoinRequests] = useState<JoinRequest[] | null>(null);
  const [requestBusyId, setRequestBusyId] = useState<string | null>(null);
  // Un admin a accès à tous les groupes avec les droits MJ, sans en être
  // membre (cf. shared/permissions.ts).
  const isMember = !!user && canAccessGroup(user, groupId);
  const isGm = !!user && isGmOfGroup(user, groupId);
  const backgroundUrl = groupImageUrl ?? "/r2t2-banner.jpg";

  function raceLabel(race: string) {
    return referenceData?.races.find((r) => r.race === race)?.label ?? race;
  }

  // Un seul input file caché, réutilisé pour toutes les tuiles — on retient
  // quelle fiche est visée dans une ref (pas de state, pas besoin de re-render).
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importTargetId = useRef<string | null>(null);

  function loadCharacters() {
    if (!groupId || !isMember) return Promise.resolve();
    return api
      .listCharacters(groupId)
      .then(({ characters, referenceData, groupImageUrl, groupDriveUrl }) => {
        setRows(characters);
        setReferenceData(referenceData);
        setGroupImageUrl(groupImageUrl);
        setGroupDriveUrl(groupDriveUrl);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Erreur"));
  }

  function loadJoinRequests() {
    if (!groupId || !isGm) return Promise.resolve();
    return api
      .listJoinRequests(groupId)
      .then(({ requests }) => setJoinRequests(requests))
      .catch((err) => setError(err instanceof Error ? err.message : "Erreur"));
  }

  useEffect(() => {
    loadCharacters();
    loadJoinRequests();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, isMember, isGm]);

  async function handleApproveRequest(userId: string) {
    if (!groupId) return;
    setRequestBusyId(userId);
    setError(null);
    try {
      await api.approveJoinRequest(groupId, userId);
      await loadJoinRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'approbation");
    } finally {
      setRequestBusyId(null);
    }
  }

  async function handleRejectRequest(userId: string) {
    if (!groupId) return;
    setRequestBusyId(userId);
    setError(null);
    try {
      await api.rejectJoinRequest(groupId, userId);
      await loadJoinRequests();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec du rejet");
    } finally {
      setRequestBusyId(null);
    }
  }

  // Bascule le statut "en jeu" et sauvegarde immédiatement (MJ uniquement),
  // même principe que le toggle d'armure sur la fiche : pas de mode édition
  // à ouvrir pour ça.
  async function toggleInGame(row: CharacterSummary) {
    if (!rows) return;
    const nextInGame = !row.inGame;
    setRows(rows.map((r) => (r.id === row.id ? { ...r, inGame: nextInGame } : r)));
    try {
      await api.updateCharacter(row.id, { inGame: nextInGame });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de la sauvegarde du statut en jeu");
      setRows((current) => current?.map((r) => (r.id === row.id ? { ...r, inGame: row.inGame } : r)) ?? current);
    }
  }

  // Bascule joueur <-> PNJ (MJ uniquement), même principe optimiste que
  // toggleInGame ci-dessus.
  async function toggleIsNpc(row: CharacterSummary) {
    if (!rows) return;
    const nextIsNpc = !row.isNpc;
    setRows(rows.map((r) => (r.id === row.id ? { ...r, isNpc: nextIsNpc } : r)));
    try {
      await api.updateCharacter(row.id, { isNpc: nextIsNpc });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec du changement de statut joueur/PNJ");
      setRows((current) => current?.map((r) => (r.id === row.id ? { ...r, isNpc: row.isNpc } : r)) ?? current);
    }
  }

  // Archive/désarchive (MJ uniquement) : masque la fiche des écrans
  // "Personnages" et "Suivi des constantes" sans la supprimer.
  async function setArchived(row: CharacterSummary, archived: boolean) {
    if (!rows) return;
    setRows(rows.map((r) => (r.id === row.id ? { ...r, archived } : r)));
    try {
      await api.updateCharacter(row.id, { archived });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'archivage");
      setRows((current) => current?.map((r) => (r.id === row.id ? { ...r, archived: row.archived } : r)) ?? current);
    }
  }

  // Export App -> Excel : charge le template embarqué (public/character-template.xlsx,
  // une copie allégée du classeur de Conrad — sans images, cf. src/frontend/lib/xlsxSync.ts),
  // y écrit les données actuelles du personnage, déclenche le téléchargement.
  async function handleExport(id: string, name: string) {
    setError(null);
    setBusyId(id);
    try {
      const [{ character, referenceData }, XLSX, templateRes] = await Promise.all([
        api.getCharacter(id),
        import("xlsx"),
        fetch("/character-template.xlsx"),
      ]);
      if (!templateRes.ok) throw new Error("Template Excel introuvable");
      const buf = await templateRes.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const { applyCharacterToWorkbook } = await import("../lib/xlsxSync");
      applyCharacterToWorkbook(wb, character, referenceData);
      const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
      const blob = new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'export");
    } finally {
      setBusyId(null);
    }
  }

  function handleImportClick(id: string) {
    importTargetId.current = id;
    fileInputRef.current?.click();
  }

  // Import Excel -> App : ne fait jamais confiance à une valeur de cellule
  // formule (armure/pouvoir psy/avantage) mise en cache par Excel — cf.
  // xlsxSync.ts, même principe que scripts/import_xlsx.py.
  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const id = importTargetId.current;
    e.target.value = ""; // permet de re-sélectionner le même fichier ensuite
    if (!file || !id || !referenceData) return;
    setError(null);
    setBusyId(id);
    try {
      const [buf, XLSX] = await Promise.all([file.arrayBuffer(), import("xlsx")]);
      const wb = XLSX.read(buf, { type: "array" });
      const { readCharacterPatchFromWorkbook } = await import("../lib/xlsxSync");
      const patch = readCharacterPatchFromWorkbook(wb, referenceData);
      await api.updateCharacter(id, patch);
      await loadCharacters();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'import — le fichier n'est peut-être pas au bon format");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div
      className="min-h-dvh bg-cover bg-center bg-no-repeat"
      style={{
        backgroundImage: `linear-gradient(rgba(2,6,23,.82), rgba(2,6,23,.82)), url('${backgroundUrl}')`,
      }}
    >
      <input ref={fileInputRef} type="file" accept=".xlsx" className="hidden" onChange={handleFileSelected} />
      <div className="mx-auto max-w-3xl px-4 py-6">
        <header className="mb-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-sm text-indigo-400 hover:underline">
              {t("← Parties")}
            </Link>
            <h1 className="text-lg font-semibold">{t("Personnages")}</h1>
          </div>
          <div className="flex items-center gap-3 text-sm text-slate-400">
            {isGm && groupId && (
              <Link
                to={`/suivi/${groupId}`}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
              >
                {t("Suivi des constantes")}
              </Link>
            )}
            {user?.role === "admin" && (
              <Link to="/admin/jeux" className="text-indigo-400 hover:underline">
                {t("Règles des jeux")}
              </Link>
            )}
            {groupDriveUrl && (
              <a href={groupDriveUrl} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">
                {t("Dossier Drive")}
              </a>
            )}
            {groupId && (
              <Link to={`/documentation/${groupId}`} className="text-indigo-400 hover:underline">
                {t("Documentation")}
              </Link>
            )}
            <Link to="/profil" className="text-indigo-400 hover:underline">
              {t("Mon profil")}
            </Link>
            <span>{user?.displayName}</span>
            <button onClick={() => logout()} className="text-indigo-400 hover:underline">
              {t("Déconnexion")}
            </button>
          </div>
        </header>

        {!isMember ? (
          <p className="text-sm text-slate-500">
            {t("Vous n'êtes pas membre de ce groupe.")}{" "}
            <Link to="/" className="text-indigo-400 hover:underline">
              {t("Retour à l'accueil")}
            </Link>
            .
          </p>
        ) : (
          <>
            {error && <p className="text-red-400">{error}</p>}
            {!rows && !error && <p className="text-slate-400">{t("Chargement…")}</p>}

            {/*
              Demandes d'adhésion en attente — MJ uniquement (cf.
              migrations/0006_join_approval.sql). Affichée en premier, avant
              même la liste des joueurs, pour rester visible tant qu'il y a
              une demande à traiter.
            */}
            {isGm && joinRequests && joinRequests.length > 0 && (
              <section className="mb-6 rounded-xl bg-amber-950/40 p-4 shadow">
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-amber-300">
                  {t("Demandes d'adhésion en attente")}
                </h2>
                <ul className="space-y-2">
                  {joinRequests.map((r) => (
                    <li key={r.userId} className="flex items-center justify-between gap-3 rounded-lg bg-slate-900/60 px-3 py-2 text-sm">
                      <span className="text-slate-200">{r.displayName} <span className="text-slate-500">({r.username})</span></span>
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          onClick={() => handleApproveRequest(r.userId)}
                          disabled={requestBusyId === r.userId}
                          className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
                        >
                          {requestBusyId === r.userId ? "…" : t("Approuver")}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRejectRequest(r.userId)}
                          disabled={requestBusyId === r.userId}
                          className="rounded-lg bg-slate-800 px-3 py-1 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-50"
                        >
                          {t("Rejeter")}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {isGm && <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">{t("Joueurs")}</h2>}
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {rows?.filter((c) => !c.isNpc && !c.archived).map((c) => {
                const canEdit = isGm || c.owner_username === user?.username;
                const busy = busyId === c.id;
                return (
                  <li key={c.id} className="flex items-center gap-2">
                    <Link
                      to={`/personnages/${c.id}`}
                      state={{ from: "groupe", groupId }}
                      className="flex flex-1 items-center justify-between rounded-xl bg-slate-900 px-4 py-3 shadow transition hover:bg-slate-800"
                    >
                      <div>
                        <p className="font-medium text-slate-100">{c.name}</p>
                        <p className="text-sm text-slate-400">{raceLabel(c.race)}</p>
                      </div>
                      {c.owner_username === user?.username && (
                        <span className="rounded-full bg-indigo-600/20 px-2 py-1 text-xs text-indigo-300">{t("Ma fiche")}</span>
                      )}
                    </Link>
                    <div className="flex shrink-0 flex-col items-center gap-1">
                      {isGm && (
                        <label className="flex flex-col items-center gap-0.5 text-xs text-slate-400">
                          <input
                            type="checkbox"
                            checked={c.inGame}
                            onChange={() => toggleInGame(c)}
                            aria-label={`${c.name} en jeu`}
                          />
                          {t("En jeu")}
                        </label>
                      )}
                      <div className="flex gap-1">
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => handleImportClick(c.id)}
                            disabled={busy}
                            title="Importer depuis une fiche Excel"
                            aria-label={`Importer la fiche de ${c.name} depuis Excel`}
                            className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-50"
                          >
                            ⬆︎ Excel
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleExport(c.id, c.name)}
                          disabled={busy}
                          title="Exporter vers une fiche Excel"
                          aria-label={`Exporter la fiche de ${c.name} vers Excel`}
                          className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-50"
                        >
                          ⬇︎ Excel
                        </button>
                      </div>
                      {isGm && (
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => toggleIsNpc(c)}
                            title="Passer ce personnage en PNJ"
                            aria-label={`Passer ${c.name} en PNJ`}
                            className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700"
                          >
                            {t("→ PNJ")}
                          </button>
                          <button
                            type="button"
                            onClick={() => setArchived(c, true)}
                            title="Archiver ce personnage"
                            aria-label={`Archiver ${c.name}`}
                            className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700"
                          >
                            {t("Archiver")}
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>

            {/*
              Section PNJ — MJ uniquement : les PNJ n'ont pas de joueur pour
              cocher "En jeu" depuis leur propre fiche (contrairement aux
              personnages joueurs ci-dessus), donc c'est ici que le MJ décide
              lesquels apparaissent sur l'écran "Suivi des constantes"
              (rows.inGame filtré côté GmTracker.tsx).
            */}
            {isGm && rows && rows.some((c) => c.isNpc && !c.archived) && (
              <>
                <h2 className="mb-3 mt-8 text-sm font-semibold uppercase tracking-wide text-slate-400">{t("PNJ")}</h2>
                <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {rows.filter((c) => c.isNpc && !c.archived).map((c) => (
                    <li key={c.id} className="flex items-center gap-2">
                      <Link
                        to={`/personnages/${c.id}`}
                        state={{ from: "groupe", groupId }}
                        className="flex flex-1 items-center justify-between rounded-xl bg-slate-900 px-4 py-3 shadow transition hover:bg-slate-800"
                      >
                        <div>
                          <p className="font-medium text-slate-100">{c.name}</p>
                          <p className="text-sm text-slate-400">{raceLabel(c.race)}</p>
                        </div>
                      </Link>
                      <div className="flex shrink-0 flex-col items-center gap-1">
                        <label className="flex flex-col items-center gap-0.5 text-xs text-slate-400">
                          <input
                            type="checkbox"
                            checked={c.inGame}
                            onChange={() => toggleInGame(c)}
                            aria-label={`${c.name} en jeu`}
                          />
                          {t("En jeu")}
                        </label>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => toggleIsNpc(c)}
                            title="Passer ce PNJ en personnage joueur"
                            aria-label={`Passer ${c.name} en personnage joueur`}
                            className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700"
                          >
                            {t("→ Joueur")}
                          </button>
                          <button
                            type="button"
                            onClick={() => setArchived(c, true)}
                            title="Archiver ce PNJ"
                            aria-label={`Archiver ${c.name}`}
                            className="rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700"
                          >
                            {t("Archiver")}
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {/*
              Bouton d'accès aux personnages archivés — toujours visible côté MJ
              (sous la section PNJ), qu'il y en ait ou non, pour rester un point
              d'entrée stable plutôt qu'apparaître/disparaître selon le contenu.
            */}
            {isGm && rows && (
              <>
                <button
                  type="button"
                  onClick={() => setShowArchived((v) => !v)}
                  className="mb-3 mt-8 text-sm text-indigo-400 hover:underline"
                >
                  {showArchived ? "▾" : "▸"} {t("Personnages archivés")} ({rows.filter((c) => c.archived).length})
                </button>

                {showArchived && (
                  <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {rows
                      .filter((c) => c.archived)
                      .map((c) => (
                        <li
                          key={c.id}
                          className="flex items-center justify-between gap-2 rounded-xl bg-slate-900/60 px-4 py-3 shadow"
                        >
                          <div>
                            <p className="font-medium text-slate-300">{c.name}</p>
                            <p className="text-sm text-slate-500">
                              {raceLabel(c.race)} · {c.isNpc ? t("PNJ") : t("Joueur")}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setArchived(c, false)}
                            title="Désarchiver ce personnage"
                            aria-label={`Désarchiver ${c.name}`}
                            className="shrink-0 rounded-md bg-slate-800 px-2 py-1 text-xs text-slate-300 hover:bg-slate-700"
                          >
                            {t("Désarchiver")}
                          </button>
                        </li>
                      ))}
                    {rows.filter((c) => c.archived).length === 0 && (
                      <p className="text-sm text-slate-500">{t("Aucun personnage archivé.")}</p>
                    )}
                  </ul>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
