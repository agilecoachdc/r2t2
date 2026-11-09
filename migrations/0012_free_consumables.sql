-- "Consommables gratuits" (bouton MJ sur la ligne de titre de l'écran
-- "Suivi des constantes") — tant que 1, l'achat de consommables ne débite
-- aucun crédit aux joueurs du groupe (ex. préparation dans l'arsenal d'alliés
-- qui offrent l'équipement). Cf. calc-engine.applyConsumableChange (`free`).
ALTER TABLE player_groups ADD COLUMN free_consumables INTEGER NOT NULL DEFAULT 0;
