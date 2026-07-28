"""校商投稿圖片的 metadata / Content Credentials 證據擷取。"""

from __future__ import annotations

import hashlib
import re
import zlib
from collections.abc import Iterable
from datetime import UTC, datetime
from typing import Literal, TypedDict


class MerchandiseSubmissionAIEvidence(TypedDict):
    level: Literal["A", "B", "C"]
    category: str
    label: str
    value: str
    source: str


class MerchandiseSubmissionAIDetection(TypedDict):
    status: Literal["detected", "supporting", "no_evidence", "not_applicable", "error"]
    evidence: list[MerchandiseSubmissionAIEvidence]
    sha256: str
    scanned_at: str


_AI_TOOLS: tuple[tuple[str, str], ...] = (
    ("openai media generation api", "OpenAI Media Generation API"),
    ("gpt-image", "OpenAI GPT Image"),
    ("gpt image", "OpenAI GPT Image"),
    ("dall-e", "OpenAI DALL·E"),
    ("dall·e", "OpenAI DALL·E"),
    ("midjourney", "Midjourney"),
    ("adobe firefly", "Adobe Firefly"),
    ("microsoft designer", "Microsoft Designer"),
    ("bing image creator", "Bing Image Creator"),
    ("google gemini", "Google Gemini"),
    ("gemini image", "Google Gemini Image"),
    ("dreamstudio", "DreamStudio"),
    ("ideogram", "Ideogram"),
    ("playground ai", "Playground AI"),
    ("recraft", "Recraft"),
    ("nightcafe", "NightCafe"),
    ("novelai", "NovelAI"),
    ("niji journey", "niji journey"),
    ("runway", "Runway"),
    ("canva magic media", "Canva Magic Media"),
    ("leonardo ai", "Leonardo AI"),
    ("comfyui", "ComfyUI"),
    ("automatic1111", "AUTOMATIC1111"),
    ("stable diffusion", "Stable Diffusion"),
    ("sd.next", "SD.Next"),
    ("fooocus", "Fooocus"),
    ("invokeai", "InvokeAI"),
)

_PROMPT_MARKERS: tuple[str, ...] = (
    "prompt:",
    "negative prompt:",
    "negative_prompt",
    "steps:",
    "cfg scale:",
    "sampler:",
    "seed:",
    "model:",
    "vae:",
)
_PROMPT_FIELDS: frozenset[str] = frozenset(
    {
        "parameters",
        "prompt",
        "negative_prompt",
        "negativeprompt",
        "steps",
        "cfgscale",
        "sampler",
        "seed",
        "model",
        "vae",
    }
)
_SOFTWARE_FIELDS: frozenset[str] = frozenset(
    {
        "software",
        "softwareagent",
        "processingsoftware",
        "hostcomputer",
        "creatortool",
        "generator",
        "claimgenerator",
        "actionssoftwareagentname",
    }
)
_C2PA_FIELDS: frozenset[str] = frozenset(
    {
        "claimgenerator",
        "digitalsourcetype",
        "actionsdigitalsourcetype",
    }
)
_WORKFLOW_FIELDS: frozenset[str] = frozenset(
    {"workflow", "comfy_prompt", "comfyprompt", "invokeai", "invokeai_metadata"}
)
_XMP_FIELDS: frozenset[str] = frozenset(
    {
        "creatortool",
        "softwareagent",
        "generator",
        "derivedfrom",
        "prompt",
        "workflow",
    }
)
_C2PA_MARKERS: tuple[str, ...] = (
    "c2pa",
    "jumbf",
    "claim_generator",
    "claimgenerator",
    "trainedalgorithmicmedia",
    "trained algorithmic media",
    "digitalsourcetype",
)
_C2PA_AI_MARKERS: tuple[str, ...] = (
    "trainedalgorithmicmedia",
    "trained algorithmic media",
    "generativeai",
    "generative ai",
)


def _normalize_field_name(value: str) -> str:
    return re.sub(r"[\s_-]", "", value.lower())


def _clean_text(value: str, *, limit: int = 500) -> str:
    cleaned = re.sub(r"\s+", " ", value.replace("\x00", " ")).strip()
    return cleaned[:limit]


def _decode_metadata(value: bytes) -> str:
    text = value.decode("utf-8", errors="ignore")
    if not text.strip():
        text = value.decode("latin-1", errors="ignore")
    text = text.replace("\x00", " ")
    return "".join(char if char in "\r\n\t" or char.isprintable() else " " for char in text)[:4000]


