"""校商投稿圖片 metadata 證據擷取單元測試。"""

from __future__ import annotations

import struct
import zlib

from api.services.merchandise_submission_ai import analyze_image_ai_evidence


def _png_text_image(text: str) -> bytes:
    data = b"parameters\x00" + text.encode()
    chunk = struct.pack(">I", len(data)) + b"tEXt" + data
    chunk += struct.pack(">I", zlib.crc32(b"tEXt" + data) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk + b"\x00\x00\x00\x00IEND\xaeB`\x82"


def _jpeg_xmp_image(text: str) -> bytes:
    payload = b"http://ns.adobe.com/xap/1.0/\x00" + text.encode()
    segment = b"\xff\xe1" + struct.pack(">H", len(payload) + 2) + payload
    return b"\xff\xd8" + segment + b"\xff\xd9"


def _webp_xmp_image(text: str) -> bytes:
    data = text.encode()
    chunk = b"XMP " + struct.pack("<I", len(data)) + data
    chunk += b"\x00" * (len(data) % 2)
    body = b"WEBP" + chunk
    return b"RIFF" + struct.pack("<I", len(body)) + body


def test_png_prompt_metadata_is_reported_as_ai_evidence() -> None:
    result = analyze_image_ai_evidence(
        _png_text_image(
            "Prompt: a campus mascot, Negative Prompt: blurry, Steps: 30, "
            "CFG Scale: 7, Sampler: Euler a, Seed: 123"
        ),
        "image/png",
    )

    assert result["status"] == "detected"
    assert any(item["category"] == "Prompt Metadata" for item in result["evidence"])
    assert any(item["category"] == "PNG Text Chunk" for item in result["evidence"])
    assert len(result["sha256"]) == 64


def test_xmp_known_generator_is_reported_without_pixel_inference() -> None:
    result = analyze_image_ai_evidence(
        _jpeg_xmp_image("<xmp:CreatorTool>gpt-image</xmp:CreatorTool>"),
        "image/jpeg",
    )

    assert result["status"] == "detected"
    tool_evidence = [
        item for item in result["evidence"] if item["category"] == "Software Agent / Generator"
    ]
    assert tool_evidence[0]["value"] == "OpenAI GPT Image"


def test_c2pa_ai_source_and_integrity_fields_are_reported_separately() -> None:
    result = analyze_image_ai_evidence(
        _jpeg_xmp_image(
            "c2pa claim_generator=OpenAI Media Generation API "
            "digitalSourceType=trainedAlgorithmicMedia signature certificate hash"
        ),
        "image/jpeg",
    )

    assert result["status"] == "detected"
    categories = {item["category"] for item in result["evidence"]}
    assert "C2PA / Content Credentials" in categories
    assert "C2PA Integrity Assertion" in categories
    assert "Software Agent / Generator" in categories


def test_webp_xmp_software_field_is_supported() -> None:
    result = analyze_image_ai_evidence(
        _webp_xmp_image("Software: Fooocus"),
        "image/webp",
    )

    assert result["status"] == "detected"
    assert any(item["value"] == "Fooocus" for item in result["evidence"])


def test_tool_name_inside_unstructured_prompt_does_not_trigger_ai_tool_finding() -> None:
    result = analyze_image_ai_evidence(
        _png_text_image("Prompt: put the word ComfyUI on a poster"),
        "image/png",
    )

    assert result["status"] != "detected"
    assert not any(item["category"] == "Software Agent / Generator" for item in result["evidence"])


def test_plain_image_has_no_ai_evidence() -> None:
    result = analyze_image_ai_evidence(b"\x89PNG\r\n\x1a\nplain", "image/png")

    assert result["status"] == "no_evidence"
    assert result["evidence"] == []
