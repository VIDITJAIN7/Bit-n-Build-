import asyncio
import base64
import json
import logging
import os
import secrets
from contextlib import asynccontextmanager, suppress
from pathlib import Path
from typing import Annotated, Literal

from fastapi import FastAPI, Header, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from .adapters import (
    AICommander,
    AIReviewPlanner,
    LocalPlanner,
    OpenAICompatibleCommander,
    OpenAICompatibleRiskReviewer,
)
from .production import (
    PostgresRepository,
    bind_workspace,
    blank_workspace_state,
    verify_supabase_request,
)
from .repository import SQLiteRepository
from .seed import initial_state
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


class ReportFieldDefinition(StrictModel):
    key: Key
    label: Label
    type: Literal["text", "number", "yes_no"]
    required: bool = True


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
    responses: dict[str, str | int | float | bool] = Field(default_factory=dict, max_length=12)
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
    report_fields: list[ReportFieldDefinition] = Field(default_factory=list, max_length=12)
    assignee: str = Field(default="", max_length=80)


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


class LoginRequest(StrictModel):
    username: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=256)


class AgentSettings(StrictModel):
    enabled: bool | None = None
    live_feed: bool | None = None


class ConnectorSettings(StrictModel):
    provider: str = Field(default="", max_length=80)
    endpoint_url: str = Field(default="", max_length=500)
    enabled: bool = False

    @field_validator("endpoint_url")
    @classmethod
    def validate_endpoint(cls, value):
        return validate_connector_url(value)


class WalletConnectorSettings(StrictModel):
    provider: str = Field(default="", max_length=80)
    rpc_url: str = Field(default="", max_length=500)
    chain_id: str = Field(default="", max_length=40)
    contract_address: str = Field(default="", max_length=120)
    wallet_connect_project_id: str = Field(default="", max_length=120)
    enabled: bool = False

    @field_validator("rpc_url")
    @classmethod
    def validate_rpc(cls, value):
        return validate_connector_url(value)


def validate_connector_url(value: str):
    if value and not value.startswith(("https://", "http://")):
        raise ValueError("Connector endpoints must use http:// or https://")
    if "@" in value.split("//", 1)[-1].split("/", 1)[0]:
        raise ValueError("Do not put credentials in a connector URL")
    return value


class IntegrationSettings(StrictModel):
    telemetry: ConnectorSettings
    inventory: ConnectorSettings
    workforce: ConnectorSettings
    wallet: WalletConnectorSettings



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


def setting(name, default="", legacy_name=None):
    if name in os.environ:
        return os.environ[name]
    if legacy_name and legacy_name in os.environ:
        return os.environ[legacy_name]
    return default


