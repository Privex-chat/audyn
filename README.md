# Audyn — Guess the Song

**Live at [www.audyn.xyz](https://www.audyn.xyz)**

Audyn is a song-guessing game built around your own Spotify playlists. You paste a playlist URL, then try to name tracks from progressively longer audio clips — starting at 300ms. Score more by guessing faster and earlier.

No account required to play. No API keys required for basic self-hosting.

<a href="https://www.producthunt.com/products/audyn?embed=true&utm_source=badge-featured&utm_medium=badge&utm_campaign=badge-audyn" target="_blank" rel="noopener noreferrer">
  <img alt="Audyn - Guess songs, challenge friends, and climb the leaderboard. | Product Hunt" width="250" height="54" src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1100391&theme=light&t=1773959066752">
</a>

> ⚠️ **Important — Spotify API Changes (Feb 2026)**  
> New Spotify developer restrictions may prevent new users from creating API credentials required for full functionality.  
> See [Spotify Platform Changes](#%EF%B8%8F-spotify-platform-changes-feb-2026) for details.

---

## Interactive Demo

[![Audyn gameplay demo](docs/gameplay_25secs.gif)](https://app.arcade.software/flows/m9dkuTEEZcdw3xCyKO0V/view)

*Click to open the full interactive walkthrough on Arcade.*

---

## How it Works

1. Paste any public Spotify playlist URL
2. Choose how many songs, a difficulty, and a game mode
3. A short audio clip plays — identify the song before the clip grows
4. Wrong or unsure? Skip to the next (longer) clip, at lower points
5. After all rounds, view your score card and share a challenge link

### Clip Stages & Scoring (Normal difficulty)

| Clip | Points |
|------|--------|
| 300ms | 100 |
| 700ms | 80 |
| 2s | 60 |
| 9s | 30 |
| 15s | 10 |
| Missed | 0 |

Points are awarded by clip stage in **Classic** mode. **Ticking Away** mode adds time-pressure decay: your score within each stage degrades the longer you wait to guess.

---

## Features

- **Three difficulty levels** — Easy, Normal, Hard (different clip durations and scoring curves)
- **Two game modes** — Classic (stage-only scoring) and Ticking Away (real-time score decay)
- **Artist mode** — guess the artist instead of the song title
- **Daily Challenge** — a shared 10-track set that rotates at midnight UTC; one attempt per user
- **Head-to-Head Rooms** — create a room code, share it, play the same tracks simultaneously against a friend
- **Global & Daily Leaderboards** — filterable by time period, game mode, and guess mode
- **Achievements** — 9 badges earned through gameplay (Sharp Ear, On Fire, Perfect Session, Night Owl, etc.)
- **Shareable score cards** — generates a short link and a Wordle-style emoji grid for social sharing
- **Challenge links** — share a link that pre-loads your playlist and prompts others to beat your score
- **User profiles** — public profile pages at `audyn.xyz/{username}` with stats, badges, and social links
- **Streak multiplier** — consecutive correct first-clip guesses multiply your score in Ticking Away mode
- **Internationalization** — English, Hindi, Spanish, Japanese, Korean
- **Three themes** — Noir (default), Light, CRT (scanlines + phosphor green)
- **PWA** — installable on mobile, offline shell caching

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Tailwind CSS 3, shadcn/ui, Howler.js, Axios |
| Backend | Python 3.11+, FastAPI, asyncpg, Uvicorn |
| Database | PostgreSQL 15+ |
| Auth | JWT (python-jose), bcrypt, guest sessions |
| Audio | Spotify embed page scraping + backend audio proxy |
| Image storage | Cloudinary (avatar uploads) |
| Build | CRACO (CRA config override) |
| Background jobs | Standalone asyncio worker process (pm2 in production) |

---

## Architecture Overview

```
Browser
  │
  ├─ React SPA (Tailwind, shadcn/ui)
  │    ├─ Howler.js → /api/audio-proxy (proxies Spotify CDN)
  │    └─ Axios → FastAPI backend
  │
FastAPI (server.py)
  ├─ /api/playlist/{id}     — Spotify embed scraper + DB cache
  ├─ /api/scores/submit     — server-authoritative scoring
  ├─ /api/rooms/*           — H2H room management
  ├─ /api/daily/*           — daily challenge generation
  ├─ /api/leaderboard/*     — ranked queries
  ├─ /api/share/*           — score card persistence
  └─ /api/auth/*            — JWT auth, guest sessions, profiles

PostgreSQL (asyncpg connection pool)
  └─ playlists, tracks, playlist_tracks, scores, users,
     achievements, user_achievements, rooms, shares,
     daily_challenges

preview_worker.py (separate process)
  └─ Retries tracks with missing Spotify preview URLs
     on a 30-minute cycle; marks permanently unavailable
     tracks after 5 failures
```

For a deeper breakdown, see [docs/architecture.md](docs/architecture.md).

---

## Prerequisites

- **Node.js** 18+ and **npm** (or Yarn 1.22+)
- **Python** 3.11+
- **PostgreSQL** 15+
- A modern browser (Chrome, Firefox, Edge, Safari)

Optional but recommended for production:
- **Spotify Client ID + Secret** — enables full playlist pagination (50+ tracks). Without these, playlists are capped at the ~50 tracks returned by the embed page.
- **Cloudinary** account — required for avatar uploads
- **pm2** — process management for the preview worker

---

## Local Setup

### 1. Clone

```bash
git clone https://github.com/Privex-chat/audyn.git
cd audyn
```

### 2. Database

```bash
psql -U postgres -c "CREATE DATABASE audyn;"
psql -U postgres -d audyn -f backend/schema.sql
```

### 3. Backend

```bash
cd backend

python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate

pip install -r requirements.txt

cp .env.example .env              # then edit .env
uvicorn server:app --host 0.0.0.0 --port 8000 --reload
```

**backend/.env**

```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/audyn
JWT_SECRET=change-this-to-a-long-random-string
CORS_ORIGINS=http://localhost:3000

# Optional — enables full playlist pagination
SPOTIFY_CLIENT_ID=
SPOTIFY_CLIENT_SECRET=

# Optional — required for avatar uploads
CLOUDINARY_URL=
```

### 4. Frontend

```bash
cd frontend
npm install

cp .env.example .env              # or create manually
npm start
```

**frontend/.env**

```env
REACT_APP_BACKEND_URL=http://localhost:8000
```

Open `http://localhost:3000` and paste any public Spotify playlist URL.

### 5. Preview Worker (optional locally)

The worker fills in missing audio preview URLs for tracks that weren't covered by the playlist embed. Run it alongside the API if you want complete playlists:

```bash
cd backend
source venv/bin/activate
python preview_worker.py
```

---

## Running Tests

```bash
# Frontend
cd frontend && npm test

# Backend (pytest, if test suite is added)
cd backend && pytest
```

---

## Project Structure

```
audyn/
├── backend/
│   ├── server.py          # FastAPI app, Spotify fetch pipeline, audio proxy
│   ├── auth.py            # Registration, login, JWT, guest sessions, profiles
│   ├── scoring.py         # Server-authoritative score computation and storage
│   ├── daily.py           # Daily challenge generation and rotation
│   ├── leaderboard.py     # Ranked leaderboard queries with TTL cache
│   ├── rooms.py           # H2H challenge room CRUD
│   ├── shares.py          # Score card creation and retrieval
│   ├── achievements.py    # Badge definitions and award logic
│   ├── stats.py           # Activity stats, recent playlists
│   ├── db_playlists.py    # PostgreSQL read/write for playlist + track cache
│   ├── database.py        # asyncpg connection pool
│   ├── preview_worker.py  # Background process: retry missing preview URLs
│   ├── schema.sql         # Idempotent schema (safe to re-run)
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.js                 # Root, phase-based routing, auth context
│   │   ├── pages/                 # HomePage, GamePage, EndPage, etc.
│   │   ├── components/            # NavBar, game sub-components, shadcn/ui
│   │   ├── hooks/                 # useAudio (Howler wrapper), useKeyboardShortcuts
│   │   ├── context/               # AuthContext, ThemeContext, LanguageContext
│   │   ├── i18n/                  # Translation files (en, hi, es, ja, ko)
│   │   └── lib/                   # api.js (Axios), difficulty.js, featuredPlaylists.js
│   ├── public/
│   │   ├── service-worker.js      # PWA offline shell
│   │   └── manifest.json
│   └── tailwind.config.js
└── docs/
    ├── architecture.md
    ├── api.md
    ├── game-logic.md
    └── deployment.md
```

---

## Technical Deep Dive

### Server-Authoritative Scoring

The client never sends a score value. It sends timing metadata (clip stage, timestamps, elapsed seconds). The backend (`scoring.py`) independently computes the score using the same difficulty configuration used on the frontend. This prevents any client-side score manipulation.

Classic mode awards the full stage-point value with no decay. Ticking Away mode applies a linear penalty against elapsed time, floored at a minimum percentage of the base points. The streak multiplier (up to ×2.0 at 7+ consecutive first-clip guesses) is also validated server-side — the backend rejects multipliers above 2.0 and ignores them entirely in Classic mode.

### Spotify Data Pipeline

Audyn doesn't use the Spotify OAuth flow or require users to authenticate with Spotify. Playlist data is sourced by scraping the `__NEXT_DATA__` JSON embedded in Spotify's public embed pages — the same data the `open.spotify.com/embed/playlist/{id}` iframe uses to render. When Spotify Client Credentials are configured, the API additionally pages through the full track list (up to 1,500 tracks) using the official API, then matches preview URLs from the embed page.

Tracks without preview URLs (local files, region-locked tracks) are saved to the database with an empty `preview_url` and picked up by the background preview worker on its next 30-minute cycle. After 5 failed attempts, or an immediate HTTP 404, a track is marked `preview_unavailable = TRUE` and excluded from future retries.

### Audio Proxy

Spotify's CDN (`p.scdn.co`) blocks cross-origin requests from non-Spotify origins. All audio is routed through `/api/audio-proxy`, which validates the URL's hostname against an allowlist and streams the response. Responses under 1MB are cached in memory for 5 minutes to avoid redundant CDN fetches during rapid replays.

### H2H Rooms

Room state is polled by both clients at 2-second intervals. There are no WebSockets. Each client submits score updates as they play; the server enforces monotonic non-decreasing scores and validates against a maximum derived from the difficulty config. When a player finishes, they call `/rooms/{code}/finish`; when both have finished (or a 12-second client-side timeout fires), the results screen renders.

### Guest Sessions

Unauthenticated users are transparently assigned a guest account (`is_guest = TRUE`) when they first submit a score. The guest token is stored in `localStorage`. Scores are recorded under the guest user ID. If the user registers, `POST /auth/convert-guest` upgrades the row in-place, preserving all scores. This is intentional — players shouldn't lose their session results just because they didn't have an account.

See [docs/game-logic.md](docs/game-logic.md) for full scoring tables and [docs/api.md](docs/api.md) for the complete endpoint reference.

---

## Deployment

See [docs/deployment.md](docs/deployment.md) for a full production setup guide covering Nginx, pm2, SSL, and environment hardening.

---

## Contributing

1. Fork the repository
2. Create a branch: `git checkout -b feature/your-feature`
3. Keep backend changes covered by the schema migration pattern in `schema.sql` (idempotent `ALTER TABLE` blocks at the bottom)
4. Run `npm test` and manually verify audio playback before opening a PR
5. Open a pull request with a clear description of what changed and why

For significant changes, open an issue first to discuss the approach.

---

## Roadmap

- **Per-track album art on first load** — currently fetched lazily; batch embed fetches at game start would eliminate the placeholder flash
- **WebSocket-based H2H** — replace polling with a persistent connection for smoother real-time score updates
- **Playlist pagination** — the embed endpoint returns ~50 tracks; paging with Client Credentials is implemented but capped at 1,500
- **Difficulty-aware daily challenge** — currently fixed at Normal/Classic; surfacing difficulty as a daily option would add replay value
- **Replay mode** — let users replay a completed session to see which clips they missed on which tracks
- **Admin playlist management** — a lightweight internal endpoint for managing the daily rotation pool

---

## ⚠️ Spotify Platform Changes (Feb 2026)

On **February 6, 2026**, Spotify announced significant changes to its developer platform that restrict how new applications can access the Spotify Web API.

### Key Changes

- Development Mode now requires a **Spotify Premium account**
- Developers are limited to **one Client ID**
- Each app is limited to **up to five authorized users**
- API access is restricted to a **reduced set of endpoints**
- These rules apply to **all new apps**, and partially to existing ones

An update on March 9 confirmed that some restrictions (such as endpoint limitations for existing apps) were postponed, but core limits remain in effect.

### Impact on This Project

Audyn was originally developed in **December 2025**, before these restrictions were introduced.

- The live version at **audyn.xyz** continues to function using an existing (pre-change) Spotify Client ID
- However, **new developers may not be able to obtain equivalent API access**

If you are cloning or self-hosting this project:

- ⚠️ You may **not be able to create a usable Spotify app**
- ⚠️ New apps may be limited to **≤5 users and restricted endpoints**
- ⚠️ Full playlist pagination (50+ tracks) may not be available

### What Still Works Without API Keys

Audyn includes a fallback system that does **not rely on the Spotify API**:

- Playlist data is scraped from Spotify's public embed pages
- No authentication or API keys are required for basic functionality

Limitations of the fallback:

- Playlists are capped at ~50 tracks
- Some metadata and preview coverage may be incomplete

### Official Announcement

For full details, see Spotify's blog post:  
[https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security](https://developer.spotify.com/blog/2026-02-06-update-on-developer-access-and-platform-security)

---

## License

MIT License

Copyright (c) 2026 Privex