from __future__ import annotations

import json
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

HOST = "127.0.0.1"
PORT = 8765
BASE_DIR = Path(__file__).resolve().parents[2]
TOOL_DIR = Path(__file__).resolve().parent
ENV_PATH = BASE_DIR / ".env"
EXAMPLE_PATH = BASE_DIR / ".env.example"
SCHEMA_PATH = BASE_DIR / ".env.schema.json"

app = FastAPI(title="Local Env Manager", docs_url=None, redoc_url=None)
app.mount("/static", StaticFiles(directory=TOOL_DIR / "static"), name="static")
templates = Jinja2Templates(directory=TOOL_DIR / "templates")


class SavePayload(BaseModel):
    values: dict[str, str]


class FieldPayload(BaseModel):
    key: str
    label: str = ""
    description: str = ""
    placeholder: str = ""
    type: str = "string"
    required: bool = False
    secret: bool = False
    section: str = "Custom"


KEY_PATTERN = re.compile(r"^[A-Z][A-Z0-9_]*$")
VALID_TYPES = {"string", "url", "number", "boolean", "json"}
BOOLEAN_VALUES = {"true", "false", "1", "0", "yes", "no", "on", "off"}


def read_schema() -> dict[str, dict[str, Any]]:
    if not SCHEMA_PATH.exists():
        return {}
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def write_schema(schema: dict[str, dict[str, Any]]) -> None:
    SCHEMA_PATH.write_text(
        json.dumps(schema, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def parse_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def validate_key(key: str) -> None:
    if not KEY_PATTERN.match(key):
        raise HTTPException(status_code=400, detail=f"Invalid env key: {key}")


def validate_value(key: str, value: str, meta: dict[str, Any]) -> str | None:
    value_type = meta.get("type", "string")
    required = bool(meta.get("required", False))
    if required and value == "":
        return "必填欄位尚未填寫"
    if value == "":
        return None
    if value_type == "url":
        parsed = urlparse(value)
        if not parsed.scheme:
            return "URL 必須包含 scheme，例如 http://、ws://、redis:// 或 postgresql+asyncpg://"
    if value_type == "number":
        try:
            float(value)
        except ValueError:
            return "必須是數字"
    if value_type == "boolean" and value.lower() not in BOOLEAN_VALUES:
        return "必須是 boolean，例如 true 或 false"
    if value_type == "json":
        try:
            json.loads(value)
        except json.JSONDecodeError:
            return "必須是合法 JSON"
    return None


def ordered_keys(schema: dict[str, dict[str, Any]], values: dict[str, str]) -> list[str]:
    keys = list(schema)
    keys.extend(key for key in values if key not in schema)
    return keys


def build_fields() -> list[dict[str, Any]]:
    schema = read_schema()
    values = parse_env(ENV_PATH)
    fields: list[dict[str, Any]] = []
    for key in ordered_keys(schema, values):
        meta = schema.get(key, {})
        field_value = values.get(key, "")
        fields.append(
            {
                "key": key,
                "value": field_value,
                "hasValue": field_value != "",
                "label": meta.get("label") or key,
                "description": meta.get("description", ""),
                "placeholder": meta.get("placeholder", ""),
                "type": meta.get("type", "string"),
                "required": bool(meta.get("required", False)),
                "secret": bool(meta.get("secret", False)),
                "section": meta.get("section", "Custom"),
                "error": validate_value(key, field_value, meta),
                "known": key in schema,
            }
        )
    return fields


def backup_env() -> Path | None:
    if not ENV_PATH.exists():
        return None
    timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
    backup_path = BASE_DIR / f".env.backup.{timestamp}"
    shutil.copy2(ENV_PATH, backup_path)
    return backup_path


def render_env(values: dict[str, str], schema: dict[str, dict[str, Any]]) -> str:
    lines = [
        "# ============================================================",
        "# 校園自治整合平台 - 本機環境變數",
        "# 由 tools/env-manager 產生；修改前會自動建立 .env.backup.*",
        "# ============================================================",
        "",
    ]
    current_section = None
    for key in ordered_keys(schema, values):
        validate_key(key)
        section = schema.get(key, {}).get("section", "Custom")
        if section != current_section:
            if current_section is not None:
                lines.append("")
            lines.append(f"# --- {section} ---")
            current_section = section
        lines.append(f"{key}={values.get(key, '')}")
    return "\n".join(lines).rstrip() + "\n"


def placeholder_for_example(key: str, meta: dict[str, Any], value: str) -> str:
    if meta.get("secret"):
        return meta.get("placeholder") or "CHANGE_ME"
    if meta.get("placeholder") not in (None, ""):
        return str(meta["placeholder"])
    return value


@app.middleware("http")
async def localhost_only(request: Request, call_next):
    client_host = request.client.host if request.client else ""
    if client_host not in {"127.0.0.1", "::1", "localhost"}:
        raise HTTPException(status_code=403, detail="Localhost only")
    return await call_next(request)


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.get("/api/env")
async def get_env():
    fields = build_fields()
    return {
        "envPath": str(ENV_PATH),
        "schemaPath": str(SCHEMA_PATH),
        "examplePath": str(EXAMPLE_PATH),
        "fields": fields,
        "missingRequired": [field["key"] for field in fields if field["required"] and not field["hasValue"]],
        "errors": [field for field in fields if field["error"]],
    }


@app.post("/api/env")
async def save_env(payload: SavePayload):
    schema = read_schema()
    values = {key.strip(): value for key, value in payload.values.items() if key.strip()}
    errors: dict[str, str] = {}
    for key, value in values.items():
        validate_key(key)
        error = validate_value(key, value, schema.get(key, {}))
        if error:
            errors[key] = error
    if errors:
        raise HTTPException(status_code=400, detail=errors)

    backup_path = backup_env()
    ENV_PATH.write_text(render_env(values, schema), encoding="utf-8")
    return {"ok": True, "backupPath": str(backup_path) if backup_path else None}


@app.post("/api/schema/fields")
async def add_schema_field(payload: FieldPayload):
    validate_key(payload.key)
    if payload.type not in VALID_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid field type: {payload.type}")
    schema = read_schema()
    schema[payload.key] = {
        "label": payload.label or payload.key,
        "description": payload.description,
        "placeholder": payload.placeholder,
        "type": payload.type,
        "required": payload.required,
        "secret": payload.secret,
        "section": payload.section or "Custom",
    }
    write_schema(schema)
    return {"ok": True}


@app.post("/api/example")
async def generate_example():
    schema = read_schema()
    values = parse_env(ENV_PATH)
    example_values = {
        key: placeholder_for_example(key, schema.get(key, {}), values.get(key, ""))
        for key in ordered_keys(schema, values)
    }
    EXAMPLE_PATH.write_text(render_env(example_values, schema), encoding="utf-8")
    return {"ok": True, "path": str(EXAMPLE_PATH)}


if __name__ == "__main__":
    print(f"Local Env Manager: http://{HOST}:{PORT}")
    uvicorn.run("main:app", host=HOST, port=PORT, reload=False, app_dir=str(TOOL_DIR))
