"""
Simple HTTP-based SurrealDB client
Bypasses WebSocket auth issues by using HTTP/REST API
"""
import os
import httpx
from typing import Optional
from datetime import datetime

SURREAL_URL = os.getenv("SURREAL_URL", "http://127.0.0.1:8002")
SURREAL_USER = os.getenv("SURREAL_USER", "root")
SURREAL_PASS = os.getenv("SURREAL_PASS", "root")
SURREAL_NS = os.getenv("SURREAL_NS", "narrateme")
SURREAL_DB = os.getenv("SURREAL_DB", "production")


async def query(sql: str, variables: Optional[dict] = None) -> list:
    """Execute a SurrealQL query via HTTP"""
    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{SURREAL_URL}/sql",
            auth=(SURREAL_USER, SURREAL_PASS),
            headers={
                "Accept": "application/json",
                "surreal-ns": SURREAL_NS,
                "surreal-db": SURREAL_DB,
            },
            content=sql,
            timeout=10.0,
        )
        response.raise_for_status()
        return response.json()


async def health_check() -> bool:
    """Check if SurrealDB is accessible"""
    try:
        result = await query("SELECT * FROM readers LIMIT 1;")
        return True
    except Exception as e:
        print(f"[ERROR] SurrealDB health check failed: {e}")
        return False


async def create_or_update_reader(
    name: str,
    story_snippet: Optional[str] = None,
    practice_word: Optional[str] = None
) -> dict:
    """Create or update a reader session"""
    # Clean inputs for SQL
    clean_name = name.replace("'", "\\'")
    clean_story = story_snippet[:50].replace("'", "\\'") if story_snippet else ""
    clean_word = practice_word.replace("'", "\\'") if practice_word else ""

    # Query for existing reader
    select_sql = f"SELECT * FROM readers WHERE name = '{clean_name}';"
    result = await query(select_sql)

    existing_reader = None
    if result and len(result) > 0:
        result_data = result[0].get("result", [])
        if result_data and isinstance(result_data, list) and len(result_data) > 0:
            existing_reader = result_data[0]

    now = datetime.utcnow().isoformat() + "Z"

    if existing_reader:
        # Returning reader
        previous_session = {
            "last_story": existing_reader.get("last_story"),
            "last_word": existing_reader.get("last_word"),
            "last_seen": existing_reader.get("last_seen")
        }

        # Update with new session
        reader_id = existing_reader["id"]
        update_sql = f"""
            UPDATE {reader_id} SET
                last_seen = '{now}'
                {f", last_story = '{clean_story}'" if story_snippet else ""}
                {f", last_word = '{clean_word}'" if practice_word else ""};
        """
        await query(update_sql)

        return {
            "reader_id": reader_id,
            "name": name,
            "is_returning": True,
            "previous_session": previous_session
        }
    else:
        # New reader
        create_sql = f"""
            CREATE readers CONTENT {{
                name: '{clean_name}',
                last_story: '{clean_story}',
                last_word: '{clean_word}',
                created_at: '{now}',
                last_seen: '{now}'
            }};
        """
        result = await query(create_sql)

        reader_id = "readers:unknown"
        if result and len(result) > 0:
            result_data = result[0].get("result", [])
            if result_data and isinstance(result_data, list) and len(result_data) > 0:
                reader_id = result_data[0].get("id", "readers:unknown")

        return {
            "reader_id": str(reader_id),
            "name": name,
            "is_returning": False,
            "previous_session": None
        }


async def init_db():
    """Initialize namespace and database"""
    try:
        # Create namespace and database if they don't exist
        await query(f"DEFINE NAMESPACE {SURREAL_NS};")
        await query(f"USE NS {SURREAL_NS}; DEFINE DATABASE {SURREAL_DB};")
        print(f"[OK] SurrealDB initialized: {SURREAL_NS}/{SURREAL_DB}")
    except Exception as e:
        print(f"[INFO] Namespace/DB may already exist: {e}")
    return True


async def get_db():
    """Get DB - no-op for HTTP client"""
    return True
