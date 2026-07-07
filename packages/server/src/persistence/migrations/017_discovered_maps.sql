-- 017_discovered_maps.sql — Track which maps a player has visited for world-map quick-travel.
--
-- The world map (W key) shows all registered maps as nodes. Quick-travel should
-- only succeed for maps the player has discovered (visited at least once). This
-- column persists that list so it survives logouts and server restarts.

ALTER TABLE characters ADD COLUMN discovered_maps TEXT NOT NULL DEFAULT '[]';
