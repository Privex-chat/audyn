# API Reference

Base URL: `http://localhost:8000/api` (development) or `https://api.audyn.xyz/api` (production)

All authenticated endpoints require `Authorization: Bearer <token>` in the request header.

---

## Authentication

### POST /auth/register

Create a new account.

**Body**
```json
{
  "username": "string (3–30 chars, alphanumeric + underscore)",
  "email": "string",
  "password": "string (min 8 chars)",
  "bio": "string (optional, max 160 chars)"
}
```

**Response**
```json
{
  "token": "string",
  "user": { "id": "uuid", "username": "string" }
}
```

---

### POST /auth/login

**Body**
```json
{ "email": "string", "password": "string" }
```

**Response** — same shape as `/auth/register`

---

### POST /auth/guest-session

Creates an ephemeral guest account. Call this before score submission if the user has no token.

**Response**
```json
{ "guest_session_id": "uuid", "token": "string" }
```

---

### POST /auth/convert-guest

Upgrades a guest session to a full account, preserving all scores.

**Body**
```json
{
  "guest_session_id": "uuid",
  "username": "string",
  "email": "string",
  "password": "string",
  "bio": "string (optional)"
}
```

---

### GET /auth/me *(requires auth)*

Returns the current user's full profile including email, bio, avatar, and social links.

---

### PUT /auth/profile *(requires auth)*

Update bio, display_name, link_spotify, link_instagram, link_pinterest. Send only the fields you want to change.

---

### POST /auth/avatar *(requires auth)*

Multipart upload of `file` (JPEG/PNG/WebP, max 5MB). Uploads to Cloudinary; returns `{ "avatar_url": "string" }`.

---

### GET /auth/profile/{username}

Public profile. Returns username, display_name, bio, avatar, social links, total_score, tracks_guessed, global_rank, badges.

---

## Playlists

### GET /playlist/{id_or_url}

Fetch a playlist by Spotify ID or full URL.

**Query params**
- `refresh=true` *(authenticated non-guest only)* — force re-fetch from Spotify, evicting both memory and DB caches

**Response**
```json
{
  "name": "string",
  "image": "string (URL)",
  "playlist_id": "string",
  "tracks": [
    {
      "id": "string",
      "name": "string",
      "artist": "string",
      "preview_url": "string",
      "album_name": "string",
      "album_image": "string (may be empty on first load)",
      "duration_ms": 0,
      "explicit": false,
      "popularity": 0
    }
  ],
  "total_tracks": 0,
  "total_in_playlist": 0,
  "skipped_no_preview": 0,
  "pending_preview_retry": 0,
  "warning": "string (optional)"
}
```

`album_image` is intentionally empty on first load and fetched separately via `/tracks/art`.

---

### GET /tracks/art

Fetch album art for a batch of tracks. Call this after starting a game with the selected track IDs.

**Query params**
- `ids` — comma-separated track IDs (max 100)

**Response**
```json
{
  "art": {
    "track_id_1": "https://...",
    "track_id_2": "https://..."
  }
}
```

---

## Audio

### GET /audio-proxy

Proxies a Spotify CDN audio URL through the backend to handle CORS.

**Query params**
- `url` — URL-encoded Spotify CDN URL (must be `p.scdn.co`, `preview.scdn.co`, or `anon-podcast-api.spotifycdn.com`)

Returns the audio stream as `audio/mpeg`.

---

## Scoring

### POST /scores/submit *(requires auth)*

Submit a single track result. The backend computes the final score; the client never sends a raw point value.

**Body**
```json
{
  "track_id": "string",
  "playlist_id": "string",
  "clip_stage": 0,
  "start_timestamp": 1700000000000,
  "guess_timestamp": 1700000002500,
  "clip_length_used": 0.3,
  "elapsed_seconds": 2.5,
  "difficulty": "normal",
  "game_mode": "classic",
  "guess_mode": "song",
  "correct": true,
  "is_daily": false,
  "multiplier": 1.0,
  "streak_bonus_applied": false
}
```

`elapsed_seconds` (client-measured gameplay time) is preferred over `guess_timestamp - start_timestamp`. The timestamp diff is used as a fallback only.

