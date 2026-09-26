import asyncio
import base64
import logging
import os
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import Annotated, Literal

from fastapi import FastAPI, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from .repository import SQLiteRepository
from .service import DomainError, OperationsService

logger = logging.getLogger("averlock.agent")

Code = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9][A-Za-z0-9-]{0,23}$")]
Key = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,31}$")]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=60)]
Label = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=40)]
Short = Annotated[str, StringConstraints(max_length=60)]
Recipient = Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9-]{1,39}$")]
Metric = bool | int | float | Short
Units = Annotated[int, Field(ge=0, le=1_000_000)]
Cents = Annotated[int, Field(ge=1, le=10_000_000)]


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
    task_id: str = Field(min_length=1, max_length=100)
    answer: bool
    note: str = Field(default="", max_length=1000)
    created_at: str = Field(min_length=10, max_length=50)
    asset_code: str = Field(min_length=1, max_length=40)
    checklist: ComplianceChecklist
    attachments: list[Attachment] = Field(min_length=1, max_length=2)


class Condition(StrictModel):
    field: Key
    op: Literal["gt", "gte", "lt", "lte", "eq", "neq", "contains"]
    value: bool | int | float | Short


class TriggerAction(StrictModel):
    type: Literal["notify", "work_order", "restock", "field_check", "purchase"]
    title: str = Field(default="", max_length=120)
    question: str = Field(default="", max_length=160)
    supplier_id: str | None = Field(default=None, max_length=60)
    amount_cents: Cents | None = None
    requires_field_check: bool = False


class TriggerDraft(StrictModel):
    name: str = Field(min_length=3, max_length=80)
    description: str = Field(default="", max_length=200)
    source: Literal["assets", "inventory"]
    site_id: str = Field(default="all", max_length=60)
    mode: Literal["auto", "manual"] = "auto"
    match: Literal["all", "any"] = "all"
    conditions: list[Condition] = Field(default_factory=list, max_length=6)
    action: TriggerAction
    cooldown_minutes: int = Field(default=30, ge=0, le=10080)
    enabled: bool = True


class Toggle(StrictModel):
    enabled: bool


class AgentSettings(StrictModel):
    enabled: bool | None = None
    live_feed: bool | None = None


class SiteInput(StrictModel):
    name: Name
    industry: Label
    location: Short = ""
    technician: Short = ""
    next_visit_days: int = Field(default=7, ge=0, le=365)


class SitePatch(StrictModel):
    name: Name | None = None
    industry: Label | None = None
    location: Short | None = None
    technician: Short | None = None
    next_visit_days: int | None = Field(default=None, ge=0, le=365)


class AssetInput(StrictModel):
    site_id: str = Field(max_length=60)
    code: Code
    name: Name
    type: Label
    metrics: dict[Key, Metric] = Field(default_factory=dict, max_length=12)


class AssetPatch(StrictModel):
    site_id: str | None = Field(default=None, max_length=60)
    name: Name | None = None
    type: Label | None = None
    metrics: dict[Key, Metric | None] | None = Field(default=None, max_length=12)


class InventoryInput(StrictModel):
    site_id: str = Field(max_length=60)
    sku: Code
    name: Name
    stock: Units
    minimum: Units
    reorder_to: Units | None = None


class InventoryPatch(StrictModel):
    name: Name | None = None
    stock: Units | None = None
    minimum: Units | None = None
    reorder_to: Units | None = None


class SupplierInput(StrictModel):
    name: Name
    approved: bool = False
    recipient: Recipient
    lead_days: int = Field(ge=0, le=365)
    catalog: dict[Code, Cents] = Field(default_factory=dict, max_length=30)


class SupplierPatch(StrictModel):
    name: Name | None = None
    approved: bool | None = None
    recipient: Recipient | None = None
    lead_days: int | None = Field(default=None, ge=0, le=365)
    catalog: dict[Code, Cents | None] | None = Field(default=None, max_length=30)


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


async def agent_loop(service, interval):
    # The operations agent works in the background; people only see what needs them.
    while True:
        try:
            await asyncio.to_thread(service.cycle)
        except Exception:
            logger.exception("Background agent cycle failed")
        await asyncio.sleep(interval)


