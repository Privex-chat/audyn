# Game Logic

## Clip Stages

Each round cycles through up to 5 audio clips of increasing length. A correct guess at any stage ends the round and awards points for that stage. A skip or wrong guess at the final stage (stage 4) ends the round with 0 points.

## Difficulty Configurations

| | Easy | Normal | Hard |
|---|---|---|---|
| Clip durations | 2s, 5s, 10s, 15s, 20s | 0.3s, 0.7s, 2s, 9s, 15s | 0.1s, 0.3s, 0.7s, 1.5s, 3s |
| Points per stage | 60, 45, 30, 20, 10 | 100, 80, 60, 30, 15 | 170, 130, 100, 60, 25 |
| Ticking Away decay rate | 1.0 pts/sec | 2.0 pts/sec | 3.5 pts/sec |
| Minimum score (% of base) | 60% | 40% | 25% |

## Game Modes

### Classic

Score = `points[clip_stage]`. No time penalty. The score for a given stage is fixed regardless of how long the player takes to type their guess.

### Ticking Away

Score is computed with a time decay applied within each stage:

```
base    = points[clip_stage]
min     = floor(base * min_score_pct)
penalty = min(floor(elapsed_seconds * decay_rate), base - min)
score   = base - penalty
```

`elapsed_seconds` is measured from when the clip starts playing to when the user submits their guess. The backend prefers the `elapsed_seconds` field sent by the client (which excludes audio loading time and mobile backgrounding) over reconstructing elapsed from raw timestamps.

### Streak Multiplier (Ticking Away only)

Consecutive correct guesses on the **first clip** (stage 0) build a streak. The multiplier is applied to the Ticking Away score before it's stored.

| Streak | Multiplier |
|---|---|
| 0–2 | ×1.0 |
| 3–4 | ×1.2 |
| 5–6 | ×1.5 |
| 7+ | ×2.0 |

Any wrong guess or skip resets the streak to 0. The server caps the multiplier at 2.0 and ignores multipliers in Classic mode.

## Guess Modes

**Song mode**: the autocomplete dropdown filters by track name and artist. A correct guess requires the selected track's ID to match the current track's ID.

**Artist mode**: the dropdown shows a deduplicated list of artist names. A correct guess requires the typed artist name to exactly match (case-insensitive) one of the artist names in the current track's `artist` field (comma-split for multi-artist tracks).

## Daily Challenge

- One challenge per calendar day (UTC midnight boundary)
- 10 tracks drawn from a rotating pool of curated playlists (`DAILY_PLAYLIST_IDS`)
- The playlist and shuffle order are determined by a deterministic `random.Random(date.isoformat())` seed, so all users get the same tracks in the same order
- Authenticated non-guest users can only complete each daily once — the server enforces this per `(user_id, daily_date, track_id)` uniqueness
- Daily scores are stored with `is_daily = TRUE` and contribute to both the daily leaderboard and the user's global score total
- Daily streaks are tracked per user (`daily_streak`, `last_daily_date`); the streak increments if the user played yesterday, resets to 1 otherwise

## Audio Clip Playback

The frontend picks a random start position in the first 29 seconds of the preview (to ensure even the longest clip fits within the 30-second Spotify preview window). The same start position is reused across all clip stages within a single round.

Howler.js is used for audio with Web Audio API mode by default. If the initial load fails, a single retry with HTML5 mode is attempted. On mobile devices where autoplay is blocked, a tap overlay is shown before the game begins to unlock the Web Audio context.

## Scoring Integrity

All scores are computed on the server. The score submission endpoint receives:
- `clip_stage` — which clip the user guessed on
- `elapsed_seconds` — client-measured time from clip start to guess
- `difficulty`, `game_mode`, `guess_mode` — validated against an allowlist
- `multiplier` — validated ≤ 2.0; ignored unless `game_mode == "ticking_away"` and `correct == true`
- `correct` — if `false`, score is forced to 0 regardless of other parameters

The backend independently applies the same `DIFFICULTIES` config that the frontend uses, so client-side manipulation of the points table has no effect.

## Achievement Triggers

| Badge | Trigger |
|---|---|
| Sharp Ear 🎯 | Correct on first clip (stage 0) |
| On Fire 🔥 | 5 correct first-clip guesses in a single session |
| Perfect Session 💯 | 100% correct in a session of 10+ songs |
| Daily Regular 📅 | 7-day daily challenge streak |
| Deep Cut 🗂️ | Play a playlist with 500+ tracks |
| Speed Demon 🚀 | Correct in under 2 seconds on Hard difficulty |
| Top 10 🏆 | In the top 10 global leaderboard |
| Night Owl 🌙 | Play between 2am–4am local time |
| Timeless ⏳ | 800+ score in a single Ticking Away session (10+ songs, Normal or Hard) |

Sharp Ear and Speed Demon are checked per track (immediately after score submission). The remaining badges are checked at session end via `POST /scores/session-complete`. All checks are idempotent — a badge awarded once is never awarded again.
