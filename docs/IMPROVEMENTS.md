# Improvement Suggestions

Some features and improvements i am looking forward to make for Audyn, multiple things across UI/UX, features, technical architecture, security, and portfolio presentation.

---

## A. UI/UX

### High-priority fixes

**Album art flash** — On game start, album art loads lazily per reveal. The `GET /tracks/art` batch request fires but the loading gap is visible. Pre-fetch art for all selected tracks in parallel during the brief "loading audio" phase so it's ready before the first reveal card renders.

**Mobile guess input UX** — On iOS/Android, the dropdown autocomplete list often gets hidden behind the keyboard or cut off at the viewport edge. The input + dropdown need to be positioned above the keyboard, or the dropdown should open upward when near the bottom of the screen.

**Clip replay button** — After a clip finishes, there's no obvious way to replay it without knowing to tap the play button again. A visual "tap to replay" hint (or auto-dimming the play button between clips) would clarify the interaction. Many users will think the round is simply waiting for input.

**Skip affordance** — The `Skip →` button is very small and has no visual weight. Users who don't know the song will miss it and assume they must guess. Consider making it a more prominent secondary button alongside the input.

**End page sharing** — The share buttons are ordered: Copy Link → Copy Share Text → Challenge a Friend. This is backwards for most users. Challenge-a-friend (the most socially motivating action) should be first.

### Smaller issues

- The "Ticking Away" time pressure bar uses `var(--color-error)` at high decay but doesn't give any audio or haptic cue. A subtle screen pulse (you already have `screen-flash-red`) at the 80% penalty point would add tension without being annoying.
- In the CRT theme, the `VT323` font at small sizes (10px mono labels) becomes unreadable. Either bump the minimum CRT font size or use a more legible fallback for labels below 12px.
- The Room lobby page has `position: absolute` on the back button, which breaks on small screens when the content is taller than the viewport.

---

## B. Feature Suggestions

### Add

**Replay / post-game review** — After the end screen, let users step back through each track: hear the correct clip, see the album art, and see which stage they guessed on (or missed). This is the single highest-value retention feature — it turns a loss into something instructive.

**Keyboard-navigable autocomplete** — Arrow keys + Enter should navigate the dropdown. The current implementation only supports clicking. This is expected behavior and its absence feels like a bug.

**"I don't know" button** — Separate from Skip. Skip advances the clip; "I don't know" immediately reveals the track (awarding 0). Players who know they don't know a song are forced to sit through 5 clips anyway, which kills pace for playlists with unfamiliar tracks.

**Spotify-linked listen history** — After a completed game, optionally open a Spotify playlist of the tracks the user missed. Deep link to `https://open.spotify.com/track/{id}` for each missed track already works; the EndPage already shows Spotify links but only per-track inline.

**Practice mode** — Non-scored, unlimited replays of any clip. Good for testing how recognizable a playlist is before challenging friends.

### Reconsider

**H2H polling** — The 2-second poll loop works but creates a visible delay when a player finishes their game and waits for results. The 12-second client-side fallback is a good safety net, but the experience would be meaningfully better with a WebSocket or SSE connection for room state events. This is the one place the architecture's simplicity creates a user-facing problem.

**5 song count option** — 5 songs produces a max score of 500, which sits awkwardly on the leaderboard next to 50-song sessions. Consider removing the 5-song option or marking it explicitly as "Quick game" and excluding it from leaderboard scoring.

**Language auto-detection on first load** — The `detectBrowserLanguage()` function works but only fires once on mount. If a user has changed their language in the UI then clears localStorage, it re-detects correctly. But the Japanese and Korean UI font (Outfit/Sora) doesn't include full CJK coverage — add a CJK-appropriate font fallback in `index.css` for `hi`, `ja`, and `ko` locales.

---

## C. Technical Improvements

### Architecture

**Replace polling with SSE for rooms** — The room polling model is the most significant architectural debt. Server-Sent Events are simpler than WebSockets and sufficient for one-directional room state pushes. FastAPI has native SSE support. This would also eliminate the 12-second result-display timeout hack.

**Extract `TTLCache` into a shared module** — The `TTLCache` class is copied verbatim into `server.py`, `auth.py`, `leaderboard.py`, and `achievements.py`. It should live in a `cache.py` utility module imported by all of them. Copy-paste is currently the only way these four are kept in sync.

**`preview_worker.py` should not import from `server.py`** — `get_or_create_daily` in `daily.py` does `from server import fetch_playlist`. This creates a module-level circular dependency (server → daily → server). `fetch_playlist` should be extracted into a `spotify.py` module that both `server.py` and `daily.py` import from.

**Connection pool sizing** — The pool is configured `min_size=10, max_size=100`. On a small VPS, PostgreSQL defaults to `max_connections=100`, and the pool alone could exhaust it if multiple workers are running. Either lower `max_size` or configure PostgreSQL's `max_connections` explicitly for the expected worker count.

### Performance

**Leaderboard query** — The global leaderboard's `ROW_NUMBER() OVER (ORDER BY SUM(final_score) DESC)` window function runs over the full `scores` table on every non-cached request. Add a materialized view or a periodic summary table (`user_score_totals`) refreshed by a background task. At scale this becomes the slowest query in the system.

**`batch_fetch_previews` is not called** — The function exists in `server.py` but is commented out from the main fetch path (intentionally, to not block the user response). Consider a lightweight in-process task (not a full worker) that kicks off the batch fetch in the background after responding, rather than leaving it entirely to the 30-minute worker cycle. The current gap means a fresh playlist can show 10 playable tracks when it actually has 50, until the worker next runs.

