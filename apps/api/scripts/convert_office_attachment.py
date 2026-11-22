#!/usr/bin/env python3
"""以 UNO 載入 Office 文件，明確停用外部更新與巨集後匯出 PDF。"""

from __future__ import annotations

import argparse
import hashlib
import posixpath
import shutil
import subprocess
import sys
import time
from pathlib import Path, PurePosixPath
from xml.etree import ElementTree
from zipfile import BadZipFile, ZipFile

import uno
from com.sun.star.beans import PropertyValue
from com.sun.star.document.MacroExecMode import NEVER_EXECUTE
from com.sun.star.document.UpdateDocMode import NO_UPDATE

FILTERS_BY_EXTENSION = {
    ".doc": "writer_pdf_Export",
    ".docx": "writer_pdf_Export",
    ".xls": "calc_pdf_Export",
    ".xlsx": "calc_pdf_Export",
    ".ppt": "impress_pdf_Export",
    ".pptx": "impress_pdf_Export",
}
OOXML_EXTENSIONS = {".docx", ".xlsx", ".pptx"}
MAX_ARCHIVE_ENTRIES = 10_000
MAX_ARCHIVE_UNCOMPRESSED_SIZE = 200 * 1024 * 1024
MAX_RELATIONSHIPS_XML_SIZE = 5 * 1024 * 1024
RELATIONSHIP_TAG = "{http://schemas.openxmlformats.org/package/2006/relationships}Relationship"
PACKAGE_NAMESPACE = "http://schemas.openxmlformats.org/package/2006/relationships"
CONTENT_TYPES_NAMESPACE = "http://schemas.openxmlformats.org/package/2006/content-types"
WORDPROCESSING_NAMESPACE = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
DOCUMENT_RELATIONSHIPS_NAMESPACE = (
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
)
MAX_REFERENCING_XML_SIZE = 20 * 1024 * 1024
PLACEHOLDER_PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000b49444154789c6360000200000500017a5eab3f0000000049454e44ae426082"
)

_PROFILE_SETTINGS = """<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry">
  <item oor:path="/org.openoffice.Office.Writer/Content/Update">
    <prop oor:name="Link" oor:op="fuse"><value>2</value></prop>
  </item>
  <item oor:path="/org.openoffice.Office.Calc/Content/Update">
    <prop oor:name="Link" oor:op="fuse"><value>1</value></prop>
  </item>
</oor:items>
"""


def _property(name: str, value: object) -> PropertyValue:
    prop = PropertyValue()
    prop.Name = name
    prop.Value = value
    return prop


def _connect(pipe_name: str, process: subprocess.Popen[bytes]):
    local_context = uno.getComponentContext()
    resolver = local_context.ServiceManager.createInstanceWithContext(
        "com.sun.star.bridge.UnoUrlResolver", local_context
    )
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("LibreOffice stopped before accepting the local pipe")
        try:
            return resolver.resolve(f"uno:pipe,name={pipe_name};urp;StarOffice.ComponentContext")
        except Exception:
            time.sleep(0.1)
    raise TimeoutError("LibreOffice local pipe was not ready")


def _serialize_ooxml(root: ElementTree.Element, default_namespace: str) -> bytes:
    for prefix, namespace in (
        ("w", WORDPROCESSING_NAMESPACE),
        ("r", DOCUMENT_RELATIONSHIPS_NAMESPACE),
        ("wp", "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"),
        ("a", "http://schemas.openxmlformats.org/drawingml/2006/main"),
        ("pic", "http://schemas.openxmlformats.org/drawingml/2006/picture"),
    ):
        ElementTree.register_namespace(prefix, namespace)
    ElementTree.register_namespace("", default_namespace)
    return ElementTree.tostring(root, encoding="utf-8", xml_declaration=True)


