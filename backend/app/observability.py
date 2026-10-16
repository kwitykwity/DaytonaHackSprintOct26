"""
Arize AX tracing for NarrateMe.

Sends a trace of every Claude (scene splitting) and OpenAI (illustration) call
to Arize, plus a Memory Owl span per reader session. Off unless ARIZE_SPACE_ID
and ARIZE_API_KEY are set, so local setups without Arize keep working.
"""
import logging
import os
from contextlib import contextmanager
from contextvars import ContextVar

from opentelemetry import trace

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


# The request's top-level span (FastAPI's own "POST /api/..." span), so an
# endpoint can label it with a readable input and output for the trace list.
_request_span: ContextVar = ContextVar("request_span", default=None)


async def label_request_span(request, call_next):
    """HTTP middleware: mark each request's root span as a CHAIN step."""
    span = trace.get_current_span()
    if _tracer is not None and span.is_recording():
        span.set_attribute("openinference.span.kind", "CHAIN")
        span.set_attribute("input.value", f"{request.method} {request.url.path}")
        _request_span.set(span)
    return await call_next(request)


def record_io(input_value=None, output_value=None):
    """Set the Input / Output Arize shows for the current request."""
    span = _request_span.get()
    if span is None or not span.is_recording():
        return
    if input_value is not None:
        span.set_attribute("input.value", str(input_value)[:4000])
    if output_value is not None:
        span.set_attribute("output.value", str(output_value)[:4000])


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