def create_app(database_path=None, agent_interval=None):
    for name, allowed in (("AVERLOCK_AGENT", "local"), ("AVERLOCK_WALLET", "simulated")):
        if os.getenv(name, allowed) != allowed:
            raise RuntimeError(f"{name}: external adapters are not configured. Use {allowed}.")
    interval = (
        float(os.getenv("AVERLOCK_AGENT_INTERVAL", "5")) if agent_interval is None else agent_interval
    )
    db = database_path or os.getenv(
        "AVERLOCK_DATABASE", str(Path(__file__).parents[1] / "data" / "averlock.db")
    )
    service = OperationsService(SQLiteRepository(str(db)))
    service.interval = interval

    @asynccontextmanager
    async def lifespan(_app):
        task = asyncio.create_task(agent_loop(service, interval)) if interval > 0 else None
        try:
            yield
        finally:
            if task:
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task

    app = FastAPI(
        title="Averlock local operations API",
        version="0.2.0",
        description="Local demo roles are simulated, not authentication. Bind to loopback only.",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:4173",
            "http://127.0.0.1:4173",
        ],
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Content-Type"],
    )
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

    @app.post("/api/agent")
    def agent_settings(body: AgentSettings):
        return command(lambda: service.set_agent(body.enabled, body.live_feed))

    @app.post("/api/agent/cycle")
    def agent_cycle():
        return command(service.cycle)

    @app.post("/api/triggers")
    def create_trigger(body: TriggerDraft):
        return command(lambda: service.create_trigger(body.model_dump()))

    @app.post("/api/triggers/preview")
    def preview_trigger(body: TriggerDraft):
        try:
            return service.preview_trigger(body.model_dump())
        except (DomainError, ValueError) as error:
            raise HTTPException(status_code=409, detail=str(error)) from error

    @app.put("/api/triggers/{trigger_id}")
    def update_trigger(trigger_id: str, body: TriggerDraft):
        return command(lambda: service.update_trigger(trigger_id, body.model_dump()))

    @app.post("/api/triggers/{trigger_id}/enabled")
    def toggle_trigger(trigger_id: str, body: Toggle):
        return command(lambda: service.set_trigger_enabled(trigger_id, body.enabled))

    @app.post("/api/triggers/{trigger_id}/run")
    def run_trigger(trigger_id: str):
        return command(lambda: service.run_trigger(trigger_id))

    @app.delete("/api/triggers/{trigger_id}")
    def delete_trigger(trigger_id: str):
        return command(lambda: service.delete_trigger(trigger_id))

    def data_routes(collection, create_model, patch_model):
        @app.post(f"/api/data/{collection}", name=f"create_{collection}")
        def create(body: create_model):
            return command(lambda: service.create_record(collection, body.model_dump()))

        @app.patch(f"/api/data/{collection}/{{record_id}}", name=f"update_{collection}")
        def update(record_id: str, body: patch_model):
            patch = body.model_dump(exclude_unset=True)
            return command(lambda: service.update_record(collection, record_id, patch))

        @app.delete(f"/api/data/{collection}/{{record_id}}", name=f"delete_{collection}")
        def delete(record_id: str):
            return command(lambda: service.delete_record(collection, record_id))

    data_routes("sites", SiteInput, SitePatch)
    data_routes("assets", AssetInput, AssetPatch)
    data_routes("inventory", InventoryInput, InventoryPatch)
    data_routes("suppliers", SupplierInput, SupplierPatch)

    @app.post("/api/actions/{action_id}/decision")
    def decide(action_id: str, body: Decision):
        return command(lambda: service.decide(action_id, body.decision, body.actor, body.readback))

    @app.post("/api/actions/{action_id}/verification")
    def verify(action_id: str):
        return command(lambda: service.request_verification(action_id))

    @app.post("/api/reports")
    def report(body: Report):
        return command(lambda: service.submit_report(body.model_dump()))

    @app.get("/api/reports/{report_id}/media/{kind}")
    def media(report_id: str, kind: Literal["photo", "audio"]):
        data_url = service.media(report_id, kind)
        if not data_url:
            raise HTTPException(status_code=404, detail="No attachment of this kind")
        header, encoded = data_url.split(",", 1)
        return Response(
            content=base64.b64decode(encoded),
            media_type=header.removeprefix("data:").split(";")[0],
            headers={"Cache-Control": "private, max-age=3600"},
        )

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