def _remove_external_relationships(source_path: Path, destination_path: Path) -> Path:
    """移除 OOXML 套件的外部關係，避免匯入器解析時取用外部資源。"""
    if source_path.suffix.lower() not in OOXML_EXTENSIONS:
        return source_path

    placeholders: dict[str, bytes] = {}
    sanitized_relationships: dict[str, bytes] = {}
    linked_image_relationships: dict[str, set[str]] = {}
    try:
        with ZipFile(source_path) as source:
            entries = source.infolist()
            if (
                len(entries) > MAX_ARCHIVE_ENTRIES
                or sum(entry.file_size for entry in entries) > MAX_ARCHIVE_UNCOMPRESSED_SIZE
            ):
                raise ValueError("Office archive exceeds preview limits")

            for entry in entries:
                if not entry.filename.endswith(".rels"):
                    continue
                if entry.file_size > MAX_RELATIONSHIPS_XML_SIZE:
                    raise ValueError("Office relationships exceed preview limits")
                with source.open(entry) as original:
                    root = ElementTree.fromstring(original.read())
                changed = False
                rel_path = PurePosixPath(entry.filename)
                source_part = rel_path.parent.parent / rel_path.name.removesuffix(".rels")
                source_directory = source_part.parent
                external_image_ids: set[str] = set()
                for relationship in tuple(root):
                    if relationship.tag != RELATIONSHIP_TAG or (
                        relationship.get("TargetMode", "").lower() != "external"
                    ):
                        continue
                    changed = True
                    if relationship.get("Type", "").endswith("/image"):
                        relationship_id = relationship.get("Id")
                        if relationship_id:
                            external_image_ids.add(relationship_id)
                        suffix = hashlib.sha256(entry.filename.encode()).hexdigest()[:12]
                        placeholder_name = f"_hcca-preview-{suffix}.png"
                        placeholder_path = source_directory / placeholder_name
                        placeholders[str(placeholder_path)] = PLACEHOLDER_PNG
                        relationship.set(
                            "Target",
                            posixpath.relpath(
                                str(placeholder_path),
                                str(source_directory),
                            ),
                        )
                        relationship.attrib.pop("TargetMode", None)
                    else:
                        root.remove(relationship)
                if changed:
                    sanitized_relationships[entry.filename] = _serialize_ooxml(
                        root,
                        PACKAGE_NAMESPACE,
                    )
                if external_image_ids:
                    linked_image_relationships[str(source_part)] = external_image_ids

            with ZipFile(destination_path, "w") as sanitized:
                for entry in entries:
                    if entry.is_dir():
                        sanitized.writestr(entry, b"")
                        continue
                    if entry.filename in sanitized_relationships:
                        sanitized.writestr(entry, sanitized_relationships[entry.filename])
                        continue
                    if entry.filename in linked_image_relationships:
                        if entry.file_size > MAX_REFERENCING_XML_SIZE:
                            raise ValueError("Office document part exceeds preview limits")
                        root = ElementTree.fromstring(source.read(entry))
                        for element in root.iter():
                            link_attribute = f"{{{DOCUMENT_RELATIONSHIPS_NAMESPACE}}}link"
                            relationship_id = element.attrib.get(link_attribute)
                            if relationship_id in linked_image_relationships[entry.filename]:
                                del element.attrib[link_attribute]
                                element.set(
                                    f"{{{DOCUMENT_RELATIONSHIPS_NAMESPACE}}}embed",
                                    relationship_id,
                                )
                        sanitized.writestr(
                            entry,
                            _serialize_ooxml(root, WORDPROCESSING_NAMESPACE),
                        )
                        continue
                    if entry.filename == "[Content_Types].xml" and placeholders:
                        root = ElementTree.fromstring(source.read(entry))
                        has_png = any(
                            child.tag == f"{{{CONTENT_TYPES_NAMESPACE}}}Default"
                            and child.get("Extension", "").lower() == "png"
                            for child in root
                        )
                        if not has_png:
                            png_default = ElementTree.Element(
                                f"{{{CONTENT_TYPES_NAMESPACE}}}Default",
                                Extension="png",
                                ContentType="image/png",
                            )
                            first_override = next(
                                (
                                    index
                                    for index, child in enumerate(root)
                                    if child.tag == f"{{{CONTENT_TYPES_NAMESPACE}}}Override"
                                ),
                                len(root),
                            )
                            root.insert(first_override, png_default)
                        sanitized.writestr(
                            entry,
                            _serialize_ooxml(root, CONTENT_TYPES_NAMESPACE),
                        )
                        continue
                    with source.open(entry) as original, sanitized.open(entry, "w") as copied:
                        shutil.copyfileobj(original, copied, length=1024 * 1024)
                for name, content in placeholders.items():
                    if name in source.namelist():
                        raise ValueError("Office archive contains a reserved preview part")
                    sanitized.writestr(name, content)
    except BadZipFile as exc:
        raise ValueError("Invalid Office archive") from exc
    return destination_path


def convert(source_path: Path, output_path: Path, profile_path: Path) -> None:
    suffix = source_path.suffix.lower()
    filter_name = FILTERS_BY_EXTENSION.get(suffix)
    if filter_name is None:
        raise ValueError("Unsupported Office file type")

    safe_source_path = _remove_external_relationships(
        source_path,
        profile_path.parent / f"sanitized{suffix}",
    )
    pipe_name = f"hcca-petition-preview-{time.time_ns()}"
    accept = f"pipe,name={pipe_name};urp;StarOffice.ServiceManager"
    command = [
        "libreoffice",
        "--headless",
        "--nologo",
        "--nodefault",
        "--norestore",
        "--nolockcheck",
        "--nofirststartwizard",
        f"-env:UserInstallation={profile_path.resolve().as_uri()}",
        f"--accept={accept}",
    ]
    user_profile = profile_path / "user"
    user_profile.mkdir(parents=True, exist_ok=True)
    (user_profile / "registrymodifications.xcu").write_text(
        _PROFILE_SETTINGS,
        encoding="utf-8",
    )
    process = subprocess.Popen(
        command,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    document = None
    try:
        context = _connect(pipe_name, process)
        desktop = context.ServiceManager.createInstanceWithContext(
            "com.sun.star.frame.Desktop", context
        )
        load_properties = (
            _property("Hidden", True),
            _property("ReadOnly", True),
            _property("Silent", True),
            _property("UpdateDocMode", NO_UPDATE),
            _property("MacroExecutionMode", NEVER_EXECUTE),
        )
        document = desktop.loadComponentFromURL(
            uno.systemPathToFileUrl(str(safe_source_path.resolve())),
            "_blank",
            0,
            load_properties,
        )
        if document is None:
            raise RuntimeError("LibreOffice could not load the Office attachment")
        document.storeToURL(
            uno.systemPathToFileUrl(str(output_path.resolve())),
            (_property("FilterName", filter_name), _property("Overwrite", True)),
        )
    finally:
        if document is not None:
            try:
                document.close(True)
            except Exception:
                document.dispose()
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--profile", required=True, type=Path)
    args = parser.parse_args()
    try:
        convert(args.input, args.output, args.profile)
    except Exception as exc:
        print(f"Office conversion failed ({type(exc).__name__}).", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
