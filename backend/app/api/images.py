import logging
from fastapi import APIRouter, HTTPException
from app.models.image import ImageRequest, ImageResponse
from app.services.image_service import generate_image
from app.observability import record_io

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["images"])


@router.post("/images", response_model=ImageResponse)
async def create_image(request: ImageRequest):
    logger.info(f"POST /api/images - Received request with prompt length: {len(request.prompt)}")

    if len(request.prompt.strip()) < 10:
        logger.warning("Prompt too short, returning 400")
        raise HTTPException(status_code=400, detail="Prompt must be at least 10 characters")

    try:
        image_url = await generate_image(request.prompt)
        record_io(request.prompt, f"Illustration generated ({len(image_url) * 3 // 4 // 1024} KB)")
        logger.info("Image generation successful")
        return ImageResponse(image_url=image_url)
    except TimeoutError as e:
        logger.error(f"Image generation timeout: {e}")
        raise HTTPException(status_code=504, detail=str(e))
    except ValueError as e:
        logger.error(f"Image generation configuration error: {e}")
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.error(f"Image generation error: {type(e).__name__}: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate image")
