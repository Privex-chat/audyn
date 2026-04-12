from pathlib import Path
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Query
from fastapi.responses import StreamingResponse, Response
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from contextlib import asynccontextmanager

import os
import logging
import re
import json
import time
import asyncio
import unicodedata
import base64
import httpx
from collections import OrderedDict
from urllib.parse import unquote, urlparse
from datetime import datetime, timezone

from database import init_db, close_db, get_conn
from db_playlists import (
    load_playlist as load_playlist_from_db,
    save_playlist as save_playlist_to_db,
    get_album_art_from_db,
    save_album_art_to_db,
)
from auth import auth_router, get_current_user, require_user
from scoring import score_router
from leaderboard import lb_router
from daily import daily_router
from shares import share_router
from achievements import achievements_router
from stats import stats_router
from rooms import rooms_router
from sessions import sessions_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

SPOTIFY_CLIENT_ID = os.environ.get("SPOTIFY_CLIENT_ID", "")
SPOTIFY_CLIENT_SECRET = os.environ.get("SPOTIFY_CLIENT_SECRET", "")
HAS_SPOTIFY_CREDS = bool(SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET)

if HAS_SPOTIFY_CREDS:
    logger.info("Spotify Client Credentials found — full API pagination enabled")
else:
    logger.warning("No SPOTIFY_CLIENT_ID/SECRET — playlists capped at ~100 tracks")

BROWSER_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

PLAYLIST_TTL_DAYS = 7

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

memory_cache = TTLCache(max_size=50, ttl_seconds=600)
token_cache = TTLCache(max_size=5, ttl_seconds=3000)
preview_cache = TTLCache(max_size=5000, ttl_seconds=7200)
art_cache = TTLCache(max_size=500, ttl_seconds=3600)

_audio_http_client: httpx.AsyncClient | None = None

_audio_cache = TTLCache(max_size=50, ttl_seconds=300)

class RateLimiter:
    def __init__(self, max_requests=30, window_seconds=60):
        self._requests: dict[str, list[float]] = {}
        self.max_requests = max_requests
        self.window = window_seconds

    def is_allowed(self, ip: str) -> bool:
        now = time.time()
        if ip not in self._requests:
            self._requests[ip] = []
        self._requests[ip] = [t for t in self._requests[ip] if now - t < self.window]
        if len(self._requests[ip]) >= self.max_requests:
            return False
        self._requests[ip].append(now)
        return True

rate_limiter = RateLimiter(max_requests=30, window_seconds=60)

share_rate_limiter = RateLimiter(max_requests=10, window_seconds=60)

def clean_whitespace(text: str) -> str:
    return " ".join(unicodedata.normalize("NFKC", text).split())

def extract_playlist_id(url_or_id: str) -> str:
    for pattern in [
        r"open\.spotify\.com/playlist/([a-zA-Z0-9]+)",
        r"spotify:playlist:([a-zA-Z0-9]+)",
    ]:
        m = re.search(pattern, url_or_id)
        if m:
            return m.group(1)
    return url_or_id.strip().split("?")[0].split("/")[-1]

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

@asynccontextmanager
async def lifespan(app):
    global _audio_http_client
    await init_db()
    _audio_http_client = httpx.AsyncClient(
        follow_redirects=True,
        timeout=30.0,
        limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
    )

    async def _guest_cleanup_loop():
        while True:
            await asyncio.sleep(86400)
            try:
                async with get_conn() as conn:
                    result = await conn.execute(
                        """
                        DELETE FROM users
                        WHERE is_guest = TRUE
                          AND created_at < NOW() - INTERVAL '30 days'
                        """
                    )
                    logger.info(f"Guest cleanup complete: {result}")
            except Exception as e:
                logger.warning(f"Guest cleanup failed: {e}")

    asyncio.create_task(_guest_cleanup_loop())
    logger.info("Audyn API v3.0.3 started")
    yield
    await _audio_http_client.aclose()
    await close_db()
    logger.info("Audyn API shutting down")

app = FastAPI(
    title="Audyn API",
    version="3.0.3",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)
api_router = APIRouter(prefix="/api")