def _png_text_chunks(content: bytes) -> list[tuple[str, str]]:
    if not content.startswith(b"\x89PNG\r\n\x1a\n"):
        return []
    result: list[tuple[str, str]] = []
    offset = 8
    while offset + 12 <= len(content):
        length = int.from_bytes(content[offset : offset + 4], "big")
        chunk_type = content[offset + 4 : offset + 8]
        end = offset + 12 + length
        if length > len(content) - offset - 12 or end > len(content):
            break
        data = content[offset + 8 : offset + 8 + length]
        if chunk_type == b"tEXt":
            key, separator, value = data.partition(b"\x00")
            if separator:
                result.append(("PNG tEXt chunk", _decode_metadata(key + b": " + value)))
        elif chunk_type == b"zTXt":
            key, separator, compressed = data.partition(b"\x00")
            if separator and compressed[:1] == b"\x00":
                try:
                    value = zlib.decompress(compressed[1:])
                except zlib.error:
                    value = b""
                if value:
                    result.append(("PNG zTXt chunk", _decode_metadata(key + b": " + value)))
        elif chunk_type == b"iTXt":
            parts = data.split(b"\x00", 5)
            if len(parts) == 6:
                keyword, compressed, compression_method, language, translated, value = parts
                del language, translated
                if compressed == b"\x01" and compression_method == b"\x00":
                    try:
                        value = zlib.decompress(value)
                    except zlib.error:
                        value = b""
                if value:
                    result.append(("PNG iTXt chunk", _decode_metadata(keyword + b": " + value)))
        offset = end
        if chunk_type == b"IEND":
            break
    return result


def _jpeg_metadata_segments(content: bytes) -> list[tuple[str, str]]:
    if not content.startswith(b"\xff\xd8"):
        return []
    result: list[tuple[str, str]] = []
    offset = 2
    while offset + 4 <= len(content):
        if content[offset] != 0xFF:
            offset += 1
            continue
        while offset < len(content) and content[offset] == 0xFF:
            offset += 1
        if offset >= len(content):
            break
        marker = content[offset]
        offset += 1
        if marker in {0xD8, 0xD9}:
            continue
        if marker == 0xDA:
            break
        length = int.from_bytes(content[offset : offset + 2], "big")
        if length < 2 or offset + length > len(content):
            break
        payload = content[offset + 2 : offset + length]
        if marker in {0xE1, 0xE2, 0xEB, 0xEC, 0xED, 0xEE}:
            result.append((f"JPEG APP{marker - 0xE0} metadata", _decode_metadata(payload)))
        offset += length
    return result


def _webp_metadata_chunks(content: bytes) -> list[tuple[str, str]]:
    if not (content.startswith(b"RIFF") and content[8:12] == b"WEBP"):
        return []
    result: list[tuple[str, str]] = []
    offset = 12
    while offset + 8 <= len(content):
        chunk_type = content[offset : offset + 4]
        length = int.from_bytes(content[offset + 4 : offset + 8], "little")
        start = offset + 8
        end = start + length
        if end > len(content):
            break
        if chunk_type in {b"XMP ", b"EXIF", b"ICCP"}:
            result.append(
                (
                    f"WEBP {chunk_type.decode('ascii', errors='ignore').strip()} metadata",
                    _decode_metadata(content[start:end]),
                )
            )
        offset = end + (length % 2)
    return result


def _metadata_texts(content: bytes, content_type: str) -> list[tuple[str, str]]:
    if content_type == "image/png":
        return _png_text_chunks(content)
    if content_type == "image/jpeg":
        return _jpeg_metadata_segments(content)
    if content_type == "image/webp":
        return _webp_metadata_chunks(content)
    return []


