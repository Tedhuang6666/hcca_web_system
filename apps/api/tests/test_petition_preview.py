"""陳情 Office 附件本機轉檔測試。"""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from api.services import petition_preview


@pytest.mark.asyncio
async def test_convert_office_attachment_to_pdf_uses_isolated_libreoffice_profile(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}

    class CompletedProcess:
        returncode = 0

        async def communicate(self) -> tuple[bytes, bytes]:
            return b"", b""

    async def fake_create_subprocess_exec(*args: str, **kwargs: object) -> CompletedProcess:
        captured["args"] = args
        output_path = Path(args[args.index("--output") + 1])
        output_path.write_bytes(b"%PDF-converted")
        return CompletedProcess()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

    result = await petition_preview.convert_office_attachment_locally(
        b"office-content", "source.docx"
    )

    assert result == b"%PDF-converted"
    args = captured["args"]
    assert isinstance(args, tuple)
    assert args[0] == "/usr/bin/python3"
    assert args[1].endswith("convert_office_attachment.py")
    profile = args[args.index("--profile") + 1]
    assert "petition-preview-" in profile


@pytest.mark.asyncio
async def test_api_preview_sends_attachment_to_worker_over_unix_socket(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}

    class FakeResponse:
        status_code = 200
        content = b"%PDF-converted"

    class FakeClient:
        def __init__(self, **kwargs: object) -> None:
            captured["client"] = kwargs

        async def __aenter__(self) -> FakeClient:
            return self

        async def __aexit__(self, *_args: object) -> None:
            return None

        async def post(self, path: str, **kwargs: object) -> FakeResponse:
            captured["path"] = path
            captured["request"] = kwargs
            return FakeResponse()

    def fake_transport(*, uds: str, trust_env: bool) -> object:
        captured["uds"] = uds
        captured["trust_env"] = trust_env
        return object()

    monkeypatch.setenv("PETITION_PREVIEW_SOCKET", "/tmp/petition-preview.sock")
    monkeypatch.setattr(petition_preview.httpx, "AsyncHTTPTransport", fake_transport)
    monkeypatch.setattr(petition_preview.httpx, "AsyncClient", FakeClient)

    result = await petition_preview.convert_office_attachment_to_pdf(
        b"office-content", "/private/source.docx"
    )

    assert result == b"%PDF-converted"
    assert captured["uds"] == "/tmp/petition-preview.sock"
    assert captured["trust_env"] is False
    assert captured["path"] == "/convert"
    request = captured["request"]
    assert isinstance(request, dict)
    assert request["params"] == {"filename": "source.docx"}
    assert request["content"] == b"office-content"


def test_uno_converter_disables_external_link_updates_and_macros() -> None:
    converter = Path(__file__).resolve().parents[1] / "scripts" / "convert_office_attachment.py"
    source = converter.read_text()

    assert "UpdateDocMode" in source and "NO_UPDATE" in source
    assert "/org.openoffice.Office.Writer/Content/Update" in source
    assert "<value>2</value>" in source
    assert "/org.openoffice.Office.Calc/Content/Update" in source
    assert "<value>1</value>" in source
    assert "MacroExecutionMode" in source and "NEVER_EXECUTE" in source


@pytest.mark.asyncio
async def test_convert_office_attachment_to_pdf_rejects_other_file_types() -> None:
    with pytest.raises(petition_preview.PetitionPreviewError, match="不支援"):
        await petition_preview.convert_office_attachment_to_pdf(b"data", "image.png")
