-- backend/schema.sql
-- Audyn PostgreSQL Schema (idempotent — safe to re-run)
-- Run: psql $DATABASE_URL -f schema.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Users ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username        VARCHAR(30)  UNIQUE NOT NULL,
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    display_name    VARCHAR(50)  DEFAULT '',
    bio             VARCHAR(160) DEFAULT '',
    avatar_url      TEXT DEFAULT '',
    link_spotify    TEXT DEFAULT '',
    link_instagram  TEXT DEFAULT '',
    link_pinterest  TEXT DEFAULT '',
    is_guest        BOOLEAN DEFAULT FALSE,
    daily_streak    INT  DEFAULT 0,
    last_daily_date DATE,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_is_guest
    ON users(is_guest) WHERE is_guest = FALSE;

-- ─── Playlists (Spotify cache) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS playlists (
    playlist_id         VARCHAR(64) PRIMARY KEY,
    name                TEXT NOT NULL DEFAULT 'Unknown Playlist',
    image_url           TEXT DEFAULT '',
    total_in_playlist   INT DEFAULT 0,
    skipped_no_preview  INT DEFAULT 0,
    fetched_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Tracks (Spotify cache) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tracks (
    track_id              VARCHAR(64) PRIMARY KEY,
    name                  TEXT NOT NULL DEFAULT '',
    artist                TEXT NOT NULL DEFAULT '',
    preview_url           TEXT DEFAULT '',
    album_name            TEXT DEFAULT '',
    album_image           TEXT DEFAULT '',
    duration_ms           INT     DEFAULT 0,
    explicit              BOOLEAN DEFAULT FALSE,
    popularity            INT     DEFAULT 0,
    preview_retry_count   INT     DEFAULT 0,
    preview_unavailable   BOOLEAN DEFAULT FALSE,
    updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tracks_needs_preview
    ON tracks(track_id)
    WHERE (preview_url IS NULL OR preview_url = '')
      AND preview_unavailable = FALSE;

-- ─── Playlist ↔ Track join table (preserves ordering) ───────────────
CREATE TABLE IF NOT EXISTS playlist_tracks (
    playlist_id VARCHAR(64) REFERENCES playlists(playlist_id) ON DELETE CASCADE,
    track_id    VARCHAR(64) REFERENCES tracks(track_id)       ON DELETE CASCADE,
    position    INT NOT NULL,
    PRIMARY KEY (playlist_id, track_id)
);

-- ─── Daily Challenges ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_challenges (
    challenge_date  DATE PRIMARY KEY,
    playlist_id     VARCHAR(64) REFERENCES playlists(playlist_id),
    track_ids       TEXT[] NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Album Art Cache (legacy — superseded by tracks.album_image) ────
-- No longer written to or read from. Safe to DROP on a fresh install.
CREATE TABLE IF NOT EXISTS album_art (
    track_id   VARCHAR(64) PRIMARY KEY,
    art_url    TEXT NOT NULL DEFAULT '',
    fetched_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Head-to-Head Rooms ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rooms (
    id              UUID       PRIMARY KEY DEFAULT gen_random_uuid(),
    room_code       VARCHAR(6) UNIQUE NOT NULL,
    host_user_id    UUID       REFERENCES users(id) ON DELETE CASCADE,
    guest_user_id   UUID       REFERENCES users(id) ON DELETE SET NULL,
    playlist_id     VARCHAR(64),
    song_count      INT         DEFAULT 10,
    difficulty      VARCHAR(16) DEFAULT 'normal',
    game_mode       VARCHAR(16) DEFAULT 'classic',
    guess_mode      VARCHAR(16) DEFAULT 'song',
    track_ids       TEXT[]      NOT NULL DEFAULT '{}',
    status          VARCHAR(16) DEFAULT 'waiting',
    host_score      INT DEFAULT 0,
    guest_score     INT DEFAULT 0,
    host_progress   INT DEFAULT 0,
    guest_progress  INT DEFAULT 0,
    host_correct    INT DEFAULT 0,
    guest_correct   INT DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    expires_at      TIMESTAMPTZ DEFAULT NOW() + INTERVAL '30 minutes'
);

CREATE INDEX IF NOT EXISTS idx_rooms_code   ON rooms(room_code);
CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);

-- ─── Server-side Game Sessions ──────────────────────────────────────
-- tracks JSONB map: { "<track_id>": {
--   "name": str, "artist": str, "position": int,
--   "answered": bool, "current_stage": int,
--   "started_at": str|null
-- }}
CREATE TABLE IF NOT EXISTS game_sessions (
    session_id  VARCHAR(32) PRIMARY KEY,
    user_id     UUID        REFERENCES users(id)  ON DELETE CASCADE,
    playlist_id VARCHAR(64),
    room_id     UUID        REFERENCES rooms(id)  ON DELETE SET NULL,
    game_mode   VARCHAR(16) NOT NULL DEFAULT 'classic',
    guess_mode  VARCHAR(16) NOT NULL DEFAULT 'song',
    difficulty  VARCHAR(16) NOT NULL DEFAULT 'normal',
    is_daily    BOOLEAN     DEFAULT FALSE,
    tracks      JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    expires_at  TIMESTAMPTZ DEFAULT NOW() + INTERVAL '2 hours'
);

-- Fast lookup: "did this user already start a daily session today?"
CREATE INDEX IF NOT EXISTS idx_game_sessions_user_daily
    ON game_sessions(user_id, is_daily, created_at)
    WHERE is_daily = TRUE;

-- Used by periodic cleanup: DELETE FROM game_sessions WHERE expires_at < NOW() - INTERVAL '1 day';
CREATE INDEX IF NOT EXISTS idx_game_sessions_expires
    ON game_sessions(expires_at);

-- ─── Scores (server-authoritative) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS scores (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID        REFERENCES users(id)             ON DELETE CASCADE,
    playlist_id      VARCHAR(64) REFERENCES playlists(playlist_id) ON DELETE CASCADE,
    track_id         VARCHAR(64) REFERENCES tracks(track_id),
    session_id       VARCHAR(32) REFERENCES game_sessions(session_id) ON DELETE SET NULL,
    game_mode        VARCHAR(16) NOT NULL DEFAULT 'classic',
    guess_mode       VARCHAR(16) NOT NULL DEFAULT 'song',
    base_score       INT  NOT NULL,
    time_penalty     INT  NOT NULL DEFAULT 0,
    final_score      INT  NOT NULL,
    multiplier       REAL DEFAULT 1.0,
    clip_length_used REAL DEFAULT 0,
    clip_stage       SMALLINT DEFAULT 0,
    elapsed_seconds  REAL DEFAULT 0,
    is_correct       BOOLEAN DEFAULT FALSE,
    client_ip        INET,
    is_daily         BOOLEAN DEFAULT FALSE,
    daily_date       DATE,
    guessed_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scores_user        ON scores(user_id);
CREATE INDEX IF NOT EXISTS idx_scores_playlist    ON scores(playlist_id);
CREATE INDEX IF NOT EXISTS idx_scores_daily       ON scores(is_daily, daily_date);
CREATE INDEX IF NOT EXISTS idx_scores_guessed_at  ON scores(guessed_at);
CREATE INDEX IF NOT EXISTS idx_scores_game_mode   ON scores(game_mode);
CREATE INDEX IF NOT EXISTS idx_scores_session     ON scores(session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_scores_final_score ON scores(final_score) WHERE final_score > 0;
CREATE INDEX IF NOT EXISTS idx_scores_user_score  ON scores(user_id, final_score) WHERE final_score > 0;

-- ─── Shares (shareable score cards) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS shares (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    share_id        VARCHAR(16) UNIQUE NOT NULL,
    username        VARCHAR(60)  NOT NULL DEFAULT 'Guest',
    score           INT NOT NULL DEFAULT 0,
    max_score       INT NOT NULL DEFAULT 0,
    correct_guesses INT NOT NULL DEFAULT 0,
    total_tracks    INT NOT NULL DEFAULT 0,
    playlist_id     VARCHAR(64) DEFAULT '',
    playlist_name   TEXT NOT NULL DEFAULT '',
    playlist_image  TEXT DEFAULT '',
    difficulty      VARCHAR(16) NOT NULL DEFAULT 'normal',
    game_mode       VARCHAR(16) NOT NULL DEFAULT 'classic',
    guess_mode      VARCHAR(16) NOT NULL DEFAULT 'song',
    is_daily        BOOLEAN DEFAULT FALSE,
    results         JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_shares_share_id ON shares(share_id);
CREATE INDEX IF NOT EXISTS idx_shares_created  ON shares(created_at);

-- ─── Achievements ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS achievements (
    key         VARCHAR(32) PRIMARY KEY,
    label       VARCHAR(60) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    emoji       VARCHAR(8)  NOT NULL DEFAULT '🏅',
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO achievements (key, label, description, emoji) VALUES
    ('sharp_ear',     'Sharp Ear',        'First-clip correct guess on any track',                                '🎯'),
    ('on_fire',       'On Fire',          '5 correct first-clip guesses in one session',                         '🔥'),
    ('perfect',       'Perfect Session',  '100% correct in a session of 10+ songs',                              '💯'),
    ('daily_regular', 'Daily Regular',    'Complete daily challenge 7 days in a row',                            '📅'),
    ('deep_cut',      'Deep Cut',         'Play a playlist with 500+ tracks',                                    '🗂️'),
    ('speed_demon',   'Speed Demon',      'Guess correct in under 2s on Hard difficulty',                        '🚀'),
    ('top_10',        'Top 10',           'Reach top 10 on the global leaderboard',                              '🏆'),
    ('night_owl',     'Night Owl',        'Play between 2am–4am local time',                                     '🌙'),
    ('timeless',      'Timeless',         'Score 800+ in a single Ticking Away session (10+ songs, Normal or Hard)', '⏳')
ON CONFLICT (key) DO NOTHING;

-- ─── User Achievements (join table) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS user_achievements (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        REFERENCES users(id)        ON DELETE CASCADE,
    achievement_key VARCHAR(32) REFERENCES achievements(key) ON DELETE CASCADE,
    earned_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, achievement_key)
);

CREATE INDEX IF NOT EXISTS idx_user_achievements_user ON user_achievements(user_id);

-- ─── Disable Row Level Security (Supabase deployments) ──────────────
ALTER TABLE users             DISABLE ROW LEVEL SECURITY;
ALTER TABLE playlists         DISABLE ROW LEVEL SECURITY;
ALTER TABLE tracks            DISABLE ROW LEVEL SECURITY;
ALTER TABLE playlist_tracks   DISABLE ROW LEVEL SECURITY;
ALTER TABLE scores            DISABLE ROW LEVEL SECURITY;
ALTER TABLE daily_challenges  DISABLE ROW LEVEL SECURITY;
ALTER TABLE shares            DISABLE ROW LEVEL SECURITY;
ALTER TABLE achievements      DISABLE ROW LEVEL SECURITY;
ALTER TABLE user_achievements DISABLE ROW LEVEL SECURITY;
ALTER TABLE rooms             DISABLE ROW LEVEL SECURITY;
ALTER TABLE album_art         DISABLE ROW LEVEL SECURITY;
ALTER TABLE game_sessions     DISABLE ROW LEVEL SECURITY;