async def fetch_album_art_for_tracks(track_ids: list[str]) -> dict[str, str]:
    """Fetch album art URLs for specific tracks. Memory cache → DB → Spotify embed."""
    results = {}
    ids_to_fetch = []

    for tid in track_ids:
        cached = art_cache.get(f"art:{tid}")
        if cached is not None:
            results[tid] = cached
        else:
            ids_to_fetch.append(tid)

    if not ids_to_fetch:
        return results

    try:
        db_art = await get_album_art_from_db(ids_to_fetch)
        for tid, url in db_art.items():
            results[tid] = url
            art_cache.set(f"art:{tid}", url)
        ids_to_fetch = [tid for tid in ids_to_fetch if tid not in db_art]
    except Exception as e:
        logger.warning(f"DB art lookup failed: {e}")

    if not ids_to_fetch:
        return results

    semaphore = asyncio.Semaphore(10)

    async def fetch_one(http, tid):
        async with semaphore:
            try:
                resp = await http.get(
                    f"https://open.spotify.com/embed/track/{tid}",
                    headers=BROWSER_HEADERS,
                )
                if resp.status_code != 200:
                    return tid, ""
                data = parse_embed_next_data(resp.text)
                entity = (
                    data.get("props", {})
                    .get("pageProps", {})
                    .get("state", {})
                    .get("data", {})
                    .get("entity", {})
                )
                cover = entity.get("coverArt", {}).get("sources", [])
                art_url = ""
                for src in cover:
                    art_url = src.get("url", "")
                    w = src.get("width", 0)
                    if 200 <= w <= 400:
                        break
                return tid, art_url
            except Exception:
                return tid, ""

    async with httpx.AsyncClient(follow_redirects=True, timeout=15.0) as http:
        tasks = [fetch_one(http, tid) for tid in ids_to_fetch]
        completed = await asyncio.gather(*tasks, return_exceptions=True)

    art_updates = {}
    for result_item in completed:
        if isinstance(result_item, Exception):
            continue
        tid, art_url = result_item
        if art_url:
            results[tid] = art_url
            art_cache.set(f"art:{tid}", art_url)
            art_updates[tid] = art_url

    if art_updates:
        try:
            await save_album_art_to_db(art_updates)
        except Exception:
            pass

    return results

