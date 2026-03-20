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
        min_size=5,  # warm pool: avoids ~100ms cold-connect delays during bursts
        max_size=10,
        command_timeout=30,
    )
    async with _pool.acquire() as conn:
        await conn.fetchval("SELECT 1")
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
