-- Reverse of 035_episodic. The vector extension is left installed (other
-- objects may come to depend on it; dropping an extension is a system-wide act).
drop function if exists public.match_episodes(uuid, vector, text, int);
drop table if exists public.episode_embeddings;
-- drop extension if exists vector;  -- deliberate manual-only step
