import json
import secrets
import logging
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from pydantic import BaseModel

from auth import require_user
from database import get_conn
from scoring import DIFFICULTIES, compute_score, update_daily_streak
from achievements import check_per_track_achievements, BADGES

logger = logging.getLogger(__name__)

sessions_router = APIRouter(prefix="/api/sessions", tags=["sessions"])

MAX_SESSION_TRACKS = 100
MAX_ELAPSED = 600

# Reserved keys inside the tracks JSONB that are not track entries.
_META_KEYS = {"_streak"}


def _streak_multiplier(count: int) -> float:
    # Mirrors the frontend's streak badge thresholds.
    if count >= 7:
        return 2.0
    if count >= 5:
        return 1.5
    if count >= 3:
        return 1.2
    return 1.0


def _load_tracks_json(raw) -> dict:
    return json.loads(raw) if isinstance(raw, str) else dict(raw)


def _entry_by_position(tracks_data: dict, position: int):
    for tid, entry in tracks_data.items():
        if tid in _META_KEYS:
            continue
        if entry.get("position") == position:
            return tid, entry
    return None, None


class StartSessionRequest(BaseModel):
    playlist_id: str = ""
    # Legacy clients send a non-empty explicit track list; new clients send
    # [] or omit it, and the server selects (and keeps secret) the round order.
    track_ids: list[str] | None = None
    song_count: int = 10
    difficulty: str = "normal"
    game_mode: str = "classic"
    guess_mode: str = "song"
    is_daily: bool = False
    room_code: str | None = None


class GuessRequest(BaseModel):
    round: int
    track_id: str | None = None
    artist: str | None = None
    skip: bool = False