async def get_api_token(http):
    if not HAS_SPOTIFY_CREDS:
        return ""
    cached = token_cache.get("api_token")
    if cached:
        return cached
    try:
        auth_str = base64.b64encode(
            f"{SPOTIFY_CLIENT_ID}:{SPOTIFY_CLIENT_SECRET}".encode()
        ).decode()
        resp = await http.post(
            "https://accounts.spotify.com/api/token",
            data={"grant_type": "client_credentials"},
            headers={
                "Authorization": f"Basic {auth_str}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
        )
        if resp.status_code == 200:
            token = resp.json().get("access_token", "")
            if token:
                token_cache.set("api_token", token)
                logger.info("Got Spotify API token")
                return token
    except Exception as e:
        logger.warning(f"Token error: {e}")
    return ""

async def fetch_all_track_metadata(http, token, playlist_id):
    api_headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    meta_resp = await http.get(
        f"https://api.spotify.com/v1/playlists/{playlist_id}",
        params={"fields": "name,images,tracks.total"},
        headers=api_headers,
    )
    if meta_resp.status_code != 200:
        return "", "", [], 0

    meta = meta_resp.json()
    playlist_name = meta.get("name", "Unknown Playlist")
    images = meta.get("images", [])
    playlist_image = images[0]["url"] if images else ""
    total_tracks = meta.get("tracks", {}).get("total", 0)
    logger.info(f"Spotify API: '{playlist_name}' — {total_tracks} tracks")

    all_meta = []
    offset = 0
    while offset < total_tracks and offset < 1500:
        resp = await http.get(
            f"https://api.spotify.com/v1/playlists/{playlist_id}/tracks",
            params={
                "offset": offset,
                "limit": 100,
                "fields": "items(track(id,name,duration_ms,artists,album(name,images),explicit,popularity)),next",
            },
            headers=api_headers,
        )
        if resp.status_code != 200:
            break
        items = resp.json().get("items", [])
        if not items:
            break
        for item in items:
            t = item.get("track")
            if not t or not t.get("id"):
                continue
            album_images = t.get("album", {}).get("images", [])
            album_image = ""
            for img in album_images:
                album_image = img.get("url", "")
                if 200 <= img.get("width", 0) <= 400:
                    break
            artists = t.get("artists", [])
            artist_name = (
                ", ".join(a.get("name", "") for a in artists)
                if artists
                else "Unknown Artist"
            )
            all_meta.append(
                {
                    "id": t["id"],
                    "name": t.get("name", "Unknown Track"),
                    "artist": clean_whitespace(artist_name),
                    "album_image": album_image or playlist_image,
                    "album_name": t.get("album", {}).get("name", ""),
                    "duration_ms": t.get("duration_ms", 0),
                    "explicit": t.get("explicit", False),
                    "popularity": t.get("popularity", 0),
                }
            )
        offset += 100
        logger.info(f"  metadata: {min(offset, total_tracks)}/{total_tracks}")
        if offset < total_tracks:
            await asyncio.sleep(0.1)

    return playlist_name, playlist_image, all_meta, total_tracks

def extract_previews_from_embed_data(next_data: dict) -> dict:
    entity = (
        next_data.get("props", {})
        .get("pageProps", {})
        .get("state", {})
        .get("data", {})
        .get("entity", {})
    )
    if not entity:
        return {}
    previews = {}
    for t in entity.get("trackList", []):
        preview = t.get("audioPreview") or {}
        url = preview.get("url", "")
        if not url:
            continue
        uri = t.get("uri", "")
        if uri.startswith("spotify:track:"):
            previews[uri.split(":")[-1]] = url
    return previews

async def fetch_preview_from_track_embed(http, semaphore, track_id):
    cached = preview_cache.get(f"preview:{track_id}")
    if cached is not None:
        return track_id, cached
    async with semaphore:
        try:
            resp = await http.get(
                f"https://open.spotify.com/embed/track/{track_id}",
                headers=BROWSER_HEADERS,
            )
            if resp.status_code != 200:
                return track_id, ""
            data = parse_embed_next_data(resp.text)
            entity = (
                data.get("props", {})
                .get("pageProps", {})
                .get("state", {})
                .get("data", {})
                .get("entity", {})
            )
            preview = entity.get("audioPreview") or {}
            url = preview.get("url", "")
            preview_cache.set(f"preview:{track_id}", url)
            return track_id, url
        except Exception:
            return track_id, ""

async def batch_fetch_previews(http, track_ids):
    if not track_ids:
        return {}
    semaphore = asyncio.Semaphore(15)
    tasks = [
        fetch_preview_from_track_embed(http, semaphore, tid) for tid in track_ids
    ]
    results = {}
    chunk_size = 50
    for i in range(0, len(tasks), chunk_size):
        chunk = tasks[i : i + chunk_size]
        completed = await asyncio.gather(*chunk, return_exceptions=True)
        for r in completed:
            if not isinstance(r, Exception) and r[1]:
                results[r[0]] = r[1]
        logger.info(
            f"  preview fetch: {min(i + chunk_size, len(tasks))}/{len(tasks)}, "
            f"{len(results)} have audio"
        )
        if i + chunk_size < len(tasks):
            await asyncio.sleep(0.2)
    return results

async def fetch_playlist_embed_only(http, playlist_id):
    """
    Fetch playlist data from Spotify's public embed page.

    Returns a dict with two track lists:
      - 'tracks'        — user-facing: only tracks that have a preview URL right now
      - 'tracks_for_db' — all playable tracks, including those without a preview URL,
                          so the preview_worker can find and retry them later

    Callers must use 'tracks_for_db' when writing to the database and 'tracks'
    when returning data to the frontend.
    """
    resp = await http.get(
        f"https://open.spotify.com/embed/playlist/{playlist_id}",
        headers=BROWSER_HEADERS,
    )
    if resp.status_code in (404, 400):
        raise HTTPException(status_code=404, detail="Playlist not found.")
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Could not reach Spotify.")
    next_data = parse_embed_next_data(resp.text)
    if not next_data:
        raise HTTPException(status_code=502, detail="Could not parse Spotify data.")
    entity = (
        next_data.get("props", {})
        .get("pageProps", {})
        .get("state", {})
        .get("data", {})
        .get("entity", {})
    )
    if not entity or not entity.get("trackList"):
        raise HTTPException(status_code=404, detail="Playlist empty.")

    playlist_name = entity.get("name", "Unknown Playlist")
    cover_sources = entity.get("coverArt", {}).get("sources", [])
    playlist_image = cover_sources[0]["url"] if cover_sources else ""
    track_list = entity.get("trackList", [])
    total_stated = entity.get("trackCount", len(track_list))

    # FIX: build two separate lists so that all playable tracks (even those
    # without a preview URL) are persisted to the DB for the worker to retry,
    # while only tracks with a preview URL are returned to the user.
    tracks = []          # user-facing: preview URL required
    tracks_for_db = []   # all playable tracks, preview_url may be ""

    for t in track_list:
        is_playable = t.get("isPlayable", False)
        if not is_playable:
            continue

        preview = t.get("audioPreview") or {}
        url = preview.get("url", "")

        track_id = ""
        uri = t.get("uri", "")
        if uri.startswith("spotify:track:"):
            track_id = uri.split(":")[-1]

        track_obj = {
            "id": track_id or t.get("uid", ""),
            "name": t.get("title", "Unknown Track"),
            "artist": clean_whitespace(t.get("subtitle", "Unknown Artist")),
            "preview_url": url,
            "album_image": "",
            "album_name": "",
            "duration_ms": 0,
            "explicit": False,
            "popularity": 0,
        }
        tracks_for_db.append(track_obj)
        if url:
            tracks.append(track_obj)

    # Count tracks that are playable but have no preview yet (queued for retry)
    pending_retry = len(tracks_for_db) - len(tracks)
    # Count tracks that are not playable at all (local files, region-locked)
    skipped = sum(1 for t in track_list if not t.get("isPlayable", False))

    return {
        "name": playlist_name,
        "image": playlist_image,
        "tracks": tracks,
        "tracks_for_db": tracks_for_db,
        "total_tracks": len(tracks),
        "total_in_playlist": total_stated,
        "skipped_no_preview": skipped,
        "pending_preview_retry": pending_retry,
    }

async def fetch_playlist(playlist_id: str, force_refresh: bool = False) -> dict:
    """
    Fetch pipeline:
    1. In-memory hot cache (10 min)         — skipped when force_refresh=True
    2. PostgreSQL persistent cache (7 days) — skipped when force_refresh=True;
                                              stale record is deleted first
    3. Full Spotify fetch (API + embed)     — always runs when force_refresh=True
    """
    if not force_refresh:
        cached = memory_cache.get(playlist_id)
        if cached:
            logger.info(f"Memory cache hit: {playlist_id}")
            return cached

        try:
            db_result = await load_playlist_from_db(playlist_id)
            if db_result:
                memory_cache.set(playlist_id, db_result)
                return db_result
        except Exception as e:
            logger.warning(f"DB load failed: {e}")
    else:
        try:
            async with get_conn() as conn:
                await conn.execute(
                    "DELETE FROM playlist_tracks WHERE playlist_id = $1", playlist_id
                )
                await conn.execute(
                    "DELETE FROM playlists WHERE playlist_id = $1", playlist_id
                )
            logger.info(f"DB cache evicted for force refresh: {playlist_id}")
        except Exception as e:
            logger.warning(f"DB evict failed (non-fatal): {e}")

    logger.info(f"Fetching from Spotify: {playlist_id}")
    async with httpx.AsyncClient(follow_redirects=True, timeout=25.0) as http:
        token = await get_api_token(http)

        if not token:
            # No-credentials path: use embed only.
            # FIX: use tracks_for_db (all playable tracks, even those without a
            # preview URL) when saving to the DB so the worker can find them.
            # The user-facing result still only contains tracks with preview URLs.
            result = await fetch_playlist_embed_only(http, playlist_id)
            save_result = dict(result)
            save_result["tracks"] = save_result.pop("tracks_for_db", save_result["tracks"])
            try:
                await save_playlist_to_db(playlist_id, save_result)
            except Exception as e:
                logger.warning(f"DB save failed: {e}")
            result.pop("tracks_for_db", None)
            memory_cache.set(playlist_id, result)
            return result

        playlist_name, playlist_image, all_meta, total_in_playlist = (
            await fetch_all_track_metadata(http, token, playlist_id)
        )

        if not all_meta:
            # API metadata fetch failed; fall back to embed.
            # Same FIX as above: save tracks_for_db so the worker can retry.
            result = await fetch_playlist_embed_only(http, playlist_id)
            save_result = dict(result)
            save_result["tracks"] = save_result.pop("tracks_for_db", save_result["tracks"])
            try:
                await save_playlist_to_db(playlist_id, save_result)
            except Exception as e:
                logger.warning(f"DB save failed: {e}")
            result.pop("tracks_for_db", None)
            memory_cache.set(playlist_id, result)
            return result

        track_ids = [t["id"] for t in all_meta]
        meta_by_id = {t["id"]: t for t in all_meta}

        logger.info("Fetching playlist embed for initial previews...")
        embed_previews: dict[str, str] = {}
        is_playable: dict[str, bool] = {}
        try:
            embed_resp = await http.get(
                f"https://open.spotify.com/embed/playlist/{playlist_id}",
                headers=BROWSER_HEADERS,
            )
            if embed_resp.status_code == 200:
                nd = parse_embed_next_data(embed_resp.text)
                embed_previews = extract_previews_from_embed_data(nd)
                embed_entity = (
                    nd.get("props", {})
                    .get("pageProps", {})
                    .get("state", {})
                    .get("data", {})
                    .get("entity", {})
                )
                for t in embed_entity.get("trackList", []):
                    uri = t.get("uri", "")
                    if uri.startswith("spotify:track:"):
                        tid = uri.split(":")[-1]
                        is_playable[tid] = t.get("isPlayable", True)
                logger.info(f"Playlist embed: {len(embed_previews)} previews")
        except Exception as e:
            logger.warning(f"Embed failed: {e}")

        ids_without_preview = [
            tid for tid in track_ids
            if tid not in embed_previews and is_playable.get(tid, True)
        ]
        if ids_without_preview:
            logger.info(
                f"fetch_playlist: {len(ids_without_preview)} tracks have no preview yet "
                f"— queued for hourly retry worker (not blocking user response)"
            )

        tracks = []
        for tid in track_ids:
            preview_url = embed_previews.get(tid, "")
            if not preview_url:
                continue
            if not is_playable.get(tid, True):
                continue
            m = meta_by_id[tid]
            tracks.append(
                {
                    "id": tid,
                    "name": m["name"],
                    "artist": m["artist"],
                    "preview_url": preview_url,
                    "album_image": "",
                    "album_name": m["album_name"],
                    "duration_ms": m.get("duration_ms", 0),
                    "explicit": m.get("explicit", False),
                    "popularity": m.get("popularity", 0),
                }
            )

        truly_skipped = sum(1 for tid in track_ids if not is_playable.get(tid, True))
        pending_retry = len(ids_without_preview)
        skipped = max(0, truly_skipped)
        logger.info(
            f"Final: {len(tracks)} playable now / {total_in_playlist} total "
            f"({skipped} not playable, {pending_retry} queued for preview retry)"
        )

        tracks_for_db = []
        for tid in track_ids:
            if not is_playable.get(tid, True):
                continue
            m = meta_by_id[tid]
            tracks_for_db.append({
                "id": tid,
                "name": m["name"],
                "artist": m["artist"],
                "preview_url": embed_previews.get(tid, ""),
                "album_image": m.get("album_image", ""),
                "album_name": m["album_name"],
                "duration_ms": m.get("duration_ms", 0),
                "explicit": m.get("explicit", False),
                "popularity": m.get("popularity", 0),
            })

        result = {
            "name": playlist_name,
            "image": playlist_image,
            "tracks": tracks,
            "total_tracks": len(tracks),
            "total_in_playlist": total_in_playlist,
            "skipped_no_preview": skipped,
            "pending_preview_retry": pending_retry,
            "source": "spotify",
        }

        save_result = dict(result)
        save_result["tracks"] = tracks_for_db
        try:
            await save_playlist_to_db(playlist_id, save_result)
        except Exception as e:
            logger.warning(f"DB save failed: {e}")

        memory_cache.set(playlist_id, result)
        return result

ALLOWED_AUDIO_DOMAINS = {
    "p.scdn.co",
    "preview.scdn.co",
    "anon-podcast-api.spotifycdn.com",
}

@api_router.get("/audio-proxy")
async def audio_proxy(url: str):
    decoded_url = unquote(url)
    parsed = urlparse(decoded_url)
    if parsed.hostname not in ALLOWED_AUDIO_DOMAINS:
        raise HTTPException(
            status_code=403, detail="Audio proxy only supports Spotify CDN"
        )
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="Invalid URL scheme")
    if parsed.username or parsed.password:
        raise HTTPException(status_code=400, detail="Invalid URL")

    cached_bytes = _audio_cache.get(decoded_url)
    if cached_bytes is not None:
        return Response(
            content=cached_bytes,
            media_type="audio/mpeg",
            headers={
                "Accept-Ranges": "bytes",
                "Cache-Control": "public, max-age=3600",
                "Access-Control-Allow-Origin": "*",
            },
        )

    MAX_CACHE_SIZE = 1_048_576  # 1 MB

    async def stream_audio():
        collected = bytearray()
        should_cache = True
        async with _audio_http_client.stream(
            "GET",
            decoded_url,
            headers={
                "User-Agent": BROWSER_HEADERS["User-Agent"],
                "Referer": "https://open.spotify.com/",
                "Origin": "https://open.spotify.com",
            },
        ) as resp:
            if resp.status_code != 200:
                raise HTTPException(
                    status_code=502, detail="Failed to fetch audio"
                )
            async for chunk in resp.aiter_bytes(chunk_size=8192):
                if should_cache:
                    collected.extend(chunk)
                    if len(collected) > MAX_CACHE_SIZE:
                        should_cache = False
                        collected.clear()
                yield chunk
        if should_cache and collected:
            _audio_cache.set(decoded_url, bytes(collected))

    return StreamingResponse(
        stream_audio(),
        media_type="audio/mpeg",
        headers={
            "Accept-Ranges": "bytes",
            "Cache-Control": "public, max-age=3600",
            "Access-Control-Allow-Origin": "*",
        },
    )

