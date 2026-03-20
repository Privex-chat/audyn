import random
import string
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from auth import require_user, get_current_user
from database import get_conn
from scoring import DIFFICULTIES

logger = logging.getLogger(__name__)

rooms_router = APIRouter(prefix="/api/rooms", tags=["rooms"])

def generate_room_code(length=6):
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=length))

class CreateRoomRequest(BaseModel):
    playlist_id: str
    song_count: int = 10
    difficulty: str = "normal"
    game_mode: str = "classic"
    guess_mode: str = "song"

class UpdateProgressRequest(BaseModel):
    clip_stage: int | None = None
    elapsed_seconds: float | None = None
    tracks_completed: int | None = None  # how many tracks this player has finished

@rooms_router.post("/create")
async def create_room(req: CreateRoomRequest, user=Depends(require_user)):
    if req.difficulty not in ("easy", "normal", "hard"):
        raise HTTPException(status_code=400, detail="Invalid difficulty")
    if req.game_mode not in ("classic", "ticking_away"):
        raise HTTPException(status_code=400, detail="Invalid game_mode")
    if req.guess_mode not in ("song", "artist"):
        raise HTTPException(status_code=400, detail="Invalid guess_mode")

    async with get_conn() as conn:
        tracks = await conn.fetch(
            """
            SELECT t.track_id, t.name, t.artist, t.preview_url, t.album_name, t.album_image
            FROM playlist_tracks pt
            JOIN tracks t ON t.track_id = pt.track_id
            WHERE pt.playlist_id = $1 AND t.preview_url IS NOT NULL AND t.preview_url != ''
            ORDER BY pt.position
            """,
            req.playlist_id,
        )

        if len(tracks) < req.song_count:
            raise HTTPException(status_code=400, detail="Not enough playable tracks in playlist")

        for _ in range(10):
            code = generate_room_code()
            exists = await conn.fetchval("SELECT 1 FROM rooms WHERE room_code = $1", code)
            if not exists:
                break
        else:
            raise HTTPException(status_code=500, detail="Could not generate unique room code")

        room_id = await conn.fetchval(
            """
            INSERT INTO rooms (room_code, host_user_id, playlist_id, song_count, difficulty,
                               game_mode, guess_mode, track_ids, status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'waiting')
            RETURNING id
            """,
            code, user["id"], req.playlist_id, req.song_count,
            req.difficulty, req.game_mode, req.guess_mode, [],
        )

        rng = random.Random(str(room_id))
        all_ids = [r["track_id"] for r in tracks]
        rng.shuffle(all_ids)
        selected = all_ids[:req.song_count]

        await conn.execute(
            "UPDATE rooms SET track_ids = $1 WHERE id = $2", selected, room_id
        )

        def map_track(r):
            d = dict(r)
            d["id"] = d.pop("track_id", d.get("id"))
            return d

        tracks_by_id = {r["track_id"]: map_track(r) for r in tracks}
        ordered_tracks = [tracks_by_id[tid] for tid in selected if tid in tracks_by_id]

        response_tracks = ordered_tracks.copy()
        random.shuffle(response_tracks)

    return {
        "room_code": code,
        "room_id": str(room_id),
        "tracks": response_tracks,
    }

@rooms_router.post("/join/{room_code}")
async def join_room(room_code: str, user=Depends(require_user)):
    async with get_conn() as conn:
        room = await conn.fetchrow(
            "SELECT * FROM rooms WHERE room_code = $1", room_code.upper()
        )
        if not room:
            raise HTTPException(status_code=404, detail="Room not found")
        if room["status"] != "waiting":
            raise HTTPException(status_code=400, detail="Room is no longer accepting players")
        if room["expires_at"] < datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="Room has expired")
        if room["guest_user_id"] is not None:
            raise HTTPException(status_code=400, detail="Room is full")
        if room["host_user_id"] == user["id"]:
            raise HTTPException(status_code=400, detail="Cannot join your own room")

        await conn.execute(
            "UPDATE rooms SET guest_user_id = $1, status = 'playing' WHERE id = $2",
            user["id"], room["id"],
        )

        tracks = await conn.fetch(
            """
            SELECT track_id, name, artist, preview_url, album_name, album_image
            FROM tracks WHERE track_id = ANY($1)
            """,
            list(room["track_ids"]),
        )

        def map_track(r):
            d = dict(r)
            d["id"] = d.pop("track_id", d.get("id"))
            return d

        tracks_by_id = {r["track_id"]: map_track(r) for r in tracks}
        ordered_tracks = [tracks_by_id[tid] for tid in room["track_ids"] if tid in tracks_by_id]

        response_tracks = ordered_tracks.copy()
        random.shuffle(response_tracks)

    return {
        "room_code": room["room_code"],
        "room_id": str(room["id"]),
        "tracks": response_tracks,
        "difficulty": room["difficulty"],
        "game_mode": room["game_mode"],
        "guess_mode": room["guess_mode"],
        "song_count": room["song_count"],
        "playlist_id": room["playlist_id"],
    }

