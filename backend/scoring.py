import json
import logging
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel

from auth import require_user
from database import get_conn
from achievements import check_per_track_achievements, check_achievements, BADGES

logger = logging.getLogger(__name__)

score_router = APIRouter(prefix="/api/scores", tags=["scores"])

DIFFICULTIES = {
    "easy": {
        "clip_durations": [2, 5, 10, 15, 20],
        "points": [60, 45, 30, 20, 10],
        "decay_rate": 1.0,
        "min_score_pct": 0.6,
    },
    "normal": {
        "clip_durations": [0.5, 1.2, 2, 9, 15],
        "points": [100, 80, 60, 30, 15],
        "decay_rate": 2.0,
        "min_score_pct": 0.4,
    },
    "hard": {
        "clip_durations": [0.3, 0.6, 1, 1.5, 3],
        "points": [170, 130, 100, 60, 25],
        "decay_rate": 3.5,
        "min_score_pct": 0.25,
    },
}

def compute_score(difficulty: str, clip_stage: int, elapsed_seconds: float) -> dict:
    cfg = DIFFICULTIES.get(difficulty, DIFFICULTIES["normal"])
    points = cfg["points"]

    if clip_stage < 0:
        clip_stage = 0
    if clip_stage >= len(points):
        clip_stage = len(points) - 1

    base = points[clip_stage]
    min_score = int(base * cfg["min_score_pct"])
    max_penalty = base - min_score

    raw_penalty = int(elapsed_seconds * cfg["decay_rate"])
    penalty = min(raw_penalty, max_penalty)
    final = base - penalty

    return {
        "base_score": base,
        "time_penalty": penalty,
        "final_score": final,
    }

class SubmitScoreRequest(BaseModel):
    track_id: str
    playlist_id: str
    clip_stage: int
    start_timestamp: float
    guess_timestamp: float
    clip_length_used: float
    difficulty: str = "normal"
    game_mode: str = "classic"
    guess_mode: str = "song"
    correct: bool = True
    is_daily: bool = False
    streak_bonus_applied: bool = False
    multiplier: float = 1.0
    elapsed_seconds: float | None = None
    room_code: str | None = None
    session_id: str | None = None
    guess: str | None = None

class SessionCompleteRequest(BaseModel):
    session_results: list
    difficulty: str = "normal"
    game_mode: str = "classic"
    guess_mode: str = "song"
    playlist_track_count: int = 0
    playlist_id: str = ""
    session_id: str | None = None
    # FIX: accept the player's local hour (0–23) so night_owl uses their local
    # clock rather than the server's UTC time. Matches the API docs.
    client_hour: int | None = None

