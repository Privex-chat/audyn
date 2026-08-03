import asyncpg
import os
import logging
from contextlib import asynccontextmanager

logger = logging.getLogger(__name__)

_pool: asyncpg.Pool | None = None

async def init_db():
    """Create the connection pool. Call once at startup."""
    global _pool
    dsn = os.environ.get('DATABASE_URL')
    if not dsn:
        raise RuntimeError("DATABASE_URL environment variable is required")
    _pool = await asyncpg.create_pool(
        dsn,
        # kept low: this app runs as 3 separate processes (2 API + worker),
        # each opening min_size connections at boot — a high value here means
        # a burst of simultaneous new-connection handshakes at startup, which
        # has tripped Supabase pooler's auth circuit breaker before.
        min_size=2,
        max_size=10,
        command_timeout=30,
    )
    async with _pool.acquire() as conn:
        await conn.fetchval("SELECT 1")
        # Lightweight self-migration (idempotent) so rolling deploys don't
        # depend on someone remembering to re-run schema.sql.
        # Only a missing table is ignorable (fresh DB — schema.sql creates the
        # column); permission/SQL errors must fail startup loudly, because a
        # silently skipped migration would break every playlist save afterwards.
        try:
            await conn.execute(
                "ALTER TABLE playlists ADD COLUMN IF NOT EXISTS "
                "fetch_complete BOOLEAN DEFAULT TRUE"
            )
            await conn.execute(
                "ALTER TABLE playlists ALTER COLUMN fetch_complete SET DEFAULT FALSE"
            )
            repaired = await conn.execute(
                """
                UPDATE playlists
                SET fetch_complete = FALSE,
                    fetched_at = LEAST(
                        fetched_at,
                        NOW() - INTERVAL '6 hours' - INTERVAL '1 second'
                    )
                WHERE fetch_complete = TRUE
                  AND total_in_playlist BETWEEN 90 AND 100
                  AND fetched_at >= NOW() - INTERVAL '14 days'
                """
            )
            logger.info(f"Playlist cache repair complete: {repaired}")
        except asyncpg.exceptions.UndefinedTableError:
            logger.info(
                "Self-migration skipped: playlists table not created yet "
                "(run schema.sql for a fresh install)"
            )
    logger.info("PostgreSQL connection pool created")

async def close_db():
    """Gracefully close the pool. Call at shutdown."""
    global _pool
    if _pool:
        await _pool.close()
        _pool = None
        logger.info("PostgreSQL connection pool closed")

def get_pool() -> asyncpg.Pool:
    """Get the active pool. Raises if not initialized."""
    if not _pool:
        raise RuntimeError("Database pool not initialized. Call init_db() first.")
    return _pool

@asynccontextmanager
async def get_conn():
    """Async context manager for a single connection from the pool."""
    async with get_pool().acquire() as conn:
        yield conn