def _metadata_fields(texts: Iterable[tuple[str, str]]) -> list[tuple[str, str, str]]:
    """擷取有欄位語意的 metadata，避免把 prompt 內容中的普通字串當工具。"""
    fields: list[tuple[str, str, str]] = []
    for source, text in texts:
        xml_matches = re.finditer(
            r"<(?:(?:[\w.-]+):)?(?P<key>[A-Za-z][\w.-]*)[^>]*>"
            r"(?P<value>.*?)</(?:(?:[\w.-]+):)?(?P=key)>",
            text,
            flags=re.IGNORECASE | re.DOTALL,
        )
        for match in xml_matches:
            fields.append(
                (
                    source,
                    _normalize_field_name(match.group("key")),
                    _clean_text(match.group("value")),
                )
            )

        field_matches = re.finditer(
            r"(?m)(?P<key>[A-Za-z][\w.-]{1,40})\s*[:=]\s*"
            r"(?P<value>.*?)(?=\s+[A-Za-z][\w.-]{1,40}\s*[:=]|\s*$)",
            text,
        )
        for match in field_matches:
            fields.append(
                (
                    source,
                    _normalize_field_name(match.group("key")),
                    _clean_text(match.group("value")),
                )
            )

        json_matches = re.finditer(
            r"[\"'](?P<key>[A-Za-z][\w ._-]{1,40})[\"']\s*:\s*"
            r"[\"'](?P<value>[^\"']{1,1200})[\"']",
            text,
        )
        for match in json_matches:
            fields.append(
                (
                    source,
                    _normalize_field_name(match.group("key")),
                    _clean_text(match.group("value")),
                )
            )
    return fields


def _matching_fields(
    fields: Iterable[tuple[str, str, str]], names: Iterable[str]
) -> list[tuple[str, str, str]]:
    names_set = {_normalize_field_name(name) for name in names}
    return [field for field in fields if field[1] in names_set]


def _field_text(fields: Iterable[tuple[str, str, str]]) -> str:
    return "\n".join(value for _, _, value in fields if value)


def _parameter_fields(texts: Iterable[tuple[str, str]]) -> list[tuple[str, str, str]]:
    result: list[tuple[str, str, str]] = []
    for source, text in texts:
        match = re.search(
            r"(?:^|[\"'\s,{])parameters[\"']?\s*[:=]\s*(?P<value>.*)$",
            text,
            flags=re.IGNORECASE | re.DOTALL,
        )
        if match:
            result.append((source, "parameters", _clean_text(match.group("value"))))
    return result


def _source_for(texts: Iterable[tuple[str, str]], marker: str) -> str:
    marker = marker.lower()
    for source, text in texts:
        if marker in text.lower():
            return source
    return "圖片 metadata"


def _excerpt_for(texts: Iterable[tuple[str, str]], markers: Iterable[str]) -> str:
    lowered = tuple(marker.lower() for marker in markers)
    for _, text in texts:
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        for line in lines:
            if any(marker in line.lower() for marker in lowered):
                return _clean_text(line)
    return "檢出相關 metadata 標記"


def _add_evidence(
    evidence: list[MerchandiseSubmissionAIEvidence],
    *,
    level: Literal["A", "B", "C"],
    category: str,
    label: str,
    value: str,
    source: str,
) -> None:
    item: MerchandiseSubmissionAIEvidence = {
        "level": level,
        "category": category,
        "label": label,
        "value": _clean_text(value),
        "source": source,
    }
    if not item["value"]:
        return
    if any(
        existing["category"] == item["category"] and existing["value"] == item["value"]
        for existing in evidence
    ):
        return
    evidence.append(item)


