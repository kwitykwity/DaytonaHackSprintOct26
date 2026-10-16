"""
Arize AX tracing for NarrateMe.

Sends a trace of every Claude (scene splitting) and OpenAI (illustration) call
to Arize, plus a Memory Owl span per reader session. Off unless ARIZE_SPACE_ID
and ARIZE_API_KEY are set, so local setups without Arize keep working.
"""
import logging
import os
from contextlib import contextmanager

logger = logging.getLogger(__name__)

_tracer = None


def setup_tracing() -> bool:
    """Register Arize and instrument the LLM SDKs. Returns True when tracing is on."""
    global _tracer

    space_id = os.getenv("ARIZE_SPACE_ID")
    api_key = os.getenv("ARIZE_API_KEY")
    if not space_id or not api_key:
        logger.info("Arize tracing off: ARIZE_SPACE_ID / ARIZE_API_KEY not set")
        return False

    try:
        from arize.otel import register
        from openinference.instrumentation.anthropic import AnthropicInstrumentor
        from openinference.instrumentation.openai import OpenAIInstrumentor

        tracer_provider = register(
            space_id=space_id,
            api_key=api_key,
            project_name=os.getenv("ARIZE_PROJECT_NAME", "narrateme"),
        )
        AnthropicInstrumentor().instrument(tracer_provider=tracer_provider)
        OpenAIInstrumentor().instrument(tracer_provider=tracer_provider)
        _tracer = tracer_provider.get_tracer("narrateme.memory_owl")
    except Exception:
        # Tracing must never take the API down with it.
        logger.exception("Arize tracing setup failed; continuing without it")
        return False

    logger.info("Arize tracing on")
    return True


@contextmanager
def memory_span(name: str, **attributes):
    """Span around a Memory Owl step. A no-op when tracing is off."""
    if _tracer is None:
        yield None
        return
    with _tracer.start_as_current_span(name) as span:
        span.set_attribute("openinference.span.kind", "CHAIN")
        for key, value in attributes.items():
            if value is not None:
                span.set_attribute(key, value)
        yield span
