import os
import random
import logging
from datetime import date, timedelta, datetime, timezone

from fastapi import APIRouter, HTTPException, Depends

from database import get_conn
from auth import get_current_user

logger = logging.getLogger(__name__)

daily_router = APIRouter(prefix="/api/daily", tags=["daily"])

async def update_daily_streak(user_id):
    today = datetime.now(timezone.utc).date()
    yesterday = today - timedelta(days=1)

    async with get_conn() as conn:
        row = await conn.fetchrow(
            "SELECT daily_streak, last_daily_date FROM users WHERE id = $1",
            user_id,
        )
        if not row:
            return

        last_date = row["last_daily_date"]
        current_streak = row["daily_streak"] or 0

        if last_date == today:
            return
        elif last_date == yesterday:
            new_streak = current_streak + 1
        else:
            new_streak = 1

        await conn.execute(
            "UPDATE users SET daily_streak = $1, last_daily_date = $2 WHERE id = $3",
            new_streak, today, user_id,
        )
        logger.info(f"Daily streak updated: user={user_id} streak={new_streak}")

DAILY_PLAYLIST_IDS = [
    "37i9dQZF1DXcBWIGoYBM5M",  # Today's Top Hits
    "37i9dQZF1DX0XUsuxWHRQd",  # RapCaviar
    "37i9dQZF1DWXRqgorJj26U",  # Rock Classics
    "37i9dQZF1DX4JAvHpjipBk",  # New Music Friday
    "37i9dQZF1DX4sWSpwq3LiO",  # Peaceful Piano
    "37i9dQZF1DWWEJlAGA9gs0",  # Classical Essentials
    "37i9dQZF1DX4dyzvuaRJ0n",  # mint
]

DAILY_TRACK_COUNT = int(os.environ.get("DAILY_TRACK_COUNT", "10"))

async def get_or_create_daily(target_date: date | None = None) -> dict:
    target_date = target_date or datetime.now(timezone.utc).date()

    async with get_conn() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM daily_challenges WHERE challenge_date = $1",
            target_date,
        )
        if row:
            return dict(row)

        idx = target_date.timetuple().tm_yday % len(DAILY_PLAYLIST_IDS)
        playlist_id = DAILY_PLAYLIST_IDS[idx]

        tracks = await conn.fetch(
            """
            SELECT t.track_id
            FROM playlist_tracks pt
            JOIN tracks t ON t.track_id = pt.track_id
            WHERE pt.playlist_id = $1
              AND t.preview_url IS NOT NULL
              AND t.preview_url != ''
            ORDER BY pt.position
            """,
            playlist_id,
        )
        needs_fetch = len(tracks) < DAILY_TRACK_COUNT

    if needs_fetch:
        logger.info(f"Daily playlist {playlist_id} not cached, fetching from Spotify...")
        try:
            from server import fetch_playlist
            await fetch_playlist(playlist_id)
        except Exception as e:
            logger.error(f"Failed to auto-fetch daily playlist {playlist_id}: {e}")
            raise HTTPException(
                status_code=503,
                detail=(
                    f"Daily challenge playlist ({playlist_id}) could not be loaded. "
                    "Please try again in a moment."
                ),
            )

    async with get_conn() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM daily_challenges WHERE challenge_date = $1",
            target_date,
        )
        if row:
            return dict(row)

        tracks = await conn.fetch(
            """
            SELECT t.track_id
            FROM playlist_tracks pt
            JOIN tracks t ON t.track_id = pt.track_id
            WHERE pt.playlist_id = $1
              AND t.preview_url IS NOT NULL
              AND t.preview_url != ''
            ORDER BY pt.position
            """,
            playlist_id,
        )

        if len(tracks) < DAILY_TRACK_COUNT:
            raise HTTPException(
                status_code=503,
                detail=(
                    f"Daily challenge playlist ({playlist_id}) has fewer than "
                    f"{DAILY_TRACK_COUNT} playable tracks."
                ),
            )

        rng = random.Random(target_date.isoformat())
        all_ids = [r["track_id"] for r in tracks]
        rng.shuffle(all_ids)
        selected = all_ids[:DAILY_TRACK_COUNT]

        await conn.execute(
            """
            INSERT INTO daily_challenges (challenge_date, playlist_id, track_ids)
            VALUES ($1, $2, $3)
            ON CONFLICT (challenge_date) DO NOTHING
            """,
            target_date,
            playlist_id,
            selected,
        )

        logger.info(
            f"Created daily challenge for {target_date}: "
            f"playlist={playlist_id}, {len(selected)} tracks"
        )

        return {
            "challenge_date": target_date,
            "playlist_id": playlist_id,
            "track_ids": selected,
        }

@daily_router.get("/today")
async def get_daily_challenge(user=Depends(get_current_user)):
    challenge = await get_or_create_daily()
    track_ids = challenge["track_ids"]

    async with get_conn() as conn:
        rows = await conn.fetch(
            """
            SELECT track_id, name, artist, preview_url, album_name, album_image,
                   duration_ms, explicit, popularity
            FROM tracks
            WHERE track_id = ANY($1)
            """,
            track_ids,
        )

    def map_track(r):
        d = dict(r)
        d["id"] = d.get("track_id", "")
        return d

    tracks_by_id = {r["track_id"]: map_track(r) for r in rows}
    ordered_tracks = [tracks_by_id[tid] for tid in track_ids if tid in tracks_by_id]

    already_played = False
    user_streak = 0
    if user and not user.get("is_guest"):
        async with get_conn() as conn:
            count = await conn.fetchval(
                """
                SELECT COUNT(*) FROM scores
                WHERE user_id = $1 AND is_daily = TRUE AND daily_date = $2
                """,
                user["id"],
                datetime.now(timezone.utc).date(),
            )
            already_played = (count or 0) > 0

            streak_val = await conn.fetchval(
                "SELECT daily_streak FROM users WHERE id = $1",
                user["id"],
            )
            user_streak = streak_val or 0

    return {
        "date": str(challenge["challenge_date"]),
        "playlist_id": challenge["playlist_id"],
        "tracks": ordered_tracks,
        "track_count": len(ordered_tracks),
        "already_played": already_played,
        "user_streak": user_streak,
    }

@daily_router.get("/history")
async def daily_history(
    days: int = 7,
    user=Depends(get_current_user),
):
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")

    async with get_conn() as conn:
        rows = await conn.fetch(
            """
            SELECT
                daily_date,
                SUM(final_score)::int  AS total_score,
                COUNT(id)::int         AS tracks_played,
                MAX(guessed_at)        AS completed_at
            FROM scores
            WHERE user_id = $1
              AND is_daily = TRUE
              AND daily_date >= CURRENT_DATE - $2::int
            GROUP BY daily_date
            ORDER BY daily_date DESC
            """,
            user["id"],
            days,
        )

    return [dict(r) for r in rows]
