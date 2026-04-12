import logging
import time
from collections import OrderedDict
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends

from auth import require_user
from database import get_conn

logger = logging.getLogger(__name__)

class TTLCache:
    def __init__(self, max_size=100, ttl_seconds=600):
        self._store: OrderedDict = OrderedDict()
        self._timestamps: dict = {}
        self.max_size = max_size
        self.ttl = ttl_seconds

    def get(self, key):
        if key in self._store:
            if time.time() - self._timestamps[key] < self.ttl:
                self._store.move_to_end(key)
                return self._store[key]
            del self._store[key]
            del self._timestamps[key]
        return None

    def set(self, key, value):
        if value is None:
            self.delete(key)
            return
        if key in self._store:
            del self._store[key]
        elif len(self._store) >= self.max_size:
            oldest = next(iter(self._store))
            del self._store[oldest]
            self._timestamps.pop(oldest, None)
        self._store[key] = value
        self._timestamps[key] = time.time()

    def delete(self, key):
        self._store.pop(key, None)
        self._timestamps.pop(key, None)

_rank_cache = TTLCache(max_size=1000, ttl_seconds=120)

achievements_router = APIRouter(prefix="/api/achievements", tags=["achievements"])

BADGES = {
    "sharp_ear":     {"emoji": "🎯", "label": "Sharp Ear"},
    "on_fire":       {"emoji": "🔥", "label": "On Fire"},
    "perfect":       {"emoji": "💯", "label": "Perfect Session"},
    "daily_regular": {"emoji": "📅", "label": "Daily Regular"},
    "deep_cut":      {"emoji": "🗂️",  "label": "Deep Cut"},
    "speed_demon":   {"emoji": "🚀", "label": "Speed Demon"},
    "top_10":        {"emoji": "🏆", "label": "Top 10"},
    "night_owl":     {"emoji": "🌙", "label": "Night Owl"},
    "timeless":      {"emoji": "⏳", "label": "Timeless"},
}

async def award_badge(conn, user_id, key: str):
    existing = await conn.fetchval(
        "SELECT 1 FROM user_achievements WHERE user_id = $1 AND achievement_key = $2",
        user_id, key,
    )
    if existing:
        return False
    await conn.execute(
        "INSERT INTO user_achievements (user_id, achievement_key) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        user_id, key,
    )
    logger.info(f"Badge awarded: {key} -> user {user_id}")
    return True

async def check_per_track_achievements(user_id, track_result: dict, difficulty: str):
    if not user_id:
        return []
    newly_awarded = []
    async with get_conn() as conn:
        if track_result.get("correct") and track_result.get("clip_stage", -1) == 0:
            if await award_badge(conn, user_id, "sharp_ear"):
                newly_awarded.append("sharp_ear")
        if (
            difficulty == "hard"
            and track_result.get("correct")
            and track_result.get("elapsed_seconds", 999) < 2.0
        ):
            if await award_badge(conn, user_id, "speed_demon"):
                newly_awarded.append("speed_demon")
    return newly_awarded

