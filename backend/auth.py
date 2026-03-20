import os
import re
import bcrypt
import logging
from datetime import datetime, timezone, timedelta

from jose import jwt, JWTError
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr, field_validator
from better_profanity import profanity

import cloudinary
import cloudinary.uploader

from database import get_conn

import time
from collections import OrderedDict

logger = logging.getLogger(__name__)

auth_router = APIRouter(prefix="/api/auth", tags=["auth"])

def _validate_spotify_link(v: str) -> str:
    if not v:
        return v
    if not re.match(r'^https://open\.spotify\.com/user/[A-Za-z0-9_%]+(\?.*)?$', v):
        raise ValueError("Invalid Spotify URL. Must be https://open.spotify.com/user/...")
    return v

def _validate_instagram_link(v: str) -> str:
    if not v:
        return v
    if not re.match(r'^https://(www\.)?instagram\.com/[A-Za-z0-9_.]{1,30}/?$', v):
        raise ValueError("Invalid Instagram URL")
    return v

def _validate_pinterest_link(v: str) -> str:
    if not v:
        return v
    if not re.match(r'^https://(www\.)?pinterest\.com/[A-Za-z0-9_.]{1,30}/?$', v):
        raise ValueError("Invalid Pinterest URL")
    return v

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

_user_cache = TTLCache(max_size=500, ttl_seconds=300)

class AuthRateLimiter:
    def __init__(self, max_requests=5, window_seconds=60):
        self._hits: dict[str, list[float]] = {}
        self.max_requests = max_requests
        self.window = window_seconds

    def is_allowed(self, key: str) -> bool:
        import time as _time
        now = _time.time()
        hits = self._hits.get(key, [])
        hits = [t for t in hits if now - t < self.window]
        if len(hits) >= self.max_requests:
            self._hits[key] = hits
            return False
        hits.append(now)
        self._hits[key] = hits
        return True

auth_rate_limiter = AuthRateLimiter(max_requests=10, window_seconds=60)
auth_strict_limiter = AuthRateLimiter(max_requests=5, window_seconds=60)
bearer = HTTPBearer(auto_error=False)

JWT_SECRET = os.environ.get("JWT_SECRET", "")
JWT_ALGO = "HS256"
JWT_EXPIRE_HOURS = 72

if not JWT_SECRET:
    logger.warning("JWT_SECRET not set — auth endpoints will fail")

_cloudinary_url = os.environ.get("CLOUDINARY_URL", "")
if _cloudinary_url:
    cloudinary.config(cloudinary_url=_cloudinary_url, secure=True)
else:
    cloudinary.config(
        cloud_name=os.environ.get("CLOUDINARY_CLOUD_NAME", ""),
        api_key=os.environ.get("CLOUDINARY_API_KEY", ""),
        api_secret=os.environ.get("CLOUDINARY_API_SECRET", ""),
        secure=True,
    )
    if not os.environ.get("CLOUDINARY_API_KEY"):
        logger.warning("Cloudinary credentials not set — avatar uploads will fail")

DISPOSABLE_DOMAINS = frozenset({
    "mailinator.com", "tempmail.com", "throwaway.email", "guerrillamail.com",
    "yopmail.com", "sharklasers.com", "guerrillamailblock.com", "grr.la",
    "dispostable.com", "trashmail.com", "10minutemail.com", "temp-mail.org",
    "fakeinbox.com", "maildrop.cc", "guerrillamail.info", "guerrillamail.net",
})