@score_router.post("/submit")
async def submit_score(
    req: SubmitScoreRequest,
    request: Request,
    user=Depends(require_user),
):
    if req.difficulty not in DIFFICULTIES:
        raise HTTPException(status_code=400, detail="Invalid difficulty")
    if req.game_mode not in ("classic", "ticking_away"):
        raise HTTPException(status_code=400, detail="Invalid game_mode")
    if req.guess_mode not in ("song", "artist"):
        raise HTTPException(status_code=400, detail="Invalid guess_mode")
    if req.multiplier > 2.0:
        raise HTTPException(status_code=400, detail="Invalid multiplier — max 2.0")
    if req.multiplier > 1.0 and req.game_mode != "ticking_away":
        req.multiplier = 1.0

    if req.elapsed_seconds is not None and req.elapsed_seconds >= 0:
        elapsed = req.elapsed_seconds
    else:
        elapsed = max(0, (req.guess_timestamp - req.start_timestamp) / 1000)

    MAX_ELAPSED = 600
    if elapsed > MAX_ELAPSED:
        logger.warning(
            f"Elapsed clamped: user={user['id']} raw={elapsed:.1f}s -> {MAX_ELAPSED}s"
        )
        elapsed = MAX_ELAPSED
    if req.guess_timestamp < req.start_timestamp and req.elapsed_seconds is None:
        elapsed = 0
        logger.warning(f"Negative timestamp diff for user={user['id']}, defaulting elapsed=0")

    if req.session_id and not user.get("is_guest"):
        async with get_conn() as conn:
            session_row = await conn.fetchrow(
                """
                SELECT session_id, tracks
                FROM game_sessions
                WHERE session_id = $1 AND user_id = $2 AND expires_at > NOW()
                """,
                req.session_id,
                user["id"],
            )
        if not session_row:
            raise HTTPException(status_code=400, detail="Invalid or expired session")

        raw = session_row["tracks"]
        tracks_data = json.loads(raw) if isinstance(raw, str) else dict(raw)

        if req.track_id not in tracks_data:
            raise HTTPException(status_code=400, detail="Track not part of this session")

        track_entry = tracks_data[req.track_id]
        if track_entry.get("answered"):
            raise HTTPException(status_code=409, detail="Already answered this track")

        if req.guess_mode == "artist":
            stored_artist = track_entry.get("artist", "").lower().strip()
            submitted = (req.guess or "").lower().strip()
            if not submitted:
                req.correct = False
            else:
                artist_parts = [p.strip() for p in stored_artist.split(",")]
                req.correct = any(submitted == part for part in artist_parts)

    if req.is_daily:
        try:
            from daily import get_or_create_daily
            challenge = await get_or_create_daily()
            if req.track_id not in challenge.get("track_ids", []):
                raise HTTPException(
                    status_code=400,
                    detail="Track is not part of today's daily challenge",
                )
        except HTTPException:
            raise
        except Exception as e:
            logger.warning(f"Daily challenge verification failed: {e}")
            req.is_daily = False

    if not req.correct:
        score_data = {"base_score": 0, "time_penalty": 0, "final_score": 0}
    elif req.game_mode == "classic":
        cfg = DIFFICULTIES.get(req.difficulty, DIFFICULTIES["normal"])
        stage = min(max(req.clip_stage, 0), len(cfg["points"]) - 1)
        base = cfg["points"][stage]
        score_data = {"base_score": base, "time_penalty": 0, "final_score": base}
    else:
        score_data = compute_score(req.difficulty, req.clip_stage, elapsed)

    client_ip = request.client.host if request.client else None
    daily_date = datetime.now(timezone.utc).date() if req.is_daily else None
    playlist_id = req.playlist_id if req.playlist_id else None

    if req.multiplier > 1.0 and req.game_mode == "ticking_away" and req.correct:
        score_data["final_score"] = int(score_data["final_score"] * req.multiplier)

    async with get_conn() as conn:
        if req.is_daily:
            already_submitted = await conn.fetchval(
                """
                SELECT COUNT(*) FROM scores
                WHERE user_id = $1 AND is_daily = TRUE AND daily_date = $2 AND track_id = $3
                """,
                user["id"],
                daily_date,
                req.track_id,
            )
            if already_submitted and already_submitted > 0:
                raise HTTPException(
                    status_code=409,
                    detail="You have already submitted a score for this daily challenge track",
                )

        pl_exists = (
            await conn.fetchval(
                "SELECT 1 FROM playlists WHERE playlist_id = $1", playlist_id
            )
            if playlist_id
            else None
        )
        tr_exists = await conn.fetchval(
            "SELECT 1 FROM tracks WHERE track_id = $1", req.track_id
        )
        safe_playlist_id = playlist_id if pl_exists else None
        safe_track_id = req.track_id if tr_exists else None

        await conn.execute(
            """
            INSERT INTO scores (
                user_id, playlist_id, track_id,
                base_score, time_penalty, final_score,
                clip_length_used, elapsed_seconds, client_ip,
                is_daily, daily_date, game_mode, guess_mode, multiplier,
                session_id, clip_stage, is_correct
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::inet, $10, $11, $12, $13, $14,
                    $15, $16, $17)
            """,
            user["id"],
            safe_playlist_id,
            safe_track_id,
            score_data["base_score"],
            score_data["time_penalty"],
            score_data["final_score"],
            req.clip_length_used,
            round(elapsed, 3),
            client_ip,
            req.is_daily,
            daily_date,
            req.game_mode,
            req.guess_mode,
            round(req.multiplier, 2),
            req.session_id,
            req.clip_stage,
            req.correct,
        )

        if req.is_daily:
            try:
                today = datetime.now(timezone.utc).date()
                yesterday = today - timedelta(days=1)
                row = await conn.fetchrow(
                    "SELECT daily_streak, last_daily_date FROM users WHERE id = $1",
                    user["id"],
                )
                if row:
                    last_date = row["last_daily_date"]
                    current_streak = row["daily_streak"] or 0
                    if last_date != today:
                        new_streak = (current_streak + 1) if last_date == yesterday else 1
                        await conn.execute(
                            "UPDATE users SET daily_streak = $1, last_daily_date = $2 WHERE id = $3",
                            new_streak,
                            today,
                            user["id"],
                        )
                        logger.info(f"Daily streak updated: user={user['id']} streak={new_streak}")
            except Exception as e:
                logger.warning(f"Daily streak update failed: {e}")

        if req.room_code and score_data["final_score"] > 0:
            room = await conn.fetchrow(
                "SELECT id, host_user_id, guest_user_id FROM rooms WHERE room_code = $1",
                req.room_code.upper(),
            )
            if room:
                correct_inc = 1 if req.correct else 0
                if str(user["id"]) == str(room["host_user_id"]):
                    await conn.execute(
                        """UPDATE rooms
                           SET host_score   = host_score   + $1,
                               host_correct = host_correct + $2
                           WHERE id = $3""",
                        score_data["final_score"], correct_inc, room["id"],
                    )
                elif str(user["id"]) == str(room["guest_user_id"]):
                    await conn.execute(
                        """UPDATE rooms
                           SET guest_score   = guest_score   + $1,
                               guest_correct = guest_correct + $2
                           WHERE id = $3""",
                        score_data["final_score"], correct_inc, room["id"],
                    )

    if req.session_id and not user.get("is_guest"):
        try:
            async with get_conn() as conn:
                await conn.execute(
                    """
                    UPDATE game_sessions
                    SET tracks = jsonb_set(
                        tracks,
                        ARRAY[$1::text, 'answered'],
                        'true'::jsonb
                    )
                    WHERE session_id = $2
                    """,
                    req.track_id,
                    req.session_id,
                )
        except Exception as e:
            logger.warning(f"Session track mark-answered failed: {e}")

    logger.info(
        f"Score recorded: user={user['id']} track={req.track_id} "
        f"base={score_data['base_score']} penalty={score_data['time_penalty']} "
        f"final={score_data['final_score']} elapsed={elapsed:.2f}s"
    )

    new_badges = []
    try:
        new_badges = await check_per_track_achievements(
            user_id=user["id"],
            track_result={
                "correct": req.correct,
                "clip_stage": req.clip_stage,
                "elapsed_seconds": elapsed,
            },
            difficulty=req.difficulty,
        )
    except Exception as e:
        logger.warning(f"Achievement check failed: {e}")

    response = {**score_data, "elapsed_seconds": round(elapsed, 3)}
    if new_badges:
        response["new_badges"] = [
            {"key": k, "emoji": BADGES[k]["emoji"], "label": BADGES[k]["label"]}
            for k in new_badges
            if k in BADGES
        ]

    return response

