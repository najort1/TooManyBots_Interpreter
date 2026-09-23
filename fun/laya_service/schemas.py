"""Pydantic schemas for the Laya Decision Service."""
from typing import Any, Dict, List, Optional, Union
from pydantic import BaseModel, Field

class PredictRequest(BaseModel):
    task: Optional[str] = Field(default="general", description="Target task name")
    state: Union[str, Dict[str, Any], List[Any]] = Field(
        ..., description="Input text or structured state to evaluate"
    )
    questions: Dict[str, Any] = Field(
        ..., description="Typed question definitions (choice, score, noul)"
    )
    options: Optional[Dict[str, Any]] = Field(
        default=None, description="Inference options (e.g. thresholds, timeouts)"
    )

class PredictResponse(BaseModel):
    status: str = "ok"
    task: Optional[str] = None
    model: str
    answers: Dict[str, Any]
    usage: Optional[Dict[str, Any]] = None
    latency_ms: float

class HealthResponse(BaseModel):
    status: str
    service: str = "laya-decision-service"
    model: str
    model_loaded: bool
    device: str
    uptime_ms: float
