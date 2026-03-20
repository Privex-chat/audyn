from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

import asyncio
import json
import logging
import re

import httpx

from database import init_db, get_conn

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("preview_worker")

PREVIEW_RETRY_BATCH = 5
PREVIEW_RETRY_DELAY = 4.0
PREVIEW_RETRY_BATCH_PAUSE = 60.0
PREVIEW_RETRY_CYCLE_PAUSE = 1800

MAX_PREVIEW_RETRIES = 5

BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

def parse_embed_next_data(html: str) -> dict:
    m = re.search(
        r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html
    )
    if not m:
        return {}
    try:
        return json.loads(m.group(1))
    except json.JSONDecodeError:
        return {}

async def _mark_unavailable(conn, track_id: str, reason: str):
    """Immediately mark a track as permanently unavailable (e.g. HTTP 404)."""
    await conn.execute(
        """
        UPDATE tracks
        SET preview_unavailable = TRUE,
            preview_retry_count = preview_retry_count + 1,
            updated_at          = NOW()
        WHERE track_id = $1
        """,
        track_id,
    )
    logger.info(f"Preview retry: track {track_id} marked unavailable — {reason}")

async def _increment_retry(conn, track_id: str):
    """
    Increment the retry counter.  If it has now reached MAX_PREVIEW_RETRIES,
    also flip preview_unavailable so the worker stops queuing this track.
    """
    new_count = await conn.fetchval(
        """
        UPDATE tracks
        SET preview_retry_count = preview_retry_count + 1,
            updated_at          = NOW()
        WHERE track_id = $1
        RETURNING preview_retry_count
        """,
        track_id,
    )
    if new_count is not None and new_count >= MAX_PREVIEW_RETRIES:
        await conn.execute(
            "UPDATE tracks SET preview_unavailable = TRUE WHERE track_id = $1",
            track_id,
        )
        logger.info(
            f"Preview retry: track {track_id} exhausted {MAX_PREVIEW_RETRIES} "
            f"attempts — marked unavailable"
        )

async def _mark_success(conn, track_id: str, url: str):
    """Persist the recovered preview URL and reset the retry counters."""
    await conn.execute(
        """
        UPDATE tracks
        SET preview_url         = $1,
            preview_retry_count = 0,
            preview_unavailable = FALSE,
            updated_at          = NOW()
        WHERE track_id = $2
        """,
        url,
        track_id,
    )

