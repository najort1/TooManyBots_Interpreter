"""FastAPI Application for Laya Decision Service."""
import time
import logging
from contextlib import asynccontextmanager
from typing import Optional

import torch
from fastapi import FastAPI, HTTPException, status
from fastapi.responses import JSONResponse

import laya_mlx as laya
from .schemas import HealthResponse, PredictRequest, PredictResponse

logger = logging.getLogger("laya_service")
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

_agent = None
_start_time = time.time()
_model_name = "aac6fef/laya-mlx"

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _agent, _start_time
    _start_time = time.time()
    logger.info(f"Loading Laya decision model {_model_name}...")
    try:
        _agent = laya.load(_model_name)
        logger.info(f"Model {_model_name} loaded successfully and ready for inference.")
    except Exception as exc:
        logger.error(f"Failed to load model {_model_name}: {exc}", exc_info=True)
        _agent = None
    yield
    _agent = None
    logger.info("Laya decision service shutdown complete.")

app = FastAPI(
    title="Laya Decision Service",
    description="Local fast typed-decision runtime for TooManyBots",
    version="0.1.0",
    lifespan=lifespan,
)

@app.get("/health", response_model=HealthResponse)
async def health():
    uptime_ms = round((time.time() - _start_time) * 1000, 2)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    return HealthResponse(
        status="ok" if _agent is not None else "degraded",
        model=_model_name,
        model_loaded=_agent is not None,
        device=device,
        uptime_ms=uptime_ms,
    )

@app.get("/ready")
async def ready():
    if _agent is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Model is not loaded or initializing",
        )
    return {"status": "ready", "model": _model_name}

@app.post("/predict", response_model=PredictResponse)
async def predict(req: PredictRequest):
    if _agent is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Model is not ready",
        )

    t0 = time.perf_counter()
    try:
        with torch.inference_mode():
            raw_result = _agent.predict(req.state, req.questions)
    except Exception as exc:
        logger.error(f"Inference error on task {req.task}: {exc}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Inference error: {str(exc)}",
        )

    elapsed_ms = round((time.perf_counter() - t0) * 1000, 2)

    return PredictResponse(
        status="ok",
        task=req.task,
        model=_model_name,
        answers=raw_result.get("answers", {}),
        usage=raw_result.get("usage"),
        latency_ms=elapsed_ms,
    )