@score_router.post("/session-complete")
async def session_complete(
    req: SessionCompleteRequest,
    user=Depends(require_user),
):
    """Called by the frontend at game end to trigger session-level achievement checks."""
    new_badges = []
    try:
        new_badges = await check_achievements(
            user_id=user["id"],
            session_results=req.session_results,
            difficulty=req.difficulty,
            playlist_id=req.playlist_id,
            session_id=req.session_id,
            game_mode=req.game_mode,
            client_hour=req.client_hour,
        )
    except Exception as e:
        logger.warning(f"Session achievement check failed: {e}")

    badge_details = [
        {"key": k, "emoji": BADGES[k]["emoji"], "label": BADGES[k]["label"]}
        for k in new_badges
        if k in BADGES
    ]
    return {"new_badges": badge_details}

@score_router.get("/my-scores")
async def get_my_scores(
    user=Depends(require_user),
    limit: int = 50,
):
    if limit > 500:
        limit = 500

    async with get_conn() as conn:
        rows = await conn.fetch(
            """
            SELECT id, playlist_id, track_id, base_score, time_penalty, final_score,
                   clip_length_used, elapsed_seconds, is_daily, daily_date, guessed_at
            FROM scores
            WHERE user_id = $1
            ORDER BY guessed_at DESC
            LIMIT $2
            """,
            user["id"],
            limit,
        )

    return [
        {
            "id": str(r["id"]),
            "playlist_id": r["playlist_id"],
            "track_id": r["track_id"],
            "base_score": r["base_score"],
            "time_penalty": r["time_penalty"],
            "final_score": r["final_score"],
            "clip_length_used": r["clip_length_used"],
            "elapsed_seconds": r["elapsed_seconds"],
            "is_daily": r["is_daily"],
            "daily_date": r["daily_date"].isoformat() if r["daily_date"] else None,
            "guessed_at": r["guessed_at"].isoformat() if r["guessed_at"] else None,
        }
        for r in rows
    ]