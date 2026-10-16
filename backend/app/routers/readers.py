"""
Reader API endpoints for Memory Owl feature
Tracks reading sessions and personalizes experience
"""
from fastapi import APIRouter, HTTPException
from app.models.reader import ReaderSessionRequest, ReaderSessionResponse, PreviousSession
from app.db.surreal_client import create_or_update_reader, health_check

router = APIRouter(prefix="/api", tags=["readers"])


@router.post("/reader/session", response_model=ReaderSessionResponse)
async def track_reader_session(request: ReaderSessionRequest):
    """
    Create or update a reader session

    - **name**: Reader's name (2-50 characters)
    - **story_snippet**: Optional snippet from story (first 50 chars)
    - **practice_word**: Optional word from comprehension check

    Returns reader data including previous session if returning user
    """
    try:
        # Check if database is available
        if not await health_check():
            raise HTTPException(
                status_code=503,
                detail="SurrealDB is not available. Please check database connection."
            )

        # Create or update reader
        result = await create_or_update_reader(
            name=request.name,
            story_snippet=request.story_snippet,
            practice_word=request.practice_word
        )

        # Convert to response model
        response = ReaderSessionResponse(
            reader_id=result["reader_id"],
            name=result["name"],
            is_returning=result["is_returning"],
            previous_session=(
                PreviousSession(**result["previous_session"])
                if result["previous_session"]
                else None
            )
        )

        return response

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to track reader session: {str(e)}"
        )


@router.get("/reader/health")
async def check_reader_db_health():
    """
    Health check endpoint for reader database

    Returns the health status of SurrealDB connection
    """
    try:
        is_healthy = await health_check()
        return {
            "status": "healthy" if is_healthy else "unhealthy",
            "database": "SurrealDB",
            "connected": is_healthy
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "database": "SurrealDB",
            "connected": False,
            "error": str(e)
        }