async def run_retry_cycle():
    async with get_conn() as conn:
        rows = await conn.fetch("""
            SELECT DISTINCT t.track_id, t.preview_retry_count
            FROM tracks t
            JOIN playlist_tracks pt ON pt.track_id = t.track_id
            WHERE (t.preview_url IS NULL OR t.preview_url = '')
              AND t.preview_unavailable = FALSE
            ORDER BY t.track_id
        """)

    track_ids = [r["track_id"] for r in rows]
    if not track_ids:
        logger.info("Preview retry: no retryable tracks — nothing to do")
        return

    logger.info(f"Preview retry: {len(track_ids)} tracks queued for retry")
    total_recovered = 0
    abort_cycle = False

    async with httpx.AsyncClient(headers=BROWSER_HEADERS, timeout=10.0) as http:
        for batch_start in range(0, len(track_ids), PREVIEW_RETRY_BATCH):
            if abort_cycle:
                break

            batch = track_ids[batch_start : batch_start + PREVIEW_RETRY_BATCH]
            batch_num = batch_start // PREVIEW_RETRY_BATCH + 1
            recovered_in_batch: dict[str, str] = {}
            failed_in_batch:    list[str]       = []
            unavailable_in_batch: list[str]     = []

            for tid in batch:
                if abort_cycle:
                    break

                try:
                    resp = await http.get(
                        f"https://open.spotify.com/embed/track/{tid}"
                    )

                    if resp.status_code == 429:
                        logger.warning(
                            f"Preview retry: rate-limited (batch {batch_num}, "
                            f"track {tid}) — sleeping 5 min then retrying once"
                        )
                        await asyncio.sleep(300)
                        resp = await http.get(
                            f"https://open.spotify.com/embed/track/{tid}"
                        )
                        if resp.status_code == 429:
                            done = batch_start + batch.index(tid)
                            remaining = len(track_ids) - done
                            logger.warning(
                                f"Preview retry: persistent 429 after back-off — "
                                f"aborting cycle with ~{remaining} tracks remaining. "
                                f"They will be retried next run."
                            )
                            abort_cycle = True
                            break

                    if resp.status_code == 404:
                        unavailable_in_batch.append(tid)
                        await asyncio.sleep(PREVIEW_RETRY_DELAY)
                        continue

                    if resp.status_code != 200:
                        logger.warning(
                            f"Preview retry: HTTP {resp.status_code} for track {tid}"
                        )
                        failed_in_batch.append(tid)
                        await asyncio.sleep(PREVIEW_RETRY_DELAY)
                        continue

                    nd = parse_embed_next_data(resp.text)
                    entity = (
                        nd.get("props", {})
                        .get("pageProps", {})
                        .get("state", {})
                        .get("data", {})
                        .get("entity", {})
                    )
                    audio = entity.get("audioPreview") or {}
                    url = audio.get("url", "")

                    if url:
                        recovered_in_batch[tid] = url
                    else:
                        logger.debug(
                            f"Preview retry: track {tid} returned 200 but has "
                            f"no audioPreview (local file or unavailable)"
                        )
                        failed_in_batch.append(tid)

                except Exception as exc:
                    logger.warning(
                        f"Preview retry: network error for track {tid}: {exc}"
                    )
                    failed_in_batch.append(tid)

                await asyncio.sleep(PREVIEW_RETRY_DELAY)

            if recovered_in_batch or failed_in_batch or unavailable_in_batch:
                async with get_conn() as conn:
                    for tid, url in recovered_in_batch.items():
                        await _mark_success(conn, tid, url)

                    for tid in unavailable_in_batch:
                        await _mark_unavailable(conn, tid, "HTTP 404 — track removed or invalid")

                    for tid in failed_in_batch:
                        await _increment_retry(conn, tid)

            if recovered_in_batch:
                async with get_conn() as conn:
                    affected = await conn.fetch(
                        "SELECT DISTINCT playlist_id FROM playlist_tracks "
                        "WHERE track_id = ANY($1)",
                        list(recovered_in_batch.keys()),
                    )
                if affected:
                    pids = [row["playlist_id"] for row in affected]
                    logger.info(
                        f"Preview retry: playlists affected by recovered tracks: {pids}"
                    )

                total_recovered += len(recovered_in_batch)
                logger.info(
                    f"Preview retry: recovered {len(recovered_in_batch)} in batch {batch_num}, "
                    f"{total_recovered} total so far"
                )

            if unavailable_in_batch:
                logger.info(
                    f"Preview retry: {len(unavailable_in_batch)} track(s) in batch "
                    f"{batch_num} permanently marked unavailable (404)"
                )

            if failed_in_batch:
                logger.debug(
                    f"Preview retry: {len(failed_in_batch)} soft failure(s) in batch "
                    f"{batch_num} — retry counters incremented"
                )

            if not abort_cycle:
                remaining = len(track_ids) - batch_start - len(batch)
                if remaining > 0:
                    logger.info(
                        f"Preview retry: {remaining} tracks remaining, "
                        f"pausing {PREVIEW_RETRY_BATCH_PAUSE}s"
                    )
                    await asyncio.sleep(PREVIEW_RETRY_BATCH_PAUSE)

    status = "aborted (rate-limited)" if abort_cycle else "complete"
    logger.info(
        f"Preview retry cycle {status}: recovered {total_recovered} / "
        f"{len(track_ids)} queued tracks"
    )

async def main():
    await init_db()
    logger.info("Preview worker started")
    while True:
        try:
            await run_retry_cycle()
        except Exception as e:
            logger.error(f"Retry cycle failed: {e}")
        logger.info(f"Sleeping {PREVIEW_RETRY_CYCLE_PAUSE}s until next cycle")
        await asyncio.sleep(PREVIEW_RETRY_CYCLE_PAUSE)

if __name__ == "__main__":
    asyncio.run(main())