def analyze_image_ai_evidence(
    content: bytes, content_type: str
) -> MerchandiseSubmissionAIDetection:
    """只分析原始檔案內可驗證的 metadata，不對圖片像素做模型推論。"""
    scanned_at = datetime.now(UTC).isoformat()
    digest = hashlib.sha256(content).hexdigest()
    if not content_type.lower().startswith("image/"):
        return {
            "status": "not_applicable",
            "evidence": [],
            "sha256": digest,
            "scanned_at": scanned_at,
        }

    metadata = _metadata_texts(content, content_type.lower())
    fields = _metadata_fields(metadata)
    metadata_text = "\n".join(text for _, text in metadata)
    lowered = metadata_text.lower()
    evidence: list[MerchandiseSubmissionAIEvidence] = []

    c2pa_hits = [marker for marker in _C2PA_MARKERS if marker in lowered]
    c2pa_fields = _matching_fields(fields, _C2PA_FIELDS)
    c2pa_ai = any(marker in _field_text(c2pa_fields).lower() for marker in _C2PA_AI_MARKERS)
    if c2pa_hits:
        c2pa_value = _field_text(c2pa_fields) or _excerpt_for(metadata, c2pa_hits)
        _add_evidence(
            evidence,
            level="A",
            category="C2PA / Content Credentials",
            label="C2PA / JUMBF provenance metadata",
            value=c2pa_value,
            source=_source_for(metadata, c2pa_hits[0]),
        )
        integrity_markers = tuple(
            marker
            for marker in ("signature", "certificate", "assertion hash", "manifest hash")
            if marker in lowered
        )
        if integrity_markers:
            _add_evidence(
                evidence,
                level="A",
                category="C2PA Integrity Assertion",
                label="C2PA signature / certificate / hash 欄位",
                value="、".join(integrity_markers) + "（僅表示欄位存在，尚未在此服務驗證簽章）",
                source=_source_for(metadata, integrity_markers[0]),
            )

    tool_hits: list[str] = []
    software_fields = _matching_fields(fields, _SOFTWARE_FIELDS)
    workflow_fields = _matching_fields(fields, _WORKFLOW_FIELDS)
    for source, _, value in [*software_fields, *workflow_fields]:
        value_lower = value.lower()
        for marker, label in _AI_TOOLS:
            if marker in value_lower and label not in tool_hits:
                tool_hits.append(label)
                _add_evidence(
                    evidence,
                    level="A",
                    category="Software Agent / Generator",
                    label="明確指向 AI 生成工具",
                    value=label,
                    source=source,
                )

    prompt_fields = _matching_fields(fields, _PROMPT_FIELDS)
    parameter_fields = _parameter_fields(metadata)
    prompt_text = (_field_text(prompt_fields) + "\n" + _field_text(parameter_fields)).lower()
    prompt_hits = [marker for marker in _PROMPT_MARKERS if marker in prompt_text]
    parameter_text = _field_text(parameter_fields).lower()
    parameter_hits = [marker for marker in _PROMPT_MARKERS if marker in parameter_text]
    has_prompt_metadata = (
        len(set(parameter_hits)) >= 2
        or ("prompt:" in prompt_text and len(set(prompt_hits)) >= 2)
        or (
            any(field[1] in {"prompt", "negativeprompt"} for field in prompt_fields)
            and len(set(prompt_hits)) >= 2
        )
    )
    if has_prompt_metadata:
        _add_evidence(
            evidence,
            level="A",
            category="Prompt Metadata",
            label="生成提示詞／生成參數",
            value=_field_text(parameter_fields or prompt_fields),
            source=(parameter_fields or prompt_fields)[0][0],
        )

    has_workflow_structure = any(
        re.search(r"[\"'](?:class_type|nodes|links)[\"']\s*:", text, re.IGNORECASE)
        for _, text in metadata
    )
    if workflow_fields or has_workflow_structure:
        _add_evidence(
            evidence,
            level="B",
            category="Workflow Metadata",
            label="工作流程 metadata",
            value=_field_text(workflow_fields) or "檢出 workflow / class_type / nodes 結構",
            source=workflow_fields[0][0]
            if workflow_fields
            else _source_for(metadata, "class_type"),
        )

    text_chunk_fields = [
        field
        for field in fields
        if field[0].startswith("PNG ")
        and (field[1] in _PROMPT_FIELDS or field[1] in _WORKFLOW_FIELDS)
    ]
    if text_chunk_fields:
        _add_evidence(
            evidence,
            level="B",
            category="PNG Text Chunk",
            label="PNG tEXt / iTXt / zTXt metadata",
            value=_field_text(text_chunk_fields),
            source=text_chunk_fields[0][0],
        )

    xmp_fields = [
        field
        for field in fields
        if field[1] in _XMP_FIELDS and ("XMP" in field[0] or "APP1" in field[0])
    ]
    if xmp_fields:
        xmp_value = _field_text(xmp_fields)
        _add_evidence(
            evidence,
            level="B",
            category="XMP Metadata",
            label="XMP CreatorTool / Generator / workflow metadata",
            value=xmp_value,
            source=xmp_fields[0][0],
        )

    explicit_ai = bool(tool_hits or has_prompt_metadata or has_workflow_structure or c2pa_ai)
    status: Literal["detected", "supporting", "no_evidence"] = (
        "detected" if explicit_ai else "supporting" if evidence else "no_evidence"
    )
    return {
        "status": status,
        "evidence": evidence,
        "sha256": digest,
        "scanned_at": scanned_at,
    }


def analysis_error() -> MerchandiseSubmissionAIDetection:
    """讀取失敗時仍保留可用的錯誤狀態，不阻擋投稿流程。"""
    return {
        "status": "error",
        "evidence": [],
        "sha256": "",
        "scanned_at": datetime.now(UTC).isoformat(),
    }


__all__ = [
    "MerchandiseSubmissionAIDetection",
    "MerchandiseSubmissionAIEvidence",
    "analyze_image_ai_evidence",
    "analysis_error",
]
