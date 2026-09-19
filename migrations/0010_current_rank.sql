-- Rang d'Action courant du round, partagé entre tous les MJ qui consultent
-- l'écran "Suivi des constantes" d'un même groupe en même temps (cf.
-- GmTracker.tsx) — jusqu'ici purement local à l'onglet de chaque MJ, donc
-- invisible aux autres (signalé : le rang ne se met pas à jour sur une
-- tablette quand un autre MJ clique "Suivant" sur son propre appareil).
-- 0 par défaut (round pas commencé / vient d'être réinitialisé).
ALTER TABLE player_groups ADD COLUMN current_rank INTEGER NOT NULL DEFAULT 0;