class RegisterRequest(BaseModel):
    username: str
    email: EmailStr
    password: str
    bio: str = ""

    @field_validator("username")
    @classmethod
    def validate_username(cls, v):
        v = v.strip()
        if not 3 <= len(v) <= 30:
            raise ValueError("Username must be 3–30 characters")
        if not re.match(r"^[a-zA-Z0-9_]+$", v):
            raise ValueError("Username: letters, numbers, underscores only")
        if profanity.contains_profanity(v):
            raise ValueError("Username contains inappropriate language")
        return v

    @field_validator("email")
    @classmethod
    def validate_email_domain(cls, v):
        domain = v.split("@")[-1].lower()
        if domain in DISPOSABLE_DOMAINS:
            raise ValueError("Disposable email addresses are not allowed")
        return v.lower()

    @field_validator("bio")
    @classmethod
    def validate_bio(cls, v):
        if len(v) > 160:
            raise ValueError("Bio must be 160 characters or fewer")
        if v and profanity.contains_profanity(v):
            raise ValueError("Bio contains inappropriate language")
        return v

    @field_validator("password")
    @classmethod
    def validate_password(cls, v):
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class ProfileUpdate(BaseModel):
    bio: str | None = None
    display_name: str | None = None
    link_spotify: str | None = None
    link_instagram: str | None = None
    link_pinterest: str | None = None

    @field_validator("link_spotify")
    @classmethod
    def validate_spotify(cls, v):
        if v is not None:
            _validate_spotify_link(v)
        return v

    @field_validator("link_instagram")
    @classmethod
    def validate_instagram(cls, v):
        if v is not None:
            _validate_instagram_link(v)
        return v

    @field_validator("link_pinterest")
    @classmethod
    def validate_pinterest(cls, v):
        if v is not None:
            _validate_pinterest_link(v)
        return v

class GuestConvertRequest(BaseModel):
    guest_session_id: str
    username: str
    email: EmailStr
    password: str
    bio: str = ""

def create_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRE_HOURS),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)

async def get_current_user(
    creds: HTTPAuthorizationCredentials = Depends(bearer),
) -> dict | None:
    if not creds:
        return None
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALGO])
        user_id = payload.get("sub")
        if not user_id:
            return None
        cached = _user_cache.get(str(user_id))
        if cached is not None:
            return cached
        async with get_conn() as conn:
            row = await conn.fetchrow(
                "SELECT id, username, avatar_url, is_guest FROM users WHERE id = $1::uuid",
                user_id,
            )
        if row:
            user_dict = dict(row)
            _user_cache.set(str(user_id), user_dict)
            return user_dict
        return None
    except JWTError:
        return None

async def require_user(
    creds: HTTPAuthorizationCredentials = Depends(bearer),
) -> dict:
    user = await get_current_user(creds)
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user

@auth_router.post("/register")
async def register(req: RegisterRequest, request: Request):
    client_ip = request.client.host if request.client else "unknown"
    if not auth_strict_limiter.is_allowed(client_ip):
        raise HTTPException(status_code=429, detail="Too many registration attempts. Please wait.")
    hashed = bcrypt.hashpw(req.password.encode(), bcrypt.gensalt()).decode()
    async with get_conn() as conn:
        existing = await conn.fetchrow(
            "SELECT id FROM users WHERE email = $1 OR username = $2",
            req.email,
            req.username,
        )
        if existing:
            raise HTTPException(status_code=400, detail="Email or username already taken")
        row = await conn.fetchrow(
            """
            INSERT INTO users (username, email, password_hash, bio)
            VALUES ($1, $2, $3, $4)
            RETURNING id, username
            """,
            req.username,
            req.email,
            hashed,
            req.bio,
        )
    token = create_token(str(row["id"]))
    return {
        "token": token,
        "user": {"id": str(row["id"]), "username": row["username"]},
    }

@auth_router.post("/login")
async def login(req: LoginRequest, request: Request):
    client_ip = request.client.host if request.client else "unknown"
    if not auth_rate_limiter.is_allowed(client_ip):
        raise HTTPException(status_code=429, detail="Too many login attempts. Please wait.")
    async with get_conn() as conn:
        row = await conn.fetchrow(
            "SELECT id, username, password_hash FROM users WHERE email = $1",
            req.email,
        )
    if not row:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not bcrypt.checkpw(req.password.encode(), row["password_hash"].encode()):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_token(str(row["id"]))
    return {
        "token": token,
        "user": {"id": str(row["id"]), "username": row["username"]},
    }

@auth_router.get("/me")
async def get_me(user=Depends(require_user)):
    async with get_conn() as conn:
        row = await conn.fetchrow(
            """
            SELECT id, username, email, bio, avatar_url, display_name,
                   link_spotify, link_instagram, link_pinterest, created_at
            FROM users WHERE id = $1
            """,
            user["id"],
        )
    if not row:
        raise HTTPException(status_code=404, detail="User not found")
    result = dict(row)
    result["id"] = str(result["id"])
    return result

