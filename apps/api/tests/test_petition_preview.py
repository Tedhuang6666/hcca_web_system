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
        output_dir = Path(args[args.index("--outdir") + 1])
        (output_dir / "source.pdf").write_bytes(b"%PDF-converted")
        return CompletedProcess()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

    result = await petition_preview.convert_office_attachment_to_pdf(
        b"office-content", "source.docx"
    )

    assert result == b"%PDF-converted"
    args = captured["args"]
    assert isinstance(args, tuple)
    assert args[0] == "libreoffice"
    assert "--headless" in args
    profile = next(arg for arg in args if arg.startswith("-env:UserInstallation="))
    assert "petition-preview-" in profile


@pytest.mark.asyncio
async def test_convert_office_attachment_to_pdf_rejects_other_file_types() -> None:
    with pytest.raises(petition_preview.PetitionPreviewError, match="不支援"):
        await petition_preview.convert_office_attachment_to_pdf(b"data", "image.png")
