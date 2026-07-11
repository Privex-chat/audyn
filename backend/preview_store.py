"""Batched persistence for preview-scrape results.

Shared by the API's on-demand preview fill (server.py) and the background
preview worker (preview_worker.py) so their bookkeeping can't drift apart.
"""
import logging

from database import get_conn

logger = logging.getLogger(__name__)

MAX_PREVIEW_RETRIES = 5


async def get_missing_preview_track_ids(playlist_id: str, limit: int = 400) -> list[str]:
    """Tracks in a playlist that still need a preview URL and are worth retrying."""
    async with get_conn() as conn:
        rows = await conn.fetch(
            """
            SELECT t.track_id
            FROM playlist_tracks pt
            JOIN tracks t ON t.track_id = pt.track_id
            WHERE pt.playlist_id = $1
              AND (t.preview_url IS NULL OR t.preview_url = '')
              AND t.preview_unavailable = FALSE
              AND t.preview_retry_count < $2
            ORDER BY pt.position
            LIMIT $3
            """,
            playlist_id,
            MAX_PREVIEW_RETRIES,
            limit,
        )
    return [r["track_id"] for r in rows]


async def mark_recovered(results: dict[str, str]):
    """Persist recovered preview URLs and reset retry counters."""
    if not results:
        return
    async with get_conn() as conn:
        await conn.execute(
            """
            UPDATE tracks t
            SET preview_url         = u.url,
                preview_retry_count = 0,
                preview_unavailable = FALSE,
                updated_at          = NOW()
            FROM unnest($1::text[], $2::text[]) AS u(track_id, url)
            WHERE t.track_id = u.track_id
            """,
            list(results.keys()),
            list(results.values()),
        )


async def mark_failed(track_ids: list[str]):
    """Soft failure: bump the retry counter; flip unavailable at the cap."""
    if not track_ids:
        return
    async with get_conn() as conn:
        await conn.execute(
            """
            UPDATE tracks
            SET preview_retry_count = preview_retry_count + 1,
                preview_unavailable = CASE WHEN preview_retry_count + 1 >= $2
                                           THEN TRUE ELSE preview_unavailable END,
                updated_at          = NOW()
            WHERE track_id = ANY($1)
            """,
            track_ids,
            MAX_PREVIEW_RETRIES,
        )


async def mark_unavailable(track_ids: list[str]):
    """Hard failure (embed 404 — track removed/invalid): stop retrying."""
    if not track_ids:
        return
    async with get_conn() as conn:
        await conn.execute(
            """
            UPDATE tracks
            SET preview_unavailable = TRUE,
                preview_retry_count = preview_retry_count + 1,
                updated_at          = NOW()
            WHERE track_id = ANY($1)
            """,
            track_ids,
        )