**Response**
```json
{
  "base_score": 100,
  "time_penalty": 0,
  "final_score": 100,
  "elapsed_seconds": 2.5,
  "new_badges": [
    { "key": "sharp_ear", "emoji": "🎯", "label": "Sharp Ear" }
  ]
}
```

`new_badges` is omitted if no badges were earned.

---

### POST /scores/session-complete *(requires auth)*

Call once at the end of a game session (before navigating to EndPage) to trigger session-level achievement checks.

**Body**
```json
{
  "session_results": [
    { "correct": true, "clip_stage": 0, "points": 100, "elapsed_seconds": 1.2 }
  ],
  "difficulty": "normal",
  "game_mode": "classic",
  "guess_mode": "song",
  "playlist_track_count": 50,
  "client_hour": 14
}
```

**Response**
```json
{
  "new_badges": [ { "key": "on_fire", "emoji": "🔥", "label": "On Fire" } ]
}
```

---

### GET /scores/my-scores *(requires auth)*

Returns up to 500 recent scores for the current user.

**Query params**
- `limit` — default 50, max 500

---

## Leaderboard

### GET /leaderboard/global

**Query params**
- `period` — `all` | `week` | `month` (default: `all`)
- `game_mode` — `classic` | `ticking_away`
- `guess_mode` — `song` | `artist`
- `limit` — 1–100 (default: 50)

**Response** — array of `{ rank, user_id, username, avatar_url, total_score, tracks_guessed }`

---

### GET /leaderboard/daily

**Query params**
- `day` — `YYYY-MM-DD` (default: today)
- `game_mode`, `guess_mode`, `limit` — same as global

---

### GET /leaderboard/user/{user_id}

Returns aggregate stats and global rank for a specific user.

---

## Daily Challenge

### GET /daily/today

Returns today's tracks and the current user's streak and completion status.

**Response (excerpt)**
```json
{
  "date": "2025-01-15",
  "playlist_id": "string",
  "tracks": [ ... ],
  "track_count": 10,
  "already_played": false,
  "user_streak": 3
}
```

---

### GET /daily/history

Returns the authenticated user's daily challenge history.

**Query params**
- `days` — how many days back (default: 7)

---

## Shares

### POST /share

Create a shareable score card. No auth required.

**Body** — see `CreateShareRequest` in `shares.py`.

**Response**
```json
{ "share_id": "abc123xyz" }
```

The share link is `https://audyn.xyz/s/{share_id}`.

---

### GET /share/{share_id}

Retrieve a share record by ID.

---

## Rooms (H2H)

### POST /rooms/create *(requires auth)*

**Body**
```json
{
  "playlist_id": "string",
  "song_count": 10,
  "difficulty": "normal",
  "game_mode": "classic",
  "guess_mode": "song"
}
```

**Response** — includes `room_code` (6-char), `track_ids`, and full `tracks` array.

---

### POST /rooms/join/{room_code} *(requires auth)*

Join a waiting room. Returns the same track set as the host.

---

### GET /rooms/{room_code}

Room state: status, host info, guest info, both scores, settings.

---

### POST /rooms/{room_code}/score *(requires auth)*

Update your score mid-game. Monotonically enforced — you cannot decrease your score.

**Body**
```json
{ "score": 240 }
```

---

### POST /rooms/{room_code}/finish *(requires auth)*

Signal that you've finished your game. Triggers state transitions (`host_done` → `guest_done` → `finished`).

---

## Achievements

### GET /achievements/my *(requires auth)*

Returns all badge definitions with `earned: true/false` and `earned_at` timestamp for earned badges.

---

## Stats

### GET /stats/activity

Returns `{ "players_today": N }` — count of distinct users with scores in the past 24 hours.

---

### GET /stats/recent-playlists

For authenticated users: returns the last 5 playlists they played (from score history).

For guests: accepts `?ids=id1,id2,id3` and returns metadata for those playlist IDs from the DB cache.

---

## Health

### GET / or GET /health

`GET /health` attempts a DB query and returns `{ "status": "healthy" | "degraded" }`.