async def check_achievements(
    user_id,
    session_results: list,
    difficulty: str,
    playlist_id: str = "",
    session_id: str | None = None,
    game_mode: str = "classic",
    # FIX: accept the player's local hour so night_owl uses their local time,
    # not the server's UTC time. Falls back to UTC if not provided.
    client_hour: int | None = None,
):
    if not user_id:
        return []

    newly_awarded = []

    async with get_conn() as conn:
        for r in session_results:
            if r.get("correct") and r.get("clip_stage", -1) == 0:
                if await award_badge(conn, user_id, "sharp_ear"):
                    newly_awarded.append("sharp_ear")
                break

        first_clip_correct = sum(
            1 for r in session_results
            if r.get("correct") and r.get("clip_stage", -1) == 0
        )
        if first_clip_correct >= 5:
            if await award_badge(conn, user_id, "on_fire"):
                newly_awarded.append("on_fire")

        total = len(session_results)
        correct_count = sum(1 for r in session_results if r.get("correct"))
        if total >= 10 and correct_count == total:
            if await award_badge(conn, user_id, "perfect"):
                newly_awarded.append("perfect")

        streak = await conn.fetchval(
            "SELECT daily_streak FROM users WHERE id = $1", user_id
        )
        if streak and streak >= 7:
            if await award_badge(conn, user_id, "daily_regular"):
                newly_awarded.append("daily_regular")

        if playlist_id:
            db_count = await conn.fetchval(
                "SELECT total_in_playlist FROM playlists WHERE playlist_id = $1",
                playlist_id,
            )
            if db_count and db_count >= 500:
                if await award_badge(conn, user_id, "deep_cut"):
                    newly_awarded.append("deep_cut")

        if difficulty == "hard":
            recent_hard = await conn.fetch(
                """
                SELECT elapsed_seconds FROM scores
                WHERE user_id = $1 AND game_mode != 'classic'
                ORDER BY guessed_at DESC
                LIMIT $2
                """,
                user_id,
                len(session_results) if session_results else 10,
            )
            if any(
                r["elapsed_seconds"] is not None and r["elapsed_seconds"] < 2.0
                for r in recent_hard
            ):
                if await award_badge(conn, user_id, "speed_demon"):
                    newly_awarded.append("speed_demon")

        rank_cache_key = str(user_id)
        rank = _rank_cache.get(rank_cache_key)
        if rank is None:
            rank = await conn.fetchval(
                """
                SELECT rank FROM (
                    SELECT user_id, ROW_NUMBER() OVER (ORDER BY SUM(final_score) DESC) AS rank
                    FROM scores
                    JOIN users u ON u.id = scores.user_id
                    WHERE u.is_guest = FALSE AND scores.final_score > 0
                    GROUP BY user_id
                ) ranked
                WHERE user_id = $1
                """,
                user_id,
            )
            _rank_cache.set(rank_cache_key, rank)
        if rank and rank <= 10:
            if await award_badge(conn, user_id, "top_10"):
                newly_awarded.append("top_10")

        # FIX: use the client's local hour when provided so the badge reflects
        # the player's actual local time rather than the server's UTC clock.
        hour_to_check = client_hour if client_hour is not None else datetime.now(timezone.utc).hour
        if 2 <= hour_to_check < 4:
            if await award_badge(conn, user_id, "night_owl"):
                newly_awarded.append("night_owl")

        if (
            game_mode == "ticking_away"
            and difficulty in ("normal", "hard")
            and len(session_results) >= 10
        ):
            if session_id:
                recent_scores = await conn.fetch(
                    """
                    SELECT final_score FROM scores
                    WHERE user_id = $1 AND game_mode = 'ticking_away'
                      AND session_id = $2
                    """,
                    user_id,
                    session_id,
                )
            else:
                cutoff = datetime.now(timezone.utc) - timedelta(minutes=30)
                recent_scores = await conn.fetch(
                    """
                    SELECT final_score FROM scores
                    WHERE user_id = $1 AND game_mode = 'ticking_away'
                      AND guessed_at >= $2
                    """,
                    user_id,
                    cutoff,
                )
            db_session_total = sum(r["final_score"] for r in recent_scores)
            if db_session_total >= 800:
                if await award_badge(conn, user_id, "timeless"):
                    newly_awarded.append("timeless")

    return newly_awarded

@achievements_router.get("/my")
async def get_my_achievements(user=Depends(require_user)):
    async with get_conn() as conn:
        rows = await conn.fetch(
            """
            SELECT a.key, a.label, a.description, a.emoji, ua.earned_at
            FROM user_achievements ua
            JOIN achievements a ON a.key = ua.achievement_key
            WHERE ua.user_id = $1
            ORDER BY ua.earned_at DESC
            """,
            user["id"],
        )
        earned = {
            r["key"]: {
                "key": r["key"],
                "label": r["label"],
                "description": r["description"],
                "emoji": r["emoji"],
                "earned_at": r["earned_at"].isoformat(),
            }
            for r in rows
        }
        badge_rows = await conn.fetch(
            "SELECT key, label, description, emoji FROM achievements ORDER BY key"
        )

    return [
        {
            "key": b["key"],
            "label": b["label"],
            "description": b["description"],
            "emoji": b["emoji"],
            "earned": b["key"] in earned,
            "earned_at": earned[b["key"]]["earned_at"] if b["key"] in earned else None,
        }
        for b in badge_rows
    ]