@auth_router.put("/profile")
async def update_profile(req: ProfileUpdate, user=Depends(require_user)):
    updates = []
    params = []
    idx = 1
    for field in ("bio", "display_name", "link_spotify", "link_instagram", "link_pinterest"):
        val = getattr(req, field, None)
        if val is not None:
            if field == "bio":
                if len(val) > 160:
                    raise HTTPException(400, "Bio must be 160 characters or fewer")
                if profanity.contains_profanity(val):
                    raise HTTPException(400, "Bio contains inappropriate language")
            if field == "display_name":
                if len(val) > 50:
                    raise HTTPException(400, "Display name must be 50 characters or fewer")
                if val and profanity.contains_profanity(val):
                    raise HTTPException(400, "Display name contains inappropriate language")
            if field == "link_spotify":
                try:
                    _validate_spotify_link(val)
                except ValueError as e:
                    raise HTTPException(400, str(e))
            if field == "link_instagram":
                try:
                    _validate_instagram_link(val)
                except ValueError as e:
                    raise HTTPException(400, str(e))
            if field == "link_pinterest":
                try:
                    _validate_pinterest_link(val)
                except ValueError as e:
                    raise HTTPException(400, str(e))
            updates.append(f"{field} = ${idx}")
            params.append(val)
            idx += 1
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")
    params.append(user["id"])
    query = f"UPDATE users SET {', '.join(updates)}, updated_at = NOW() WHERE id = ${idx}"
    async with get_conn() as conn:
        await conn.execute(query, *params)
    _user_cache.delete(str(user["id"]))
    return {"status": "updated"}

@auth_router.post("/avatar")
async def upload_avatar(file: UploadFile = File(...), user=Depends(require_user)):
    allowed_types = ("image/jpeg", "image/png", "image/webp")
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="Only JPEG, PNG, or WebP images allowed")
    contents = await file.read()
    if len(contents) > 5 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image must be under 5 MB")
    def _detect_image_type(data: bytes) -> str | None:
        if data[:3] == b'\xff\xd8\xff':
            return 'jpeg'
        if len(data) >= 8 and data[:8] == b'\x89PNG\r\n\x1a\n':
            return 'png'
        if len(data) >= 12 and data[:4] == b'RIFF' and data[8:12] == b'WEBP':
            return 'webp'
        return None
    detected = _detect_image_type(contents)
    if detected not in ('jpeg', 'png', 'webp'):
        raise HTTPException(
            status_code=400,
            detail="Invalid image file. Only JPEG, PNG, or WebP are accepted.",
        )
    try:
        result = cloudinary.uploader.upload(
            contents,
            folder="audyn/avatars",
            public_id=str(user["id"]),
            overwrite=True,
            transformation=[{"width": 256, "height": 256, "crop": "fill"}],
        )
    except Exception as e:
        logger.error(f"Cloudinary upload failed: {e}")
        raise HTTPException(status_code=502, detail="Image upload failed")
    url = result["secure_url"]
    async with get_conn() as conn:
        await conn.execute(
            "UPDATE users SET avatar_url = $1, updated_at = NOW() WHERE id = $2",
            url,
            user["id"],
        )
    _user_cache.delete(str(user["id"]))
    return {"avatar_url": url}

@auth_router.post("/guest-session")
async def create_guest_session(request: Request):
    client_ip = request.client.host if request.client else "unknown"
    if not auth_rate_limiter.is_allowed(client_ip):
        raise HTTPException(status_code=429, detail="Too many requests. Please wait.")
    """Create an ephemeral guest user for anonymous play."""
    async with get_conn() as conn:
        row = await conn.fetchrow("""
            INSERT INTO users (username, email, password_hash, is_guest)
            VALUES (
                'guest_' || substr(gen_random_uuid()::text, 1, 8),
                'guest_' || gen_random_uuid()::text || '@guest.local',
                'nologin',
                TRUE
            )
            RETURNING id
        """)
    guest_id = str(row["id"])
    token = create_token(guest_id)
    return {"guest_session_id": guest_id, "token": token}

