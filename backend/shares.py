import json
import logging
import secrets

from fastapi import APIRouter, HTTPException, Request, Depends
from pydantic import BaseModel, Field, field_validator

from auth import get_current_user
from database import get_conn

logger = logging.getLogger(__name__)

share_router = APIRouter(prefix="/api/share", tags=["shares"])

def generate_share_id() -> str:
    return secrets.token_urlsafe(16)[:16]

class TrackResult(BaseModel):
    track_id: str = ""
    track_name: str = ""
    artist: str = ""
    correct: bool = False
    clip_stage: int = 0
    points: int = 0
    elapsed_seconds: float = 0.0

    @field_validator("track_id", "track_name", "artist")
    @classmethod
    def limit_str(cls, v: str) -> str:
        return v[:200] if v else v

class CreateShareRequest(BaseModel):
    username: str = "Guest"
    score: int = 0
    max_score: int = 0
    correct_guesses: int = 0
    total_tracks: int = 0
    playlist_id: str = ""
    playlist_name: str = ""
    playlist_image: str = ""
    difficulty: str = "normal"
    game_mode: str = "classic"
    guess_mode: str = "song"
    is_daily: bool = False
    results: list[TrackResult] = Field(default=[], max_length=50)
    timestamp: str = ""

@share_router.post("")
async def create_share(
    req: CreateShareRequest,
    request: Request,
    user=Depends(get_current_user),
):
    if not user:
        raise HTTPException(
            status_code=401,
            detail="Authentication required to create a share",
        )

    display_username = (
        user.get("username", req.username)
        if not user.get("is_guest")
        else (req.username or "Guest")
    )

    from server import share_rate_limiter
    client_ip = request.client.host if request.client else "unknown"
    if not share_rate_limiter.is_allowed(client_ip):
        raise HTTPException(
            status_code=429,
            detail="Too many share requests. Please wait a moment.",
        )

    results_json = json.dumps([r.model_dump() for r in req.results])
    if len(results_json) > 32_000:
        raise HTTPException(status_code=400, detail="Share data too large")

    for _attempt in range(2):
        share_id = generate_share_id()
        async with get_conn() as conn:
            inserted = await conn.fetchval(
                """
                INSERT INTO shares (
                    share_id, username, score, max_score,
                    correct_guesses, total_tracks, playlist_id,
                    playlist_name, playlist_image, difficulty,
                    game_mode, guess_mode, is_daily, results
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
                ON CONFLICT (share_id) DO NOTHING
                RETURNING share_id
                """,
                share_id,
                display_username,
                req.score,
                req.max_score,
                req.correct_guesses,
                req.total_tracks,
                req.playlist_id,
                req.playlist_name,
                req.playlist_image or "",
                req.difficulty,
                req.game_mode,
                req.guess_mode,
                req.is_daily,
                results_json,
            )
        if inserted is not None:
            break
    else:
        raise HTTPException(status_code=500, detail="Failed to generate unique share ID")

    logger.info(f"Share created: {share_id} for {display_username}")
    return {"share_id": share_id}

@share_router.get("/{share_id}")
async def get_share(share_id: str):
    if len(share_id) > 16:
        raise HTTPException(status_code=400, detail="Invalid share ID")

    async with get_conn() as conn:
        row = await conn.fetchrow(
            """
            SELECT share_id, username, score, max_score,
                   correct_guesses, total_tracks, playlist_id,
                   playlist_name, playlist_image, difficulty,
                   game_mode, guess_mode, is_daily, results, created_at
            FROM shares WHERE share_id = $1
            """,
            share_id,
        )

    if not row:
        raise HTTPException(status_code=404, detail="Share not found")

    result = dict(row)
    result["created_at"] = result["created_at"].isoformat()
    if isinstance(result["results"], str):
        result["results"] = json.loads(result["results"])
    return result
