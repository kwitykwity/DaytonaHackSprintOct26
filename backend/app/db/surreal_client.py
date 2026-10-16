"""
SurrealDB client for NarrateMe
Manages connection and basic operations for reader memory feature
"""
import os
from typing import Optional
from surrealdb import AsyncSurreal
from datetime import datetime
from contextlib import asynccontextmanager

# Global database connection
_db: Optional[AsyncSurreal] = None


async def init_db() -> AsyncSurreal:
    """
    Initialize connection to SurrealDB

    Returns:
        AsyncSurreal: Connected database instance
    """
    global _db

    if _db is not None:
        return _db

    # Get config from environment
    url = os.getenv("SURREAL_URL", "ws://127.0.0.1:8000/rpc")
    user = os.getenv("SURREAL_USER", "root")
    password = os.getenv("SURREAL_PASS", "root")
    namespace = os.getenv("SURREAL_NS", "narrateme")
    database = os.getenv("SURREAL_DB", "production")

    # Create connection
    db = AsyncSurreal(url)

    # Sign in
    await db.signin({"user": user, "pass": password})

    # Use namespace and database
    await db.use(namespace, database)

    _db = db
    print(f"[OK] Connected to SurrealDB: {namespace}/{database}")

    return _db


async def get_db() -> AsyncSurreal:
    """
    Get existing database connection or create new one

    Returns:
        AsyncSurreal: Database instance
    """
    if _db is None:
        return await init_db()
    return _db


async def close_db():
    """Close database connection"""
    global _db
    if _db is not None:
        _db = None
        print("[OK] SurrealDB connection closed")


# Reader operations
async def create_or_update_reader(
    name: str,
    story_snippet: Optional[str] = None,
    practice_word: Optional[str] = None
) -> dict:
    """
    Create a new reader or update existing one with session data

    Args:
        name: Reader's name (used as unique identifier)
        story_snippet: First 50 chars of story (optional)
        practice_word: Word from comprehension check (optional)

    Returns:
        dict: Reader record with previous session data
    """
    db = await get_db()

    # Query for existing reader by name
    query = """
        SELECT * FROM readers WHERE name = $name LIMIT 1
    """
    result = await db.query(query, {"name": name})

    existing_reader = None
    if result and len(result) > 0:
        existing_reader = result[0]

    now = datetime.utcnow().isoformat() + "Z"

    if existing_reader:
        # Returning reader - get previous session data
        previous_session = {
            "last_story": existing_reader.get("last_story"),
            "last_word": existing_reader.get("last_word"),
            "last_seen": existing_reader.get("last_seen")
        }

        # Update with new session data if provided
        update_data = {
            "last_seen": now
        }
        if story_snippet:
            update_data["last_story"] = story_snippet[:50]
        if practice_word:
            update_data["last_word"] = practice_word

        # Update the record
        reader_id = existing_reader["id"]
        updated = await db.update(reader_id, update_data)

        return {
            "reader_id": str(reader_id),
            "name": name,
            "is_returning": True,
            "previous_session": previous_session
        }

    else:
        # New reader - create record
        reader_data = {
            "name": name,
            "last_story": story_snippet[:50] if story_snippet else None,
            "last_word": practice_word,
            "last_seen": now,
            "created_at": now
        }

        created = await db.create("readers", reader_data)

        # Extract the ID from the created record
        reader_id = created[0]["id"] if isinstance(created, list) else created["id"]

        return {
            "reader_id": str(reader_id),
            "name": name,
            "is_returning": False,
            "previous_session": None
        }


async def get_reader_by_name(name: str) -> Optional[dict]:
    """
    Get reader record by name

    Args:
        name: Reader's name

    Returns:
        dict or None: Reader record if found
    """
    db = await get_db()

    query = """
        SELECT * FROM readers WHERE name = $name LIMIT 1
    """
    result = await db.query(query, {"name": name})

    if result and len(result) > 0:
        return result[0]

    return None


async def health_check() -> bool:
    """
    Check if database connection is healthy

    Returns:
        bool: True if connected and operational
    """
    try:
        db = await get_db()
        # Simple query to test connection
        await db.query("SELECT * FROM readers LIMIT 1")
        return True
    except Exception as e:
        print(f"[ERROR] SurrealDB health check failed: {e}")
        return False
