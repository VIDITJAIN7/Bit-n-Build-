import os
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field

from .repository import SQLiteRepository
from .service import DomainError, OperationsService


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Decision(StrictModel):
    decision: Literal["approve", "reject"]
    actor: Literal["supervisor", "backup", "replacement-supervisor"]
    readback: str = Field(default="", max_length=100)


class ComplianceChecklist(StrictModel):
    asset_matched: bool
    work_area_checked: bool
    protective_equipment_checked: bool


class Attachment(StrictModel):
    kind: Literal["photo", "audio"]
    name: str = Field(min_length=1, max_length=200)
    data_url: str = Field(
        max_length=4000000,
        pattern=r"^data:(image/(jpeg|png|webp)|audio/(webm|ogg|mp4|mpeg|wav))(;codecs=[^;,]+)?;base64,[A-Za-z0-9+/=]+$",
    )
    demo_fixture: bool = False


class Report(StrictModel):
    id: str = Field(min_length=8, max_length=100)
    action_id: str = Field(min_length=1, max_length=100)
    fault: bool
    note: str = Field(default="", max_length=1000)
    created_at: str = Field(min_length=10, max_length=50)
    asset_id: str = Field(min_length=1, max_length=40)
    checklist: ComplianceChecklist
    attachments: list[Attachment] = Field(min_length=1, max_length=2)


class ClockAdvance(StrictModel):
    hours: Literal[4, 168]


class DrillOperation(StrictModel):
    operation: Literal["enable", "disable", "inject"]


class WeatherScenario(StrictModel):
    hot: bool


class RecoveryOperation(StrictModel):
    operation: Literal["start", "approve", "advance", "finalize", "cancel"]
    actor: (
        Literal["supervisor", "replacement-supervisor", "guardian-1", "guardian-2", "guardian-3"]
        | None
    ) = None


def create_app(database_path=None):
    for name, allowed in (("AVERLOCK_AGENT", "local"), ("AVERLOCK_WALLET", "simulated")):
        if os.getenv(name, allowed) != allowed:
            raise RuntimeError(f"{name}: external adapters are not configured. Use {allowed}.")
    app = FastAPI(
        title="Averlock local operations API",
        version="0.1.0",
        description="Local demo roles are simulated, not authentication. Bind to loopback only.",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:4173",
            "http://127.0.0.1:4173",
        ],
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )
    db = database_path or os.getenv(
        "AVERLOCK_DATABASE", str(Path(__file__).parents[1] / "data" / "averlock.db")
    )
    service = OperationsService(SQLiteRepository(str(db)))
    app.state.service = service

    def command(fn):
        try:
            _, message = fn()
            return {"state": service.snapshot(), "message": message}
        except (DomainError, ValueError) as error:
            raise HTTPException(status_code=409, detail=str(error)) from error

    @app.get("/api/health")
    def health():
        return {"status": "ok", "mode": "local", "agent": "deterministic", "wallet": "simulated"}

    @app.get("/api/state")
    def state():
        return service.snapshot()

    @app.post("/api/scenario/run")
    def run():
        return command(service.run)

    @app.post("/api/actions/{action_id}/decision")
    def decide(action_id: str, body: Decision):
        return command(lambda: service.decide(action_id, body.decision, body.actor, body.readback))

    @app.post("/api/actions/{action_id}/verification")
    def verify(action_id: str):
        return command(lambda: service.request_verification(action_id))

    @app.post("/api/reports")
    def report(body: Report):
        return command(lambda: service.submit_report(body.model_dump()))

    @app.post("/api/recovery")
    def recovery(body: RecoveryOperation):
        return command(lambda: service.recover(body.operation, body.actor))

    @app.post("/api/demo/reset")
    def reset():
        return command(service.reset)

    @app.post("/api/demo/clock")
    def advance(body: ClockAdvance):
        return command(lambda: service.advance(body.hours))

    @app.post("/api/drills")
    def drills(body: DrillOperation):
        return command(lambda: service.drills(body.operation))

    @app.post("/api/weather/scenario")
    def weather(body: WeatherScenario):
        return command(lambda: service.set_weather(body.hot))

    @app.get("/api/audit/export")
    def audit():
        return service.snapshot()["audit"]

    return app


app = create_app()
