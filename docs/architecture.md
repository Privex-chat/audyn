# Architecture

## System Overview

Audyn is a three-process system in production:

1. **FastAPI web server** — handles all HTTP requests (playlist fetch, scoring, auth, leaderboard, rooms)
2. **React SPA** — served as a static build; all routing is client-side
3. **preview_worker.py** — standalone asyncio process that retries Spotify preview URL fetches on a 30-minute cycle

```
┌─────────────────────────────────────────────────────┐
│                     Browser                         │
│                                                     │
│  React SPA                                          │
│  ├─ Howler.js  ──────► /api/audio-proxy             │
│  ├─ Axios      ──────► FastAPI                      │
│  └─ localStorage (token, guest_id, theme, language) │
└─────────────────────────────────────────────────────┘
                           │
                    ┌──────▼──────┐
                    │   FastAPI   │
                    │  (server.py)│
                    └──────┬──────┘
                           │ asyncpg
                    ┌──────▼──────┐
                    │ PostgreSQL  │
                    └──────┬──────┘
                           │
              ┌────────────┘
              │
     ┌────────▼────────┐
     │ preview_worker  │   (separate process, same DB)
     └─────────────────┘
```

---

## Backend Modules

| Module | Responsibility |
|---|---|
| `server.py` | App entrypoint, Spotify fetch pipeline, audio proxy, playlist routes, rate limiting |
| `auth.py` | JWT issuance/validation, registration, login, guest sessions, guest→account conversion, avatar upload |
| `scoring.py` | Server-authoritative score computation, score persistence, per-track achievement checks |
| `daily.py` | Daily challenge generation (deterministic shuffle by date), streak tracking |
| `leaderboard.py` | Ranked queries with 60-second TTL cache |
| `rooms.py` | H2H room creation, joining, score updates, finish-state transitions |
| `shares.py` | Score card creation and retrieval |
| `achievements.py` | Badge definitions, per-track and session-level award logic |
| `stats.py` | Activity counters, recent playlist lookups |
| `db_playlists.py` | PostgreSQL read/write layer for the playlist + track cache |
| `database.py` | asyncpg connection pool (min 10, max 100) |
| `preview_worker.py` | Retries empty preview_url rows; marks tracks unavailable after max failures |

---

## Data Flow: Playlist Fetch

```
GET /api/playlist/{id}
        │
        ├─ 1. Memory TTL cache (10 min)
        │       └─ Hit → return immediately
        │
        ├─ 2. PostgreSQL cache (7-day TTL)
        │       └─ Hit → populate memory cache, return
        │
        └─ 3. Spotify fetch
                ├─ With Client Credentials:
                │    ├─ GET spotify.com/v1/playlists/{id}   → metadata, full track list
                │    └─ GET spotify.com/embed/playlist/{id} → first ~50 preview URLs
                │
                └─ Without credentials:
                     └─ GET spotify.com/embed/playlist/{id} → metadata + up to ~50 tracks
                              │
                              ├─ Tracks with preview_url → returned to user now
                              └─ Tracks without → saved to DB with empty preview_url
                                                  → preview_worker picks up on next cycle
```

All playable tracks (including those missing previews) are written to PostgreSQL so the worker can find them. The response to the user includes only tracks with a non-empty `preview_url`.

---

## Data Flow: Score Submission

```
POST /api/scores/submit
  body: { track_id, playlist_id, clip_stage, start_timestamp,
          guess_timestamp, elapsed_seconds, difficulty,
          game_mode, correct, multiplier, ... }
        │
        ├─ Validate difficulty / game_mode / guess_mode / multiplier bounds
        ├─ Compute elapsed (prefer client-measured elapsed_seconds)
        ├─ Compute score server-side:
        │    Classic:      base = points[clip_stage]; penalty = 0
        │    Ticking Away: base = points[clip_stage]; penalty = elapsed * decay_rate
        │                  apply multiplier if ticking_away + correct
        ├─ FK-safety check (playlist + track exist in DB)
        ├─ Daily duplicate check (if is_daily)
        ├─ INSERT into scores
        ├─ Update daily_streak (if is_daily, same connection)
        └─ check_per_track_achievements() → return new badge keys
```

