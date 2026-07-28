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


def _png_chunk(chunk_type: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + chunk_type
        + data
        + struct.pack(">I", zlib.crc32(chunk_type + data) & 0xFFFFFFFF)
    )


def _png_c2pa_image(payload: bytes) -> bytes:
    ihdr = struct.pack(">IIBBBBB", 2, 1, 8, 6, 0, 0, 0)
    return (
        bytes.fromhex("89504e470d0a1a0a")
        + _png_chunk(b"IHDR", ihdr)
        + _png_chunk(b"caBX", payload)
        + _png_chunk(b"IEND", b"")
    )


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


def test_png_c2pa_binary_chunk_is_detected_and_exposed_in_metadata() -> None:
    result = analyze_image_ai_evidence(
        _png_c2pa_image(
            bytes([0, 1])
            + b"claim_generator OpenAI Images "
            + b"digitalSourceType trainedAlgorithmicMedia"
        ),
        "image/png",
    )

    assert result["status"] == "detected"
    assert any(item["category"] == "C2PA / Content Credentials" for item in result["evidence"])
    assert any(item["value"] == "OpenAI Images" for item in result["evidence"])
    assert any(item["source"] == "PNG caBX C2PA/JUMBF chunk" for item in result["metadata"])
    assert any(item["key"] == "width" and item["value"] == "2" for item in result["metadata"])


def test_png_c2pa_manifest_without_ai_source_is_only_supporting_evidence() -> None:
    result = analyze_image_ai_evidence(
        _png_c2pa_image(bytes([0, 1]) + b"binary manifest"), "image/png"
    )

    assert result["status"] == "supporting"
    assert any(item["category"] == "C2PA / Content Credentials" for item in result["evidence"])
    assert not any(item["category"] == "Software Agent / Generator" for item in result["evidence"])


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