@rooms_router.get("/{room_code}")
async def get_room(room_code: str, user=Depends(get_current_user)):
    async with get_conn() as conn:
        room = await conn.fetchrow(
            "SELECT * FROM rooms WHERE room_code = $1", room_code.upper()
        )
        if not room:
            raise HTTPException(status_code=404, detail="Room not found")

        if not user:
            return {
                "room_code": room["room_code"],
                "status": room["status"],
                "difficulty": room["difficulty"],
                "game_mode": room["game_mode"],
                "song_count": room["song_count"],
            }

        user_id = str(user["id"])
        host_id = str(room["host_user_id"]) if room["host_user_id"] else None
        guest_id = str(room["guest_user_id"]) if room["guest_user_id"] else None
        is_participant = user_id in (host_id, guest_id)

        if not is_participant:
            return {
                "room_code": room["room_code"],
                "status": room["status"],
                "difficulty": room["difficulty"],
                "game_mode": room["game_mode"],
                "song_count": room["song_count"],
            }

        host = await conn.fetchrow(
            "SELECT username, avatar_url FROM users WHERE id = $1", room["host_user_id"]
        )
        guest = None
        if room["guest_user_id"]:
            guest = await conn.fetchrow(
                "SELECT username, avatar_url FROM users WHERE id = $1", room["guest_user_id"]
            )

    both_finished = room["status"] == "finished"
    user_id = str(user["id"])
    host_id = str(room["host_user_id"]) if room["host_user_id"] else None

    def player_score(is_me: bool, raw_score: int):
        return raw_score if (both_finished or is_me) else None

    return {
        "room_code": room["room_code"],
        "status": room["status"],
        "host": {
            "user_id": str(room["host_user_id"]),
            "username": host["username"] if host else "Unknown",
            "avatar_url": host["avatar_url"] if host else "",
            "score": player_score(user_id == host_id, room["host_score"]),
            "progress": room["host_progress"],
            "correct": room["host_correct"],
        },
        "guest": {
            "user_id": str(room["guest_user_id"]) if room["guest_user_id"] else None,
            "username": guest["username"] if guest else None,
            "avatar_url": guest["avatar_url"] if guest else None,
            "score": player_score(user_id != host_id, room["guest_score"]),
            "progress": room["guest_progress"],
            "correct": room["guest_correct"],
        } if room["guest_user_id"] else None,
        "difficulty": room["difficulty"],
        "game_mode": room["game_mode"],
        "guess_mode": room["guess_mode"],
        "song_count": room["song_count"],
        "playlist_id": room["playlist_id"],
    }

@rooms_router.post("/{room_code}/score")
async def update_room_progress(
    room_code: str,
    req: UpdateProgressRequest,
    user=Depends(require_user),
):
    async with get_conn() as conn:
        room = await conn.fetchrow(
            "SELECT id, host_user_id, guest_user_id FROM rooms WHERE room_code = $1",
            room_code.upper(),
        )
        if not room:
            raise HTTPException(status_code=404, detail="Room not found")

        uid = str(user["id"])
        host_id = str(room["host_user_id"]) if room["host_user_id"] else ""
        guest_id = str(room["guest_user_id"]) if room["guest_user_id"] else ""

        if uid not in (host_id, guest_id):
            raise HTTPException(status_code=403, detail="Not a participant in this room")

        if req.tracks_completed is not None:
            if uid == host_id:
                await conn.execute(
                    "UPDATE rooms SET host_progress = $1 WHERE id = $2",
                    req.tracks_completed, room["id"],
                )
            elif uid == guest_id:
                await conn.execute(
                    "UPDATE rooms SET guest_progress = $1 WHERE id = $2",
                    req.tracks_completed, room["id"],
                )

    return {"ok": True}

@rooms_router.post("/{room_code}/finish")
async def finish_room(room_code: str, user=Depends(require_user)):
    async with get_conn() as conn:
        room = await conn.fetchrow(
            "SELECT * FROM rooms WHERE room_code = $1", room_code.upper()
        )
        if not room:
            raise HTTPException(status_code=404, detail="Room not found")

        is_host = user["id"] == room["host_user_id"]
        is_guest = user["id"] == room["guest_user_id"]
        if not is_host and not is_guest:
            raise HTTPException(status_code=403, detail="Not a participant")

        current_status = room["status"]
        if current_status == "playing":
            new_status = "host_done" if is_host else "guest_done"
        elif current_status == "host_done" and is_guest:
            new_status = "finished"
        elif current_status == "guest_done" and is_host:
            new_status = "finished"
        elif current_status == "finished":
            return {"status": "finished"}
        else:
            return {"status": current_status}

        await conn.execute(
            "UPDATE rooms SET status = $1 WHERE id = $2", new_status, room["id"]
        )

    return {"status": new_status}