The client never sends a `score` value. Every numeric outcome is derived from timing metadata on the server.

---

## Database Schema Summary

```sql
users               — accounts, guest accounts, profile data, daily streak
playlists           — Spotify playlist cache (name, image, TTL)
tracks              — Spotify track cache (preview_url, retry counters)
playlist_tracks     — many-to-many join, preserves position ordering
scores              — all game results; basis for leaderboard and stats
daily_challenges    — one row per date; track_ids array, deterministic per day
rooms               — H2H session state (status, scores, track_ids)
shares              — score card snapshots for share links
achievements        — badge definitions
user_achievements   — earned badges per user
```

See `backend/schema.sql` for full DDL. The schema is idempotent — all migrations use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` and are appended at the bottom of the file.

---

## Caching Strategy

| Layer | Store | TTL | Scope |
|---|---|---|---|
| Hot playlist cache | In-process `OrderedDict` | 10 min | Per playlist |
| Spotify API token | In-process | ~50 min | Global |
| Preview URL cache | In-process | 2 hr | Per track |
| Album art cache | In-process + DB | 1 hr memory / permanent DB | Per track |
| Leaderboard results | In-process `OrderedDict` | 60 sec | Per query params |
| Playlist data | PostgreSQL | 7 days | Per playlist |
| Audio responses | In-process (≤1MB) | 5 min | Per CDN URL |

---

## Authentication Flow

```
New visitor
    │
    ├─ Plays without logging in
    │       └─ First score submit triggers POST /auth/guest-session
    │               → creates user row (is_guest=TRUE)
    │               → returns JWT stored in localStorage
    │
    └─ Registers → POST /auth/register (or /auth/convert-guest)
                        └─ If converting: UPDATE users SET is_guest=FALSE
                           All existing scores are preserved (same user_id)
```

JWT tokens are HS256, 72-hour expiry, signed with `JWT_SECRET`. The bearer token is attached to all subsequent requests via an Axios request interceptor.

---

## Rate Limiting

All rate limiters are in-process sliding window counters. There is no shared state across workers.

| Endpoint group | Limit |
|---|---|
| General API | 30 req/min per IP |
| Share creation | 10 req/min per IP |
| Auth (login/register) | 10 req/min per IP |
| Registration specifically | 5 req/min per IP |

---

## H2H Room State Machine

```
waiting
    │
    └─ guest joins → playing
                        │
                        ├─ host finishes → host_done
                        │                      └─ guest finishes → finished
                        │
                        └─ guest finishes → guest_done
                                                └─ host finishes → finished
```

Both clients poll `/rooms/{code}` every 2 seconds. Neither WebSockets nor server-sent events are used. Score submissions are fire-and-forget from the game loop; the server enforces that scores can only increase.

---

## Frontend Architecture

The React app uses a phase-based routing model rather than React Router. A single `phase` state string in `App.js` determines which page component renders. URL changes use `window.history.pushState` directly, and `popstate` events drive phase transitions. This keeps navigation lightweight and avoids the SPA router abstraction for what is fundamentally a linear game flow.

State is held at three levels:
- **`App.js`** — cross-page state (playlistData, gameSettings, gameResults, activePhase)
- **Context** — auth (`AuthContext`), theme (`ThemeContext`), language (`LanguageContext`)
- **Page components** — local UI state (loading, form values, fetched data)

Audio is managed entirely in the `useAudio` hook, which wraps Howler.js with Web Audio API by default and falls back to HTML5 mode on failure. The hook exposes `loadAudio`, `playClip`, `togglePlay`, and `stop` — GamePage never touches Howler directly.