@sessions_router.post("/start")
async def start_session(req: StartSessionRequest, user=Depends(require_user)):
    if req.difficulty not in ("easy", "normal", "hard"):
        raise HTTPException(status_code=400, detail="Invalid difficulty")
    if req.game_mode not in ("classic", "ticking_away"):
        raise HTTPException(status_code=400, detail="Invalid game_mode")
    if req.guess_mode not in ("song", "artist"):
        raise HTTPException(status_code=400, detail="Invalid guess_mode")

    session_id = secrets.token_urlsafe(16)

    async with get_conn() as conn:
        room_id = None
        room_track_ids: list[str] | None = None
        if req.room_code:
            room = await conn.fetchrow(
                "SELECT id, track_ids FROM rooms WHERE room_code = $1",
                req.room_code.upper(),
            )
            if room:
                room_id = room["id"]
                room_track_ids = list(room["track_ids"] or [])

        if room_track_ids:
            # H2H: both players play the room's seeded order.
            rows = await conn.fetch(
                """
                SELECT track_id, name, artist, preview_url, album_image
                FROM tracks
                WHERE track_id = ANY($1)
                  AND preview_url IS NOT NULL AND preview_url != ''
                  AND preview_unavailable = FALSE
                """,
                room_track_ids,
            )
            by_id = {r["track_id"]: r for r in rows}
            ordered = [by_id[tid] for tid in room_track_ids if tid in by_id]
        elif req.is_daily:
            from daily import get_or_create_daily
            challenge = await get_or_create_daily()
            daily_ids = list(challenge.get("track_ids", []))
            rows = await conn.fetch(
                """
                SELECT track_id, name, artist, preview_url, album_image
                FROM tracks
                WHERE track_id = ANY($1)
                  AND preview_url IS NOT NULL AND preview_url != ''
                  AND preview_unavailable = FALSE
                """,
                daily_ids,
            )
            by_id = {r["track_id"]: r for r in rows}
            ordered = [by_id[tid] for tid in daily_ids if tid in by_id]
            if not req.playlist_id:
                req.playlist_id = challenge.get("playlist_id") or ""
        elif req.track_ids:
            # Legacy path: client-chosen tracks/order (old app versions).
            if len(req.track_ids) > MAX_SESSION_TRACKS:
                raise HTTPException(status_code=400, detail="Too many tracks (max 100)")
            rows = await conn.fetch(
                """
                SELECT track_id, name, artist, preview_url, album_image
                FROM tracks
                WHERE track_id = ANY($1)
                  AND preview_url IS NOT NULL AND preview_url != ''
                  AND preview_unavailable = FALSE
                """,
                req.track_ids,
            )
            by_id = {r["track_id"]: r for r in rows}
            ordered = [by_id[tid] for tid in req.track_ids if tid in by_id]
        else:
            # New path: the server picks a random subset so the client never
            # learns which track plays in which round (anti-cheat).
            if not req.playlist_id:
                raise HTTPException(status_code=400, detail="playlist_id required")
            count = max(1, min(req.song_count, MAX_SESSION_TRACKS))
            ordered = await conn.fetch(
                """
                SELECT t.track_id, t.name, t.artist, t.preview_url, t.album_image
                FROM playlist_tracks pt
                JOIN tracks t ON t.track_id = pt.track_id
                WHERE pt.playlist_id = $1
                  AND t.preview_url IS NOT NULL AND t.preview_url != ''
                  AND t.preview_unavailable = FALSE
                ORDER BY random()
                LIMIT $2
                """,
                req.playlist_id,
                count,
            )

        if not ordered:
            # Provide detailed error info for better UX — frontend can show
            # playable/pending counts and auto-retry instead of a generic toast.
            total_in_playlist = await conn.fetchval(
                "SELECT total_in_playlist FROM playlists WHERE playlist_id = $1",
                req.playlist_id,
            )
            playable_count = await conn.fetchval(
                """
                SELECT COUNT(*) FROM playlist_tracks pt
                JOIN tracks t ON t.track_id = pt.track_id
                WHERE pt.playlist_id = $1
                  AND t.preview_url IS NOT NULL AND t.preview_url != ''
                  AND t.preview_unavailable = FALSE
                """,
                req.playlist_id,
            )
            pending_count = await conn.fetchval(
                """
                SELECT COUNT(*) FROM playlist_tracks pt
                JOIN tracks t ON t.track_id = pt.track_id
                WHERE pt.playlist_id = $1
                  AND (t.preview_url IS NULL OR t.preview_url = '')
                  AND t.preview_unavailable = FALSE
                  AND t.preview_retry_count < 5
                """,
                req.playlist_id,
            )
            detail = {
                "message": "None of the provided track IDs are playable",
                "playable_count": playable_count or 0,
                "total_in_playlist": total_in_playlist or 0,
                "pending_count": pending_count or 0,
                "retry_after_seconds": 3,
            }
            raise HTTPException(status_code=400, detail=detail)

        tracks_json: dict[str, dict] = {"_streak": 0}
        for i, r in enumerate(ordered):
            tracks_json[r["track_id"]] = {
                "name": r["name"],
                "artist": r["artist"],
                "preview_url": r["preview_url"] or "",
                "album_image": r["album_image"] or "",
                "position": i,
                "answered": False,
                "correct": None,
                "answered_stage": None,
                "current_stage": 0,
                "started_at": None,
            }

        await conn.execute(
            """
            INSERT INTO game_sessions (
                session_id, user_id, playlist_id, room_id,
                game_mode, guess_mode, difficulty, is_daily,
                tracks, expires_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
            """,
            session_id,
            user["id"],
            req.playlist_id or None,
            room_id,
            req.game_mode,
            req.guess_mode,
            req.difficulty,
            req.is_daily,
            json.dumps(tracks_json),
            datetime.now(timezone.utc) + timedelta(hours=2),
        )

    total_rounds = len(ordered)
    logger.info(
        f"Session started: session_id={session_id} user={user['id']} "
        f"tracks={total_rounds} mode={req.game_mode}/{req.guess_mode}"
    )
    return {"session_id": session_id, "total_rounds": total_rounds}