@api_router.get("/")
async def root():
    return {"status": "ok"}

@api_router.get("/health")
async def health():
    try:
        async with get_conn() as conn:
            await conn.fetchval("SELECT 1")
        return {"status": "healthy"}
    except Exception:
        return {"status": "degraded"}

@api_router.get("/playlist/{playlist_id:path}")
async def get_playlist(
    playlist_id: str, request: Request, refresh: bool = False,
    user=Depends(get_current_user),
):
    """
    Fetch playlist tracks. Returns track data WITHOUT album art (loaded separately).
    Pass ?refresh=true to force re-fetch from Spotify and evict both memory and DB caches.
    """
    if refresh and (not user or user.get("is_guest")):
        refresh = False
    client_ip = request.client.host if request.client else "unknown"
    if not rate_limiter.is_allowed(client_ip):
        raise HTTPException(status_code=429, detail="Too many requests.")

    actual_id = extract_playlist_id(playlist_id)
    if not actual_id or len(actual_id) < 10:
        raise HTTPException(status_code=400, detail="Invalid playlist ID or URL")

    if not re.match(r"^[a-zA-Z0-9]+$", actual_id):
        raise HTTPException(status_code=400, detail="Invalid playlist ID format")

    if refresh:
        memory_cache.delete(actual_id)
        logger.info(f"Force refresh requested for {actual_id}")

    result = await fetch_playlist(actual_id, force_refresh=refresh)

    result["playlist_id"] = actual_id

    pending = result.get("pending_preview_retry", 0)
    skipped = result.get("skipped_no_preview", 0)
    if pending > 0 or skipped > 0:
        parts = []
        if pending > 0:
            parts.append(
                f"{pending} previews are loading in the background and will be available soon."
            )
        if skipped > 0:
            parts.append(
                f"{skipped} tracks have no audio preview on Spotify and were permanently skipped."
            )
        result["warning"] = (
            f"{result['total_tracks']} of {result['total_in_playlist']} tracks are playable right now. "
            + " ".join(parts)
        )

    return result

