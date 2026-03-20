import time
from collections import OrderedDict
from datetime import date, datetime, timezone, timedelta

from fastapi import APIRouter, Query

from database import get_conn

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

_lb_cache = TTLCache(max_size=50, ttl_seconds=60)

lb_router = APIRouter(prefix="/api/leaderboard", tags=["leaderboard"])

@lb_router.get("/global")
async def global_leaderboard(
    period: str = Query("all", pattern="^(all|week|month)$"),
    game_mode: str = Query("classic", pattern="^(classic|ticking_away)$"),
    guess_mode: str = Query("song", pattern="^(song|artist)$"),
    limit: int = Query(50, ge=1, le=100),
):
    key = f"global:{period}:{game_mode}:{guess_mode}:{limit}"
    cached = _lb_cache.get(key)
    if cached is not None:
        return cached

    extra_clauses = "AND s.game_mode = $2 AND s.guess_mode = $3"
    params = [limit, game_mode, guess_mode]

    if period == "week":
        cutoff = datetime.now(timezone.utc) - timedelta(days=7)
        extra_clauses += f" AND s.guessed_at >= ${len(params) + 1}"
        params.append(cutoff)
    elif period == "month":
        cutoff = datetime.now(timezone.utc) - timedelta(days=30)
        extra_clauses += f" AND s.guessed_at >= ${len(params) + 1}"
        params.append(cutoff)

    async with get_conn() as conn:
        rows = await conn.fetch(
            f"""
            SELECT
                u.id,
                u.username,
                u.avatar_url,
                COALESCE(SUM(s.final_score), 0)::bigint AS total_score,
                COUNT(s.id)::int AS tracks_guessed,
                ROW_NUMBER() OVER (ORDER BY SUM(s.final_score) DESC) AS rank
            FROM scores s
            JOIN users u ON u.id = s.user_id
            WHERE u.is_guest = FALSE
              AND s.final_score > 0
              {extra_clauses}
            GROUP BY u.id, u.username, u.avatar_url
            ORDER BY total_score DESC
            LIMIT $1
            """,
            *params,
        )

    result = [
        {
            "rank": r["rank"],
            "user_id": str(r["id"]),
            "username": r["username"],
            "avatar_url": r["avatar_url"] or "",
            "total_score": r["total_score"],
            "tracks_guessed": r["tracks_guessed"],
        }
        for r in rows
    ]
    _lb_cache.set(key, result)
    return result

@lb_router.get("/daily")
async def daily_leaderboard(
    day: str = Query(None, description="YYYY-MM-DD format; defaults to today"),
    game_mode: str = Query("classic", pattern="^(classic|ticking_away)$"),
    guess_mode: str = Query("song", pattern="^(song|artist)$"),
    limit: int = Query(50, ge=1, le=100),
):
    """
    Daily challenge leaderboard for a specific date.
    Returns: rank, username, avatar_url, total_score, tracks_guessed.
    """
    try:
        target = date.fromisoformat(day) if day else date.today()
    except ValueError:
        target = date.today()

    key = f"daily:{target}:{game_mode}:{guess_mode}:{limit}"
    cached = _lb_cache.get(key)
    if cached is not None:
        return cached

    async with get_conn() as conn:
        rows = await conn.fetch(
            """
            SELECT
                u.id,
                u.username,
                u.avatar_url,
                COALESCE(SUM(s.final_score), 0)::bigint AS total_score,
                COUNT(s.id)::int AS tracks_guessed,
                ROW_NUMBER() OVER (ORDER BY SUM(s.final_score) DESC) AS rank
            FROM scores s
            JOIN users u ON u.id = s.user_id
            WHERE s.is_daily = TRUE
              AND s.daily_date = $1
              AND s.game_mode = $3
              AND s.guess_mode = $4
              AND u.is_guest = FALSE
              AND s.final_score > 0
            GROUP BY u.id, u.username, u.avatar_url
            ORDER BY total_score DESC
            LIMIT $2
            """,
            target,
            limit,
            game_mode,
            guess_mode,
        )

    result = [
        {
            "rank": r["rank"],
            "user_id": str(r["id"]),
            "username": r["username"],
            "avatar_url": r["avatar_url"] or "",
            "total_score": r["total_score"],
            "tracks_guessed": r["tracks_guessed"],
        }
        for r in rows
    ]
    _lb_cache.set(key, result)
    return result

@lb_router.get("/user/{user_id}")
async def user_stats(user_id: str):
    """Get a specific user's aggregate stats and rank."""
    async with get_conn() as conn:
        user = await conn.fetchrow(
            "SELECT id, username, avatar_url, bio FROM users WHERE id = $1::uuid AND is_guest = FALSE",
            user_id,
        )
        if not user:
            from fastapi import HTTPException
            raise HTTPException(status_code=404, detail="User not found")

        stats = await conn.fetchrow(
            """
            SELECT
                COALESCE(SUM(final_score), 0)::bigint AS total_score,
                COUNT(id)::int AS tracks_guessed,
                COUNT(DISTINCT playlist_id)::int AS playlists_played
            FROM scores
            WHERE user_id = $1::uuid AND final_score > 0
            """,
            user_id,
        )

        rank = await conn.fetchval(
            """
            SELECT rank FROM (
                SELECT user_id, ROW_NUMBER() OVER (ORDER BY SUM(final_score) DESC) AS rank
                FROM scores
                JOIN users u ON u.id = scores.user_id
                WHERE u.is_guest = FALSE AND scores.final_score > 0
                GROUP BY user_id
            ) ranked
            WHERE user_id = $1::uuid
            """,
            user_id,
        )

    return {
        "user_id": str(user["id"]),
        "username": user["username"],
        "avatar_url": user["avatar_url"] or "",
        "bio": user["bio"] or "",
        "total_score": stats["total_score"],
        "tracks_guessed": stats["tracks_guessed"],
        "playlists_played": stats["playlists_played"],
        "global_rank": rank,
    }