def create_app(database_path=None, agent_interval=None):
    production = setting("WORKKITE_ENV", "local").strip().lower() == "production"
    agent_mode = setting("WORKKITE_AGENT", "rules", "AVERLOCK_AGENT").strip().lower()
    if agent_mode in {"rules", "local"}:
        planner = LocalPlanner()
    elif agent_mode in {"ai-commander", "ai-risk", "openai-compatible"}:
        required = (
            ("WORKKITE_LLM_BASE_URL", "AVERLOCK_LLM_BASE_URL"),
            ("WORKKITE_LLM_MODEL", "AVERLOCK_LLM_MODEL"),
            ("WORKKITE_LLM_API_KEY", "AVERLOCK_LLM_API_KEY"),
        )
        missing = [name for name, legacy in required if not setting(name, "", legacy)]
        if missing:
            raise RuntimeError(f"AI agent requires configuration: {', '.join(missing)}")
        base_url = setting("WORKKITE_LLM_BASE_URL", legacy_name="AVERLOCK_LLM_BASE_URL")
        api_key = setting("WORKKITE_LLM_API_KEY", legacy_name="AVERLOCK_LLM_API_KEY")
        model = setting("WORKKITE_LLM_MODEL", legacy_name="AVERLOCK_LLM_MODEL")
        reasoning_effort = setting("WORKKITE_LLM_REASONING_EFFORT", "").strip() or None
        if agent_mode == "ai-risk":
            # Backward-compatible mode: AI risk scoring added to the rules planner.
            planner = AIReviewPlanner(
                OpenAICompatibleRiskReviewer(base_url, api_key, model, reasoning_effort=reasoning_effort)
            )
        else:
            planner = AICommander(
                OpenAICompatibleCommander(base_url, api_key, model, reasoning_effort=reasoning_effort)
            )
    else:
        raise RuntimeError("WORKKITE_AGENT must be 'rules' or 'ai-commander'.")

    risk_mode = setting("WORKKITE_RISK_REVIEWER", "off").strip().lower()
    if risk_mode == "ai" and agent_mode != "ai-risk":
        base_url = setting("WORKKITE_LLM_BASE_URL", legacy_name="AVERLOCK_LLM_BASE_URL")
        api_key = setting("WORKKITE_LLM_API_KEY", legacy_name="AVERLOCK_LLM_API_KEY")
        model = setting("WORKKITE_LLM_MODEL", legacy_name="AVERLOCK_LLM_MODEL")
        reasoning_effort = setting("WORKKITE_LLM_REASONING_EFFORT", "").strip() or None
        if not (base_url and api_key and model):
            raise RuntimeError("AI risk review requires WORKKITE_LLM_BASE_URL, WORKKITE_LLM_MODEL, and WORKKITE_LLM_API_KEY.")
        planner = AIReviewPlanner(
            OpenAICompatibleRiskReviewer(base_url, api_key, model, reasoning_effort=reasoning_effort),
            planner,
        )
    elif risk_mode not in {"off", "", "ai"}:
        raise RuntimeError("WORKKITE_RISK_REVIEWER must be 'off' or 'ai'.")
    if setting("WORKKITE_WALLET", "local", "AVERLOCK_WALLET") not in {"local", "simulated"}:
        raise RuntimeError("External wallet adapter is not configured.")
    interval = (
        float(setting("WORKKITE_AGENT_INTERVAL", "5", "AVERLOCK_AGENT_INTERVAL"))
        if agent_interval is None
        else agent_interval
    )
    if production:
        required = ("SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_DATABASE_URL")
        missing = [name for name in required if not setting(name)]
        if missing:
            raise RuntimeError(f"Production API requires configuration: {', '.join(missing)}")
        repository = PostgresRepository(setting("SUPABASE_DATABASE_URL"))
        interval = 0
    else:
        db = database_path or setting(
            "WORKKITE_DATABASE",
            str(Path(__file__).parents[1] / "data" / "averlock.db"),
            "AVERLOCK_DATABASE",
        )
        seed_factory = initial_state
        if setting("WORKKITE_LOCAL_EMPTY_WORKSPACE", "false").strip().lower() in {
            "1",
            "true",
            "yes",
        }:
            workspace_name = setting("WORKKITE_LOCAL_WORKSPACE_NAME", "Workkite workspace")
            seed_factory = lambda: blank_workspace_state(workspace_name)
        repository = SQLiteRepository(str(db), seed_factory=seed_factory)
    service = OperationsService(repository, agent=planner)
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
        title="Workkite operations API" if production else "Workkite local operations API",
        version="0.2.0",
        description=(
            "Authenticated, workspace-scoped operations API."
            if production
            else "Local operations API. Authentication and wallet adapters are not configured; bind to loopback only."
        ),
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
    app.state.production = production

    @app.middleware("http")
    async def authenticate_workspace(request, call_next):
        if not production or request.url.path == "/api/health":
            return await call_next(request)
        if request.url.path == "/api/cron/agent" and request.method == "GET":
            # This route authenticates independently with CRON_SECRET.
            return await call_next(request)
        identity = await verify_supabase_request(request)
        if identity is None:
            return Response(
                content=json.dumps({"detail": "Sign in to continue."}),
                status_code=401,
                media_type="application/json",
            )
        request.state.account = identity
        path = request.url.path
        method = request.method.upper()
        is_worker_route = (
            path == "/api/auth/me"
            or (path == "/api/state" and method == "GET")
            or (path == "/api/reports" and method == "POST")
            or (path.startswith("/api/reports/") and "/media/" in path and method == "GET")
        )
        if identity["role"] == "worker" and not is_worker_route:
            return Response(
                content=json.dumps({"detail": "Administrator access is required."}),
                status_code=403,
                media_type="application/json",
            )
        # These endpoints only support local scenarios and must never appear in
        # a hosted operations workspace.
        if path.startswith(("/api/demo/", "/api/drills", "/api/weather/scenario", "/api/recovery")):
            return Response(
                content=json.dumps({"detail": "This operation is unavailable in production."}),
                status_code=404,
                media_type="application/json",
            )
        with bind_workspace(identity["workspace_id"]):
            return await call_next(request)

    def visible_snapshot(request: Request | None = None):
        snapshot = service.snapshot()
        if production and request is not None and request.state.account["role"] == "worker":
            account = request.state.account
            snapshot["field_tasks"] = [
                task for task in snapshot["field_tasks"] if worker_can_access_task(task, account)
            ]
            allowed_task_ids = {task["id"] for task in snapshot["field_tasks"]}
            snapshot["reports"] = [
                report
                for report in snapshot["reports"]
                if report.get("task_id") in allowed_task_ids
            ]
            task_asset_ids = {task.get("subject_id") for task in snapshot["field_tasks"]}
            snapshot["assets"] = [
                asset for asset in snapshot["assets"] if asset["id"] in task_asset_ids
            ]
            snapshot["actions"] = []
            snapshot["triggers"] = []
            snapshot["inventory"] = []
            snapshot["suppliers"] = []
            snapshot["wallet"] = {"balance_cents": 0, "receipts": [], "mode": "hidden"}
            snapshot["integrations"] = {}
            snapshot["audit"] = []
        return snapshot

    def worker_can_access_task(task, account):
        assignee = (task.get("assignee") or "").strip().casefold()
        return not assignee or assignee in {
            account["email"].strip().casefold(),
            account["display_name"].strip().casefold(),
        }

    def command(fn, request: Request | None = None):
        try:
            _, message = fn()
            return {"state": visible_snapshot(request), "message": message}
        except (DomainError, ValueError) as error:
            raise HTTPException(status_code=409, detail=str(error)) from error

    @app.get("/api/health")
    def health():
        return {
            "status": "ok",
            "mode": "production" if production else "local",
            "agent": service.agent.mode,
            "wallet": "unconfigured" if production else "simulated",
        }

    @app.post("/api/auth/login")
    def login(body: LoginRequest):
        """Local role routing from server-side configuration; not production auth."""
        if production:
            raise HTTPException(status_code=404, detail="Use Supabase sign-in")
        configured = os.getenv("WORKKITE_LOCAL_USERS_JSON", "[]")
        try:
            users = json.loads(configured)
        except json.JSONDecodeError as error:
            logger.error("WORKKITE_LOCAL_USERS_JSON is invalid JSON")
            raise HTTPException(status_code=503, detail="Sign-in is unavailable") from error
        if not isinstance(users, list):
            raise HTTPException(status_code=503, detail="Sign-in is unavailable")
        username = body.username.strip().casefold()
        account = next(
            (
                user
                for user in users
                if isinstance(user, dict)
                and isinstance(user.get("username"), str)
                and isinstance(user.get("password"), str)
                and user.get("role") in {"admin", "worker"}
                and secrets.compare_digest(user["username"].strip().casefold(), username)
                and secrets.compare_digest(user["password"], body.password)
            ),
            None,
        )
        if account is None:
            raise HTTPException(status_code=401, detail="Username or password is incorrect")
        return {
            "username": username,
            "display_name": account.get("display_name", username),
            "role": account["role"],
            "workspace": account.get("workspace", "Workkite workspace"),
        }

    @app.get("/api/auth/me")
    def current_user(request: Request):
        if not production:
            raise HTTPException(status_code=404, detail="Hosted identity is not configured")
        account = request.state.account
        return {
            "email": account["email"],
            "role": account["role"],
            "workspace_id": account["workspace_id"],
        }

    @app.get("/api/state")
    def state(request: Request):
        return visible_snapshot(request)

    @app.post("/api/agent")
    def agent_settings(body: AgentSettings):
        return command(lambda: service.set_agent(body.enabled, body.live_feed))

    @app.put("/api/integrations")
    def integrations(body: IntegrationSettings):
        return command(lambda: service.set_integrations(body.model_dump()))

    @app.post("/api/agent/cycle")
    def agent_cycle():
        return command(service.cycle)

    @app.get("/api/cron/agent")
    def scheduled_agent_cycle(authorization: str | None = Header(default=None)):
        cron_secret = os.getenv("CRON_SECRET", "")
        if not cron_secret:
            raise HTTPException(status_code=503, detail="Scheduled agent is not configured")
        supplied = authorization.removeprefix("Bearer ") if authorization else ""
        if not secrets.compare_digest(supplied, cron_secret):
            raise HTTPException(status_code=401, detail="Unauthorized scheduled request")
        if production:
            results = []
            for workspace_id in repository.workspace_ids():
                with bind_workspace(workspace_id):
                    _, message = service.cycle()
                    results.append({"workspace_id": workspace_id, "message": message})
            return {"status": "ok", "workspaces_processed": len(results)}
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
    def report(body: Report, request: Request):
        if production:
            state = service.snapshot()
            task = next(
                (
                    item
                    for item in state["field_tasks"]
                    if item.get("id") == body.task_id and item.get("status") == "open"
                ),
                None,
            )
            if task is None:
                raise HTTPException(status_code=404, detail="Open task not found")
            if request.state.account["role"] == "worker" and not worker_can_access_task(
                task, request.state.account
            ):
                raise HTTPException(status_code=404, detail="Open task not found")
        return command(lambda: service.submit_report(body.model_dump()), request)

    @app.get("/api/reports/{report_id}/media/{kind}")
    def media(report_id: str, kind: Literal["photo", "audio"], request: Request):
        if production and request.state.account["role"] == "worker":
            snapshot = service.snapshot()
            report_record = next(
                (item for item in snapshot["reports"] if item.get("id") == report_id), None
            )
            task = next(
                (
                    item
                    for item in snapshot["field_tasks"]
                    if item.get("id") == (report_record or {}).get("task_id")
                ),
                None,
            )
            if task is None or not worker_can_access_task(task, request.state.account):
                raise HTTPException(status_code=404, detail="Evidence not found")
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
