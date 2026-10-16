import os
import logging
from pathlib import Path
from dotenv import load_dotenv

env_path_candidates = [
    Path(__file__).resolve().parents[2] / ".env",  # workspace root
    Path(__file__).resolve().parents[1] / ".env",  # backend directory
]
for env_path in env_path_candidates:
    if env_path.exists():
        load_dotenv(dotenv_path=env_path, override=False)

# Vercel and other hosted runtimes inject env vars directly; support both that
# and local .env files so the same code works in development and deployment.
for key in ["API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "ELEVENLABS_API_KEY", "CORS_ORIGINS"]:
    if os.getenv(key):
        os.environ.setdefault(key, os.getenv(key))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)

from app.observability import label_request_span, setup_tracing

# Before the routers import their services, so every LLM client is traced.
setup_tracing()

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.scenes import router as scenes_router
from app.services.ai_status import get_ai_status
from app.api.images import router as images_router
from app.api.audio import router as audio_router
from app.api.owl import router as owl_router
from app.api.demo import router as demo_router
from app.api.subscribe import router as subscribe_router
from app.api.stats import router as stats_router
from app.routers.readers import router as readers_router

app = FastAPI(
    title="NarrateMe API",
    description="API for turning stories into narrated, illustrated presentations",
    version="0.1.0",
)

# Allowed frontend origins, comma-separated in CORS_ORIGINS (e.g. the Vercel URL in
# prod). Falls back to the local dev frontends so local setups need no extra config.
def get_cors_origins() -> list[str]:
    configured_origins = [
        o.strip()
        for o in os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
        if o.strip()
    ]
    fallback_origins = ["http://localhost:3000", "http://127.0.0.1:3000"]
    return list(dict.fromkeys(configured_origins + fallback_origins))


cors_origins = get_cors_origins()

# Labels each request's trace in Arize (a no-op when tracing is off).
app.middleware("http")(label_request_span)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(scenes_router)
app.include_router(images_router)
app.include_router(audio_router)
app.include_router(owl_router)
app.include_router(demo_router)
app.include_router(subscribe_router)
app.include_router(stats_router)
app.include_router(readers_router)


@app.get("/health")
async def health_check():
    return {"status": "healthy", "ai_services": get_ai_status()}
