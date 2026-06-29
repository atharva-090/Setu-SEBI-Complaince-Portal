from fastapi import FastAPI

from .config import settings

app = FastAPI(title="Setu AI Service", version="0.1.0")


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "setu-ai-service",
        "llm_provider": settings.llm_provider,
        "llm_configured": bool(settings.llm_api_key),
    }