@auth_router.post("/convert-guest")
async def convert_guest(req: GuestConvertRequest, request: Request):
    """
    Upgrade a guest session to a full account.
    All scores previously recorded under the guest user_id are preserved.
    """
    client_ip = request.client.host if request.client else "unknown"
    if not auth_strict_limiter.is_allowed(client_ip):
        raise HTTPException(status_code=429, detail="Too many requests. Please wait.")

    reg = RegisterRequest(
        username=req.username,
        email=req.email,
        password=req.password,
        bio=req.bio,
    )
    hashed = bcrypt.hashpw(req.password.encode(), bcrypt.gensalt()).decode()

    async with get_conn() as conn:
        async with conn.transaction():
            guest = await conn.fetchrow(
                "SELECT id FROM users WHERE id = $1::uuid AND is_guest = TRUE",
                req.guest_session_id,
            )
            if not guest:
                raise HTTPException(status_code=400, detail="Invalid guest session")

            conflict = await conn.fetchrow(
                "SELECT id FROM users WHERE (email = $1 OR username = $2) AND id != $3::uuid",
                reg.email,
                reg.username,
                req.guest_session_id,
            )
            if conflict:
                raise HTTPException(status_code=400, detail="Email or username already taken")

            await conn.execute(
                """
                UPDATE users SET
                    username = $1, email = $2, password_hash = $3, bio = $4,
                    is_guest = FALSE, updated_at = NOW()
                WHERE id = $5::uuid
                """,
                reg.username,
                reg.email,
                hashed,
                reg.bio,
                req.guest_session_id,
            )

    token = create_token(req.guest_session_id)
    return {
        "token": token,
        "user": {"id": req.guest_session_id, "username": reg.username},
    }

@auth_router.get("/profile/{username}")
async def get_public_profile(username: str, request: Request):
    """Public profile data for a given username. No auth required."""
    client_ip = request.client.host if request.client else "unknown"
    if not auth_rate_limiter.is_allowed(client_ip):
        raise HTTPException(status_code=429, detail="Too many requests. Please wait.")

    if not re.match(r"^[a-zA-Z0-9_]{3,30}$", username):
        raise HTTPException(status_code=400, detail="Invalid username format")

    async with get_conn() as conn:
        user = await conn.fetchrow(
            """
            SELECT id, username, display_name, bio, avatar_url,
                   link_spotify, link_instagram, link_pinterest
            FROM users
            WHERE username = $1 AND is_guest = FALSE
            """,
            username,
        )
        if not user:
            raise HTTPException(status_code=404, detail="User not found")

        user_id = user["id"]

        stats = await conn.fetchrow(
            """
            SELECT
                COALESCE(SUM(final_score), 0)::bigint AS total_score,
                COUNT(id)::int AS tracks_guessed
            FROM scores
            WHERE user_id = $1 AND final_score > 0
            """,
            user_id,
        )

        rank = await conn.fetchval(
            """
            SELECT rank FROM (
                SELECT user_id, ROW_NUMBER() OVER (ORDER BY SUM(final_score) DESC) AS rank
                FROM scores
                JOIN users u ON u.id = scores.user_id
                WHERE u.is_guest = FALSE AND scores.final_score > 0
                GROUP BY user_id
            ) ranked
            WHERE user_id = $1
            """,
            user_id,
        )

        badge_rows = await conn.fetch(
            """
            SELECT a.key, a.emoji, a.label, ua.earned_at
            FROM user_achievements ua
            JOIN achievements a ON a.key = ua.achievement_key
            WHERE ua.user_id = $1
            ORDER BY ua.earned_at DESC
            """,
            user_id,
        )

    return {
        "username": user["username"],
        "display_name": user["display_name"] or "",
        "bio": user["bio"] or "",
        "avatar_url": user["avatar_url"] or "",
        "link_spotify": user["link_spotify"] or "",
        "link_instagram": user["link_instagram"] or "",
        "link_pinterest": user["link_pinterest"] or "",
        "total_score": stats["total_score"],
        "tracks_guessed": stats["tracks_guessed"],
        "global_rank": rank,
        "badges": [
            {
                "key": b["key"],
                "emoji": b["emoji"],
                "label": b["label"],
                "earned_at": b["earned_at"].isoformat() if b["earned_at"] else None,
            }
            for b in badge_rows
        ],
    }