@sessions_router.post("/{session_id}/guess")
async def submit_guess(
    session_id: str,
    req: GuessRequest,
    user=Depends(require_user),
    background_tasks: BackgroundTasks = None,
):
    """Server-checked guess for one round. The client never learns the track
    until this endpoint reveals it; scores are computed and stored here."""
    if not req.skip and not req.track_id and not (req.artist or "").strip():
        raise HTTPException(status_code=400, detail="Provide a guess or skip")

    now = datetime.now(timezone.utc)

    async with get_conn() as conn:
        async with conn.transaction():
            # FOR UPDATE: serializes concurrent guesses on the same session so
            # a replayed request can't double-score a track.
            session = await conn.fetchrow(
                """
                SELECT session_id, user_id, playlist_id, room_id, game_mode,
                       guess_mode, difficulty, is_daily, tracks
                FROM game_sessions
                WHERE session_id = $1 AND expires_at > NOW()
                FOR UPDATE
                """,
                session_id,
            )
            if not session or str(session["user_id"]) != str(user["id"]):
                raise HTTPException(status_code=404, detail="Session not found")

            tracks_data = _load_tracks_json(session["tracks"])
            tid, entry = _entry_by_position(tracks_data, req.round)
            if entry is None:
                raise HTTPException(status_code=400, detail="Invalid round")
            if entry.get("answered"):
                raise HTTPException(status_code=409, detail="Already answered this round")

            cfg = DIFFICULTIES.get(session["difficulty"], DIFFICULTIES["normal"])
            max_stage = len(cfg["points"]) - 1
            stage = min(max(entry.get("current_stage", 0), 0), max_stage)

            started_at = entry.get("started_at")
            elapsed = 0.0
            if started_at:
                elapsed = max(0.0, min(now.timestamp() - float(started_at), MAX_ELAPSED))

            # Determine correctness server-side.
            if req.skip:
                correct = False
            elif session["guess_mode"] == "artist":
                submitted = (req.artist or "").lower().strip()
                artist_parts = [p.strip() for p in entry["artist"].lower().split(",")]
                correct = bool(submitted) and any(submitted == p for p in artist_parts)
            else:
                correct = req.track_id == tid

            streak = int(tracks_data.get("_streak", 0) or 0)
            game_mode = session["game_mode"]
            reveal = {
                "id": tid,
                "name": entry["name"],
                "artist": entry["artist"],
                "album_image": entry.get("album_image", ""),
            }

            if not correct and stage < max_stage:
                # Advance the clip stage; round continues, no reveal.
                entry["current_stage"] = stage + 1
                tracks_data["_streak"] = 0
                await conn.execute(
                    "UPDATE game_sessions SET tracks = $1::jsonb WHERE session_id = $2",
                    json.dumps(tracks_data),
                    session_id,
                )
                return {"correct": False, "done": False, "stage": stage + 1}

            # Round is over — either correct, or failed on the final stage.
            multiplier = 1.0
            if correct:
                if stage == 0:
                    streak += 1
                if game_mode == "classic":
                    base = cfg["points"][stage]
                    score_data = {"base_score": base, "time_penalty": 0, "final_score": base}
                else:
                    score_data = compute_score(session["difficulty"], stage, elapsed)
                    multiplier = _streak_multiplier(streak)
                    if multiplier > 1.0:
                        score_data["final_score"] = int(score_data["final_score"] * multiplier)
                tracks_data["_streak"] = streak
            else:
                score_data = {"base_score": 0, "time_penalty": 0, "final_score": 0}
                tracks_data["_streak"] = 0

            entry["answered"] = True
            entry["correct"] = correct
            entry["answered_stage"] = stage
            await conn.execute(
                "UPDATE game_sessions SET tracks = $1::jsonb WHERE session_id = $2",
                json.dumps(tracks_data),
                session_id,
            )

            is_daily = session["is_daily"]
            daily_date = now.date() if is_daily else None
            if is_daily:
                already = await conn.fetchval(
                    """
                    SELECT COUNT(*) FROM scores
                    WHERE user_id = $1 AND is_daily = TRUE
                      AND daily_date = $2 AND track_id = $3
                    """,
                    user["id"], daily_date, tid,
                )
                if already and already > 0:
                    raise HTTPException(
                        status_code=409,
                        detail="Already submitted a score for this daily track",
                    )

            playlist_id = session["playlist_id"]
            pl_exists = (
                await conn.fetchval(
                    "SELECT 1 FROM playlists WHERE playlist_id = $1", playlist_id
                )
                if playlist_id
                else None
            )

            await conn.execute(
                """
                INSERT INTO scores (
                    user_id, playlist_id, track_id,
                    base_score, time_penalty, final_score,
                    clip_length_used, elapsed_seconds,
                    is_daily, daily_date, game_mode, guess_mode, multiplier,
                    session_id, clip_stage, is_correct
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
                        $14, $15, $16)
                """,
                user["id"],
                playlist_id if pl_exists else None,
                tid,
                score_data["base_score"],
                score_data["time_penalty"],
                score_data["final_score"],
                cfg["clip_durations"][stage],
                round(elapsed, 3),
                is_daily,
                daily_date,
                game_mode,
                session["guess_mode"],
                round(multiplier, 2),
                session_id,
                stage,
                correct,
            )

            if session["room_id"] and score_data["final_score"] > 0:
                room = await conn.fetchrow(
                    "SELECT id, host_user_id, guest_user_id FROM rooms WHERE id = $1",
                    session["room_id"],
                )
                if room:
                    correct_inc = 1 if correct else 0
                    if str(user["id"]) == str(room["host_user_id"]):
                        await conn.execute(
                            """UPDATE rooms
                               SET host_score = host_score + $1,
                                   host_correct = host_correct + $2
                               WHERE id = $3""",
                            score_data["final_score"], correct_inc, room["id"],
                        )
                    elif str(user["id"]) == str(room["guest_user_id"]):
                        await conn.execute(
                            """UPDATE rooms
                               SET guest_score = guest_score + $1,
                                   guest_correct = guest_correct + $2
                               WHERE id = $3""",
                            score_data["final_score"], correct_inc, room["id"],
                        )

    # --- Critical DB transaction committed. Now fire background tasks. ---

    if background_tasks:
        # Daily streak update - fire and forget
        if is_daily:
            background_tasks.add_task(_update_daily_streak_bg, user["id"])
        
        # Achievement check - fire and forget
        background_tasks.add_task(
            _check_achievements_bg,
            user["id"],
            correct,
            stage,
            elapsed,
            session["difficulty"],
        )

    logger.info(
        f"Guess resolved: session={session_id} round={req.round} "
        f"correct={correct} stage={stage} final={score_data['final_score']}"
    )

    new_badges = []
    # Note: badges are now checked in background; response won't include them
    # for this request. Frontend can poll /achievements or rely on next page load.

    response = {
        "correct": correct,
        "done": True,
        "stage": stage,
        "reveal": reveal,
        "score": score_data,
        "multiplier": multiplier,
        "elapsed_seconds": round(elapsed, 3),
    }
    return response


async def _update_daily_streak_bg(user_id: str):
    """Background task to update daily streak."""
    try:
        from database import get_conn as _get_conn
        async with _get_conn() as conn:
            await update_daily_streak(conn, user_id)
    except Exception as e:
        logger.warning(f"Background daily streak update failed: {e}")


async def _check_achievements_bg(user_id: str, correct: bool, clip_stage: int, elapsed_seconds: float, difficulty: str):
    """Background task to check per-track achievements."""
    try:
        await check_per_track_achievements(
            user_id=user_id,
            track_result={
                "correct": correct,
                "clip_stage": clip_stage,
                "elapsed_seconds": elapsed_seconds,
            },
            difficulty=difficulty,
        )
    except Exception as e:
        logger.warning(f"Background achievement check failed: {e}")
