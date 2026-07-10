import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Query, Depends

from auth import get_current_user
from database import get_conn

logger = logging.getLogger(__name__)

stats_router = APIRouter(prefix="/api", tags=["stats"])

_cache = {"value": 0, "expires": 0.0}

@stats_router.get("/stats/activity")
async def get_activity():
    now = datetime.now(timezone.utc)

    if now.timestamp() < _cache["expires"]:
        return {"players_today": _cache["value"]}

    cutoff = now.replace(hour=0, minute=0, second=0, microsecond=0)
    async with get_conn() as conn:
        # user_id is UUID and session_id is VARCHAR — COALESCE needs one type,
        # otherwise Postgres rejects the query (42804) and this endpoint 500s.
        count = await conn.fetchval(
            """
            SELECT COUNT(DISTINCT COALESCE(user_id::text, session_id))
            FROM game_sessions
            WHERE created_at >= $1
            """,
            cutoff,
        )

    result = count or 0
    _cache["value"] = result
    _cache["expires"] = now.timestamp() + 30
    return {"players_today": result}

@stats_router.get("/stats/recent-playlists")
async def get_recent_playlists(
    ids: str = Query(None, description="Comma-separated playlist IDs for guest mode"),
    user=Depends(get_current_user),
):
    if user and not user.get("is_guest"):
        async with get_conn() as conn:
            rows = await conn.fetch(
                """
                SELECT p.playlist_id, p.name, p.image_url, p.total_in_playlist
                FROM (
                    SELECT playlist_id, MAX(guessed_at) AS last_played
                    FROM scores
                    WHERE user_id = $1 AND playlist_id IS NOT NULL
                    GROUP BY playlist_id
                ) recent
                JOIN playlists p ON p.playlist_id = recent.playlist_id
                ORDER BY recent.last_played DESC
                LIMIT 5
                """,
                user["id"],
            )
        return [
            {
                "playlist_id": r["playlist_id"],
                "name": r["name"],
                "image_url": r["image_url"] or "",
                "total_tracks": r["total_in_playlist"] or 0,
            }
            for r in rows
        ]
    elif ids:
        id_list = [i.strip() for i in ids.split(",") if i.strip()][:5]
        if not id_list:
            return []
        async with get_conn() as conn:
            rows = await conn.fetch(
                """
                SELECT playlist_id, name, image_url, total_in_playlist
                FROM playlists
                WHERE playlist_id = ANY($1)
                """,
                id_list,
            )
        return [
            {
                "playlist_id": r["playlist_id"],
                "name": r["name"],
                "image_url": r["image_url"] or "",
                "total_tracks": r["total_in_playlist"] or 0,
            }
            for r in rows
        ]
    else:
        return []
