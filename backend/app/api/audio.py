import logging
from fastapi import APIRouter, HTTPException
from elevenlabs.core.api_error import ApiError
from app.models.audio import AudioRequest, AudioResponse
from app.services.audio_service import generate_narration
from app.observability import record_io

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["audio"])


@router.post("/audio", response_model=AudioResponse)
async def create_audio(request: AudioRequest):
    logger.info(f"POST /api/audio - Received request with text length: {len(request.text)}, voice_id: {request.voice_id}")

    if len(request.text.strip()) < 1:
        logger.warning("Text empty, returning 400")
        raise HTTPException(status_code=400, detail="Text must not be empty")

    try:
        audio_url, word_timings = await generate_narration(
            request.text, voice_id=request.voice_id
        )
        logger.info("Narration generation successful")
        record_io(request.text, f"Narration with {len(word_timings or [])} timed words")
        return AudioResponse(audio_url=audio_url, word_timings=word_timings)
    except TimeoutError as e:
        logger.error(f"Narration generation timeout: {e}")
        raise HTTPException(status_code=504, detail=str(e))
    except ValueError as e:
        logger.error(f"Narration generation configuration error: {e}")
        raise HTTPException(status_code=503, detail=str(e))
    except ApiError as e:
        if e.status_code == 429:
            logger.warning("Narration rate-limited by ElevenLabs (429), returning 429")
            raise HTTPException(status_code=429, detail="Narration service busy, please retry")
        logger.error(f"Narration generation error: ApiError status={e.status_code}: {e.body}")
        raise HTTPException(status_code=500, detail="Failed to generate narration")
    except Exception as e:
        logger.error(f"Narration generation error: {type(e).__name__}: {e}")
        raise HTTPException(status_code=500, detail="Failed to generate narration")
