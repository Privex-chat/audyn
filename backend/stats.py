import logging
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Query, Depends

from auth import get_current_user
from database import get_conn

logger = logging.getLogger(__name__)

stats_router = APIRouter(prefix="/api", tags=["stats"])

@stats_router.get("/stats/activity")
async def get_activity():
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    async with get_conn() as conn:
        count = await conn.fetchval(
            "SELECT COUNT(DISTINCT user_id) FROM scores WHERE guessed_at >= $1",
            cutoff,
        )
    return {"players_today": count or 0}

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
