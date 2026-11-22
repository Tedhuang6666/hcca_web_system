#!/usr/bin/env python3
"""以含外部圖片連結的 DOCX 確認轉檔不發出 HTTP 請求。"""

from __future__ import annotations

import asyncio
from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

from api.services.petition_preview import convert_office_attachment_locally

_IMAGE_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000b49444154789c6360000200000500017a5eab3f0000000049454e44ae426082"
)


def _linked_image_docx(image_url: str) -> bytes:
    document = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
 xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
 <w:body><w:p><w:r><w:t>External image preview check</w:t></w:r></w:p>
 <w:p><w:r><w:drawing><wp:inline><wp:extent cx="914400" cy="914400"/>
 <wp:docPr id="1" name="External image"/><a:graphic>
 <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
 <pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="external.png"/>
 <pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:link="rIdExternal"/>
 <a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr>
 <a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>
 <a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>
 </a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
 <w:sectPr/></w:body></w:document>"""
    document_relationships = f"""<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rIdExternal"
  Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
  Target="{image_url}" TargetMode="External"/>
</Relationships>"""
    package_relationships = """<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rId1"
  Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
  Target="word/document.xml"/>
</Relationships>"""
    content_types = """<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="xml" ContentType="application/xml"/>
 <Override PartName="/word/document.xml"
  ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"""

    output = BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        archive.writestr("_rels/", b"")
        archive.writestr("word/", b"")
        archive.writestr("word/_rels/", b"")
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", package_relationships)
        archive.writestr("word/document.xml", document)
        archive.writestr("word/_rels/document.xml.rels", document_relationships)
    return output.getvalue()


async def main() -> None:
    requests = 0

    async def receive_request(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        nonlocal requests
        await reader.read(4096)
        requests += 1
        writer.write(
            b"HTTP/1.1 200 OK\r\nContent-Type: image/png\r\n"
            + f"Content-Length: {len(_IMAGE_PNG)}\r\nConnection: close\r\n\r\n".encode()
            + _IMAGE_PNG
        )
        await writer.drain()
        writer.close()
        await writer.wait_closed()

    server = await asyncio.start_server(receive_request, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    try:
        content = _linked_image_docx(f"http://127.0.0.1:{port}/external.png")
        pdf = await convert_office_attachment_locally(content, "external-image.docx")
    finally:
        server.close()
        await server.wait_closed()

    if not pdf.startswith(b"%PDF"):
        raise SystemExit("LibreOffice did not produce a PDF")
    if requests:
        raise SystemExit(f"external image URL was requested {requests} time(s)")
    print("PASS: linked-image DOCX converted; local HTTP listener received 0 requests")


if __name__ == "__main__":
    asyncio.run(main())
