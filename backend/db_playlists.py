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

        record = dict(row)
        is_complete = record.get("fetch_complete", True)
        if is_complete is None:
            is_complete = True

        # Incomplete records (saved during a Spotify rate-limit penalty) get a
        # short TTL so they're re-fetched the same day API access recovers,
        # instead of serving a truncated track list for a week.
        ttl = timedelta(days=PLAYLIST_TTL_DAYS) if is_complete else timedelta(hours=6)
        age = datetime.now(timezone.utc) - row["fetched_at"]
        if age > ttl:
            logger.info(
                f"Playlist {playlist_id} expired ({age} old, "
                f"{'complete' if is_complete else 'incomplete'} record)"
            )
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
            "fetch_complete": bool(is_complete),
            "source": "database",
        }

async def save_playlist(playlist_id: str, result: dict):
    # Dedupe by track_id (playlists can contain the same song twice; a batch
    # upsert would otherwise error on "row affected a second time").
    seen: set[str] = set()
    tracks = []
    for t in result.get("tracks", []):
        tid = t.get("id", "")
        if tid and tid not in seen:
            seen.add(tid)
            tracks.append(t)
    if not tracks:
        return

    ids         = [t["id"] for t in tracks]
    names       = [t.get("name", "") for t in tracks]
    artists     = [t.get("artist", "") for t in tracks]
    previews    = [t.get("preview_url", "") for t in tracks]
    album_names = [t.get("album_name", "") for t in tracks]
    album_imgs  = [t.get("album_image", "") for t in tracks]
    durations   = [t.get("duration_ms", 0) or 0 for t in tracks]
    explicits   = [bool(t.get("explicit", False)) for t in tracks]
    populars    = [t.get("popularity", 0) or 0 for t in tracks]

    # A fetch is "complete" when playable + skipped covers Spotify's own total.
    # Degraded fetches (429 mid-pagination, embed-only fallback capped at ~100
    # tracks) come back smaller — replacing the link table from one of those
    # would permanently shrink the playlist, which the preview worker can never
    # heal (it only sees tracks reachable through playlist_tracks).
    total_stated = result.get("total_in_playlist", 0) or 0
    skipped = result.get("skipped_no_preview", 0) or 0
    # Fetchers that know their own completeness say so explicitly (the embed
    # path detects its ~100-entry trackList cap; the API path detects failed
    # pages). Fall back to the size check for callers that don't.
    fetch_complete = result.get("fetch_complete")
    if fetch_complete is None:
        fetch_complete = total_stated > 0 and (len(tracks) + skipped) >= total_stated
    fetch_complete = bool(fetch_complete)

    async with get_conn() as conn:
        async with conn.transaction():
            # A degraded fetch must not shrink a previously known bigger total
            # (GREATEST). Preserve an existing complete flag only when the DB
            # already has a strictly larger linked track set than this degraded
            # response; otherwise old near-cap embed caches can stay falsely
            # "complete" forever.
            await conn.execute("""
                INSERT INTO playlists (playlist_id, name, image_url, total_in_playlist,
                                       skipped_no_preview, fetch_complete, fetched_at)
                VALUES ($1, $2, $3, $4, $5, $6, NOW())
                ON CONFLICT (playlist_id) DO UPDATE SET
                    name               = $2,
                    image_url          = $3,
                    total_in_playlist  = CASE WHEN $6 THEN $4
                                              ELSE GREATEST(playlists.total_in_playlist, $4) END,
                    skipped_no_preview = $5,
                    fetch_complete     = $6 OR (
                        COALESCE(playlists.fetch_complete, FALSE)
                        AND playlists.total_in_playlist >= $4
                        AND (
                            SELECT COUNT(*)
                            FROM playlist_tracks
                            WHERE playlist_id = $1
                        ) > $7
                    ),
                    fetched_at         = NOW()
            """,
                playlist_id,
                result.get("name", ""),
                result.get("image", ""),
                total_stated,
                skipped,
                fetch_complete,
                len(tracks),
            )

            # Single batched upsert for all tracks. The CASE guards keep
            # preview URLs and album art recovered by the preview_worker from
            # being overwritten with empty strings on re-fetch.
            await conn.execute("""
                INSERT INTO tracks (
                    track_id, name, artist, preview_url, album_name, album_image,
                    duration_ms, explicit, popularity, updated_at
                )
                SELECT t.track_id, t.name, t.artist, t.preview_url, t.album_name, t.album_image,
                       t.duration_ms, t.explicit, t.popularity, NOW()
                FROM unnest(
                    $1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
                    $7::int[], $8::bool[], $9::int[]
                ) AS t(track_id, name, artist, preview_url, album_name, album_image,
                       duration_ms, explicit, popularity)
                ON CONFLICT (track_id) DO UPDATE SET
                    name        = EXCLUDED.name,
                    artist      = EXCLUDED.artist,
                    preview_url = CASE WHEN EXCLUDED.preview_url != '' THEN EXCLUDED.preview_url ELSE tracks.preview_url END,
                    album_name  = EXCLUDED.album_name,
                    album_image = CASE WHEN EXCLUDED.album_image != '' THEN EXCLUDED.album_image ELSE tracks.album_image END,
                    duration_ms = EXCLUDED.duration_ms,
                    explicit    = EXCLUDED.explicit,
                    popularity  = EXCLUDED.popularity,
                    updated_at  = NOW()
            """, ids, names, artists, previews, album_names, album_imgs,
                 durations, explicits, populars)

            existing_row = await conn.fetchrow(
                "SELECT COUNT(*) AS cnt, COALESCE(MAX(position), -1) AS max_pos "
                "FROM playlist_tracks WHERE playlist_id = $1",
                playlist_id,
            )
            existing_links = existing_row["cnt"] or 0
            existing_max_pos = existing_row["max_pos"]

            if fetch_complete or len(tracks) >= existing_links:
                await conn.execute(
                    "DELETE FROM playlist_tracks WHERE playlist_id = $1", playlist_id
                )
                await conn.execute("""
                    INSERT INTO playlist_tracks (playlist_id, track_id, position)
                    SELECT $1, t.track_id, t.position
                    FROM unnest($2::text[], $3::int[]) AS t(track_id, position)
                    ON CONFLICT DO NOTHING
                """, playlist_id, ids, list(range(len(ids))))
                links_action = f"links rebuilt ({len(tracks)})"
            else:
                # Degraded fetch: refresh metadata/previews only, keep the
                # larger set of existing links intact. New positions start
                # after the existing max so they don't overlap preserved links.
                new_positions = list(range(existing_max_pos + 1, existing_max_pos + 1 + len(ids)))
                await conn.execute("""
                    INSERT INTO playlist_tracks (playlist_id, track_id, position)
                    SELECT $1, t.track_id, t.position
                    FROM unnest($2::text[], $3::int[]) AS t(track_id, position)
                    ON CONFLICT DO NOTHING
                """, playlist_id, ids, new_positions)
                links_action = (
                    f"links preserved (fetch returned {len(tracks)}, "
                    f"DB has {existing_links})"
                )

    logger.info(
        f"Saved playlist '{result.get('name')}' to DB: {len(tracks)} tracks, {links_action}"
    )

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