@api_router.get("/tracks/art")
async def get_track_art(
    ids: str = Query(..., description="Comma-separated track IDs"),
    request: Request = None,
):
    """
    Fetch album art URLs for specific tracks on demand.
    Called by the frontend when a game starts, only for the selected tracks.
    """
    if request:
        client_ip = request.client.host if request.client else "unknown"
        if not rate_limiter.is_allowed(client_ip):
            raise HTTPException(status_code=429, detail="Too many requests.")

    track_ids = [tid.strip() for tid in ids.split(",") if tid.strip()]
    if not track_ids:
        raise HTTPException(status_code=400, detail="No track IDs provided")
    if len(track_ids) > 100:
        raise HTTPException(status_code=400, detail="Max 100 tracks per request")

    art_map = await fetch_album_art_for_tracks(track_ids)
    return {"art": art_map}

@api_router.get("/stats")
async def get_stats(user=Depends(require_user)):
    try:
        async with get_conn() as conn:
            pl_count = await conn.fetchval("SELECT COUNT(*) FROM playlists")
            tr_count = await conn.fetchval("SELECT COUNT(*) FROM tracks")
        return {"playlists": pl_count, "tracks": tr_count, "database": "postgresql"}
    except Exception:
        return {"playlists": 0, "tracks": 0, "database": "unavailable"}

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["Server"] = ""
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), camera=(), microphone=()"
        return response

app.include_router(api_router)
app.include_router(auth_router)
app.include_router(score_router)
app.include_router(lb_router)
app.include_router(daily_router)
app.include_router(share_router)
app.include_router(achievements_router)
app.include_router(stats_router)
app.include_router(rooms_router)
app.include_router(sessions_router)

app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "https://audyn.xyz").split(","),
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)