**Audio cache eviction** — The in-process `_audio_cache` (50 entries, 5-minute TTL) uses the full CDN URL as a key. Spotify CDN URLs include expiry tokens, so the same audio file gets a different URL on each playlist fetch. The cache is effectively disabled for this reason. Remove it or key by track ID instead.

### Code quality

**`GamePage.js` is 800+ lines** — It handles audio state, guess logic, score submission, streak tracking, keyboard shortcuts, mobile unlock, artist vs song mode, and H2H integration in a single component. Extract at minimum: `useGameState` (score/streak/clip stage), `GuessInput` (input + dropdown + filtering), and the `submitScore` function into a `useScoreSubmission` hook.

**`useEffect` dependency array gaps** — In `GamePage.js`, `initRound` is listed as a `useEffect` dependency but the effect that calls it also closes over `gameTracks` and `results.length`. Missing deps are suppressed with `// eslint-disable-next-line`. These should be resolved with `useCallback` + proper deps or a ref-based approach, not suppressed.

**No error boundary around GamePage** — The top-level `ErrorBoundary` catches render errors, but an audio load failure or API error during active gameplay falls through to a toast and a stuck UI state. A game-specific error state (with a "restart round" button) would be more graceful than an empty loading spinner.

---

## D. Security

### Authentication

**JWT `iat` claim is set but never validated** — `auth.py` includes `"iat"` in the token payload but the decode call doesn't check it. This is low-risk for this use case but should be consistent.

**Guest session rate limit is per-IP but not per-token** — A single IP can create a guest session, rotate to a VPN, and create another. The real risk is score spam. The server-side score computation already limits the ceiling per submission, but there's no cap on the number of submissions per user per playlist. A `(user_id, playlist_id, date)` submission count check would prevent bot-inflated leaderboard entries.

**No CSRF protection** — The API uses JWT Bearer auth (not cookies), so CSRF isn't a concern for state-changing endpoints. This is correct. Document it so future contributors don't add cookie-based auth without also adding CSRF protection.

**Avatar upload path traversal** — The upload goes directly to Cloudinary with no local disk write, so path traversal isn't applicable. But the file is read fully into memory (`await file.read()`) before the size check. A malicious client could send a 5GB file and exhaust backend memory before the check triggers. Read with a size limit or stream to Cloudinary directly.

### API abuse

**Score submission is unbounded per session** — A user can submit scores for the same track many times within a single session (only daily tracks are deduplicated). The leaderboard query sums `final_score` across all rows, so repeated submissions inflate totals. Add a `(user_id, track_id, DATE(guessed_at))` uniqueness check or cap daily submissions per track for non-daily games.

**`/api/playlist/{id}` is publicly rate-limited but the embed scrape is expensive** — At 30 req/min per IP, a coordinated attack from multiple IPs can trigger many concurrent Spotify fetches. The in-memory fetch lock should be a per-playlist-ID semaphore (already partially true via the memory cache), not just the rate limiter. Add a `fetch_in_progress` dict so concurrent requests for the same uncached playlist ID coalesce rather than each triggering a separate Spotify fetch.

**Share creation stores arbitrary `results` JSON** — The `results` field is accepted as `list` and stored as JSONB without schema validation beyond JSON structure. A malicious client could store arbitrarily large arrays (up to the 5MB JSONB limit). Add a max-length check on `results` (e.g., `len(req.results) <= 200`).

**The room score endpoint doesn't throttle updates** — `POST /rooms/{code}/score` is called after every guess in the game loop. At 2 updates/second × 2 players, that's fine at low traffic. But there's no per-room rate limit. A malformed client could spam this endpoint.

---

## E. Portfolio Polish

### What raises the bar

**Add a proper test suite** — There are zero tests. For a portfolio project, even a small `pytest` suite covering score computation (`scoring.py`'s `compute_score`), the `extract_playlist_id` parser, and the guest-conversion flow would signal engineering maturity. On the frontend, a few `@testing-library/react` tests for `GamePage` clip stage transitions would be compelling.

**OpenAPI documentation** — FastAPI generates OpenAPI automatically, but the docs are explicitly disabled (`docs_url=None`). For a portfolio project, enabling it (even behind a `/docs` path guard in production) would let anyone exploring the codebase understand the API instantly. The schema is the best self-documenting artifact you have.

**Structured logging** — Every `logger.info` call outputs a plain string. Adding a `structlog` or JSON formatter with fields like `user_id`, `playlist_id`, `duration_ms`, and `status` would make the logs greppable and would be a visible signal that you know how production systems are operated.

**`schema.sql` migration history** — The current approach appends `ALTER TABLE` blocks inline. For a portfolio project, adopting `Alembic` (even without auto-generate) would demonstrate familiarity with proper database lifecycle management. Alternatively, add a `migrations/` directory with numbered SQL files and a one-liner bootstrap script — the pattern matters more than the tool.

**README screenshot / demo GIF** — The README has no visuals. A single 30-second GIF showing a correct first-clip guess, the flip-in reveal card, and the share screen would communicate the product in 5 seconds to anyone landing on the GitHub page.

**Docker Compose for local development** — A `docker-compose.yml` that spins up PostgreSQL, the API, and the preview worker in one command (`docker compose up`) dramatically lowers the friction for someone evaluating the project. It also signals that you think about reproducibility.

**Semantic versioning** — `server.py` already has `version="3.0.2"`. Tag releases in git and keep a `CHANGELOG.md`. This is minimal effort and looks professional.

**Contribution via issue templates** — Add `.github/ISSUE_TEMPLATE/bug_report.md` and `feature_request.md`. This takes 10 minutes and signals the project is open to collaboration rather than being a solo artifact.
