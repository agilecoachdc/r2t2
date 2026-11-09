-- Verrouillage des fiches pendant une séance (bouton MJ en haut de l'écran
-- "Suivi des constantes") — tant que 1, les joueurs du groupe ne peuvent
-- plus dépenser d'XP ni de crédits pour faire évoluer leur personnage
-- (attributs, compétences, inventaire, accessoires, consommables). Le MJ
-- n'est pas concerné. Cf. src/shared/session-lock.ts.
ALTER TABLE player_groups ADD COLUMN sheets_locked INTEGER NOT NULL DEFAULT 0;
