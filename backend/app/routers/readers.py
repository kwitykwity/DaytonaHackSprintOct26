"""
Reader API endpoints for Memory Owl feature
Tracks reading sessions and personalizes experience
"""
from fastapi import APIRouter, HTTPException
from app.models.reader import ReaderSessionRequest, ReaderSessionResponse, PreviousSession
from app.db.surreal_http_client import create_or_update_reader, health_check
from app.observability import memory_span, record_io

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

        # Create or update reader, traced in Arize so each memory lookup and
        # save shows up next to the story's LLM calls
        with memory_span(
            "memory_owl.reader_session",
            **{
                "input.value": request.name,
                "memory.story_saved": bool(request.story_snippet),
                "memory.practice_word": request.practice_word,
            },
        ) as span:
            result = await create_or_update_reader(
                name=request.name,
                story_snippet=request.story_snippet,
                practice_word=request.practice_word
            )
            previous = result["previous_session"] or {}
            if span is not None:
                span.set_attribute("memory.is_returning", result["is_returning"])
                span.set_attribute("memory.reader_id", result["reader_id"])
                span.set_attribute("output.value", str(previous))
            record_io(
                f"Reader: {request.name}",
                (f"Returning reader. Remembered: {previous}" if result["is_returning"]
                 else "New reader created"),
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
