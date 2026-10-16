"""
Arize AI Observability Integration for NarrateMe

This module provides monitoring and observability for all AI services:
- Anthropic Claude (scene splitting)
- OpenAI (image generation)
- ElevenLabs (text-to-speech narration)

Tracks:
- Latency and performance metrics
- Token usage and costs
- Success/failure rates
- Content safety filtering
- Model inputs/outputs for debugging
"""

import os
import time
import logging
from typing import Any, Dict, Optional
from datetime import datetime
from functools import wraps

logger = logging.getLogger(__name__)

# Check if Arize is configured
ARIZE_ENABLED = bool(os.getenv("ARIZE_API_KEY") and os.getenv("ARIZE_SPACE_KEY"))

if ARIZE_ENABLED:
    try:
        from arize.pandas.logger import Client as ArizeClient
        from arize.utils.types import ModelTypes, Environments

        arize_client = ArizeClient(
            api_key=os.getenv("ARIZE_API_KEY"),
            space_key=os.getenv("ARIZE_SPACE_KEY")
        )
        logger.info("Arize AI monitoring enabled")
    except ImportError:
        logger.warning("Arize SDK not installed. Install with: pip install arize")
        ARIZE_ENABLED = False
        arize_client = None
else:
    logger.info("Arize AI monitoring disabled (no API keys found)")
    arize_client = None


class AIMetrics:
    """Container for AI operation metrics"""
    def __init__(self, service: str, operation: str):
        self.service = service
        self.operation = operation
        self.start_time = time.time()
        self.end_time = None
        self.latency_ms = None
        self.success = False
        self.error_message = None
        self.input_data = {}
        self.output_data = {}
        self.metadata = {}

    def complete(self, success: bool = True, error: Optional[str] = None):
        """Mark the operation as complete"""
        self.end_time = time.time()
        self.latency_ms = (self.end_time - self.start_time) * 1000
        self.success = success
        self.error_message = error

    def to_dict(self) -> Dict[str, Any]:
        """Convert metrics to dictionary for logging"""
        return {
            "service": self.service,
            "operation": self.operation,
            "latency_ms": self.latency_ms,
            "success": self.success,
            "error": self.error_message,
            "timestamp": datetime.fromtimestamp(self.start_time).isoformat(),
            "input": self.input_data,
            "output": self.output_data,
            "metadata": self.metadata
        }


def track_ai_operation(service: str, operation: str):
    """
    Decorator to track AI service operations with Arize

    Usage:
        @track_ai_operation("anthropic", "scene_splitting")
        async def split_story_into_scenes(story: str):
            ...
    """
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            metrics = AIMetrics(service, operation)

            # Capture input (be careful with PII)
            metrics.input_data = {
                "args_count": len(args),
                "kwargs_keys": list(kwargs.keys())
            }

            try:
                # Execute the actual function
                result = await func(*args, **kwargs)

                # Mark as successful
                metrics.complete(success=True)

                # Capture output metadata (not full content to avoid storage costs)
                if hasattr(result, '__dict__'):
                    metrics.output_data = {
                        "type": type(result).__name__,
                        "fields": list(vars(result).keys())
                    }

                # Log to Arize if enabled
                if ARIZE_ENABLED:
                    log_to_arize(metrics)

                # Always log locally
                logger.info(f"AI Operation: {service}.{operation} - {metrics.latency_ms:.0f}ms - Success")

                return result

            except Exception as e:
                # Mark as failed
                metrics.complete(success=False, error=str(e))

                # Log to Arize if enabled
                if ARIZE_ENABLED:
                    log_to_arize(metrics)

                # Log locally
                logger.error(f"AI Operation: {service}.{operation} - {metrics.latency_ms:.0f}ms - Failed: {e}")

                # Re-raise the exception
                raise

        return wrapper
    return decorator


def log_to_arize(metrics: AIMetrics):
    """Send metrics to Arize for monitoring"""
    if not ARIZE_ENABLED or not arize_client:
        return

    try:
        # Create a prediction record for Arize
        import pandas as pd

        data = {
            "prediction_id": [f"{metrics.service}_{int(metrics.start_time * 1000)}"],
            "prediction_timestamp": [datetime.fromtimestamp(metrics.start_time)],
            "model_version": ["v1.0"],
            "latency_ms": [metrics.latency_ms],
            "success": [1 if metrics.success else 0],
            "service": [metrics.service],
            "operation": [metrics.operation],
        }

        # Add error information if failed
        if not metrics.success:
            data["error_type"] = [type(metrics.error_message).__name__]
            data["error_message"] = [str(metrics.error_message)[:200]]  # Truncate

        # Add custom metadata
        for key, value in metrics.metadata.items():
            if isinstance(value, (int, float, str, bool)):
                data[key] = [value]

        df = pd.DataFrame(data)

        # Log to Arize
        response = arize_client.log(
            dataframe=df,
            model_id=f"narrateme_{metrics.service}",
            model_type=ModelTypes.GENERATIVE_LLM,
            environment=Environments.PRODUCTION,
        )

        if response.status_code != 200:
            logger.warning(f"Failed to log to Arize: {response.text}")

    except Exception as e:
        logger.warning(f"Error logging to Arize: {e}")


def log_scene_generation(
    story_length: int,
    num_scenes: int,
    latency_ms: float,
    blocked: bool = False,
    content_level: str = "moderate"
):
    """Log scene generation metrics to Arize"""
    if not ARIZE_ENABLED:
        return

    metrics = AIMetrics("anthropic", "scene_generation")
    metrics.latency_ms = latency_ms
    metrics.success = True
    metrics.metadata = {
        "story_length": story_length,
        "num_scenes": num_scenes,
        "blocked": blocked,
        "content_level": content_level
    }

    log_to_arize(metrics)


def log_image_generation(
    scene_number: int,
    prompt_length: int,
    latency_ms: float,
    success: bool,
    error: Optional[str] = None
):
    """Log image generation metrics to Arize"""
    if not ARIZE_ENABLED:
        return

    metrics = AIMetrics("openai", "image_generation")
    metrics.latency_ms = latency_ms
    metrics.success = success
    metrics.error_message = error
    metrics.metadata = {
        "scene_number": scene_number,
        "prompt_length": prompt_length
    }

    log_to_arize(metrics)


def log_narration_generation(
    scene_number: int,
    text_length: int,
    latency_ms: float,
    audio_duration_ms: Optional[int] = None,
    success: bool = True,
    error: Optional[str] = None
):
    """Log narration generation metrics to Arize"""
    if not ARIZE_ENABLED:
        return

    metrics = AIMetrics("elevenlabs", "narration_generation")
    metrics.latency_ms = latency_ms
    metrics.success = success
    metrics.error_message = error
    metrics.metadata = {
        "scene_number": scene_number,
        "text_length": text_length,
        "audio_duration_ms": audio_duration_ms
    }

    log_to_arize(metrics)


# Export utility function for checking if monitoring is enabled
def is_monitoring_enabled() -> bool:
    """Check if Arize monitoring is enabled"""
    return ARIZE_ENABLED
