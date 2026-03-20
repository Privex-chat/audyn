import json
import secrets
import logging
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from auth import require_user
from database import get_conn

logger = logging.getLogger(__name__)

sessions_router = APIRouter(prefix="/api/sessions", tags=["sessions"])

class StartSessionRequest(BaseModel):
    playlist_id: str = ""
    track_ids: list[str]
    difficulty: str = "normal"
    game_mode: str = "classic"
    guess_mode: str = "song"
    is_daily: bool = False
    room_code: str | None = None

@sessions_router.post("/start")
async def start_session(req: StartSessionRequest, user=Depends(require_user)):
    if req.difficulty not in ("easy", "normal", "hard"):
        raise HTTPException(status_code=400, detail="Invalid difficulty")
    if req.game_mode not in ("classic", "ticking_away"):
        raise HTTPException(status_code=400, detail="Invalid game_mode")
    if req.guess_mode not in ("song", "artist"):
        raise HTTPException(status_code=400, detail="Invalid guess_mode")
    if not req.track_ids:
        raise HTTPException(status_code=400, detail="No tracks provided")
    if len(req.track_ids) > 100:
        raise HTTPException(status_code=400, detail="Too many tracks (max 100)")

    session_id = secrets.token_urlsafe(16)

    async with get_conn() as conn:
        rows = await conn.fetch(
            "SELECT track_id, name, artist FROM tracks WHERE track_id = ANY($1)",
            req.track_ids,
        )
        track_map = {r["track_id"]: r for r in rows}

        tracks_json: dict[str, dict] = {}
        for i, tid in enumerate(req.track_ids):
            meta = track_map.get(tid)
            tracks_json[tid] = {
                "name": meta["name"] if meta else "",
                "artist": meta["artist"] if meta else "",
                "position": i,
                "answered": False,
                "current_stage": 0,
                "started_at": None,
            }

        room_id = None
        if req.room_code:
            room = await conn.fetchrow(
                "SELECT id FROM rooms WHERE room_code = $1",
                req.room_code.upper(),
            )
            if room:
                room_id = room["id"]

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

    logger.info(
        f"Session started: session_id={session_id} user={user['id']} "
        f"tracks={len(req.track_ids)} mode={req.game_mode}/{req.guess_mode}"
    )
    return {"session_id": session_id}
