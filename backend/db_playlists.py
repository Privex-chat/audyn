import logging
from datetime import datetime, timezone, timedelta
from database import get_conn

logger = logging.getLogger(__name__)

PLAYLIST_TTL_DAYS = 7

async def load_playlist(playlist_id: str) -> dict | None:
    """
    Load a cached playlist + its tracks from PostgreSQL.
    Returns None if not found or expired (older than PLAYLIST_TTL_DAYS).
    Only returns tracks that have a non-empty preview_url.
    """
    async with get_conn() as conn:
        row = await conn.fetchrow(
            "SELECT * FROM playlists WHERE playlist_id = $1", playlist_id
        )
        if not row:
            return None

        age = datetime.now(timezone.utc) - row["fetched_at"]
        if age > timedelta(days=PLAYLIST_TTL_DAYS):
            logger.info(f"Playlist {playlist_id} expired ({age.days} days old)")
            return None

        tracks = await conn.fetch("""
            SELECT
                t.track_id AS id,
                t.name,
                t.artist,
                t.preview_url,
                t.album_name,
                t.duration_ms,
                t.explicit,
                t.popularity
            FROM playlist_tracks pt
            JOIN tracks t ON t.track_id = pt.track_id
            WHERE pt.playlist_id = $1
              AND t.preview_url IS NOT NULL
              AND t.preview_url != ''
            ORDER BY pt.position
        """, playlist_id)

        if not tracks:
            return None

        track_list = [
            {
                "id": r["id"],
                "name": r["name"],
                "artist": r["artist"],
                "preview_url": r["preview_url"],
                "album_name": r["album_name"],
                "album_image": "",  # loaded on demand via /tracks/art
                "duration_ms": r["duration_ms"] or 0,
                "explicit": r["explicit"] or False,
                "popularity": r["popularity"] or 0,
            }
            for r in tracks
        ]

        logger.info(f"Loaded playlist '{row['name']}' from DB: {len(track_list)} tracks")

        return {
            "playlist_id": playlist_id,
            "name": row["name"],
            "image": row["image_url"],
            "tracks": track_list,
            "total_tracks": len(track_list),
            "total_in_playlist": row["total_in_playlist"],
            "skipped_no_preview": row["skipped_no_preview"],
            "source": "database",
        }

async def save_playlist(playlist_id: str, result: dict):
    tracks = result.get("tracks", [])
    if not tracks:
        return

    async with get_conn() as conn:
        async with conn.transaction():
            await conn.execute("""
                INSERT INTO playlists (playlist_id, name, image_url, total_in_playlist, skipped_no_preview, fetched_at)
                VALUES ($1, $2, $3, $4, $5, NOW())
                ON CONFLICT (playlist_id) DO UPDATE SET
                    name               = $2,
                    image_url          = $3,
                    total_in_playlist  = $4,
                    skipped_no_preview = $5,
                    fetched_at         = NOW()
            """,
                playlist_id,
                result.get("name", ""),
                result.get("image", ""),
                result.get("total_in_playlist", 0),
                result.get("skipped_no_preview", 0),
            )

            await conn.execute(
                "DELETE FROM playlist_tracks WHERE playlist_id = $1", playlist_id
            )

            for i, t in enumerate(tracks):
                track_id = t.get("id", "")
                if not track_id:
                    continue

                await conn.execute("""
                    INSERT INTO tracks (
                        track_id, name, artist, preview_url, album_name, album_image,
                        duration_ms, explicit, popularity, updated_at
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
                    ON CONFLICT (track_id) DO UPDATE SET
                        name        = $2,
                        artist      = $3,
                        preview_url = $4,
                        album_name  = $5,
                        album_image = CASE WHEN $6 != '' THEN $6 ELSE tracks.album_image END,
                        duration_ms = $7,
                        explicit    = $8,
                        popularity  = $9,
                        updated_at  = NOW()
                """,
                    track_id,
                    t.get("name", ""),
                    t.get("artist", ""),
                    t.get("preview_url", ""),
                    t.get("album_name", ""),
                    t.get("album_image", ""),
                    t.get("duration_ms", 0),
                    t.get("explicit", False),
                    t.get("popularity", 0),
                )

                await conn.execute("""
                    INSERT INTO playlist_tracks (playlist_id, track_id, position)
                    VALUES ($1, $2, $3)
                    ON CONFLICT DO NOTHING
                """, playlist_id, track_id, i)

    logger.info(f"Saved playlist '{result.get('name')}' to DB: {len(tracks)} tracks")

async def get_album_art_from_db(track_ids: list[str]) -> dict[str, str]:
    """
    Look up stored album art URLs for the given track IDs.
    Returns a dict of {track_id: album_image_url} for those that have art.
    """
    if not track_ids:
        return {}

    async with get_conn() as conn:
        rows = await conn.fetch("""
            SELECT track_id, album_image
            FROM tracks
            WHERE track_id = ANY($1)
              AND album_image IS NOT NULL
              AND album_image != ''
        """, track_ids)

    return {row["track_id"]: row["album_image"] for row in rows}

async def save_album_art_to_db(art_updates: dict[str, str]):
    """Batch update album_image on track records."""
    if not art_updates:
        return

    async with get_conn() as conn:
        for track_id, url in art_updates.items():
            await conn.execute(
                "UPDATE tracks SET album_image = $1, updated_at = NOW() WHERE track_id = $2",
                url, track_id,
            )
