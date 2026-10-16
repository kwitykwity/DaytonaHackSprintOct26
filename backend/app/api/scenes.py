import logging
from fastapi import APIRouter, HTTPException
from app.models.scene import StoryRequest, SceneResponse
from app.services.scene_service import split_story_into_scenes
from app.observability import record_io

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["scenes"])


@router.post("/scenes", response_model=SceneResponse)
async def create_scenes(request: StoryRequest):
    logger.info(f"POST /api/scenes - Received request with story length: {len(request.story)}")

    story_length = len(request.story.strip())
    if story_length < 50:
        logger.warning("Story too short, returning 400")
        raise HTTPException(status_code=400, detail="Story must be at least 50 characters")
    if story_length > 3000:
        logger.warning("Story too long, returning 400")
        raise HTTPException(status_code=400, detail="Story must be at most 3,000 characters")

    try:
        scenes = await split_story_into_scenes(request.story, content_level=request.content_level)
        record_io(
            request.story,
            f"Blocked: {scenes.block_reason}" if scenes.blocked
            else "\n".join(f"{i + 1}. {s.text}" for i, s in enumerate(scenes.scenes)),
        )
        if scenes.blocked:
            # Not an error: the story was intentionally withheld by the
            # content-safety guardrail. Return 200 with the blocked flag so the
            # frontend can show a friendly notice rather than retrying.
            logger.info("Scene splitting blocked story as unsuitable for children")
        else:
            logger.info(f"Scene splitting successful. Generated {len(scenes.scenes)} scenes")
        return scenes
    except TimeoutError as e:
        logger.error(f"Scene splitting timeout: {e}")
        raise HTTPException(status_code=504, detail=str(e))
    except ValueError as e:
        logger.error(f"Scene splitting configuration error: {e}")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"Scene splitting error: {type(e).__name__}: {e}")
        raise HTTPException(status_code=500, detail="Failed to split story into scenes")
