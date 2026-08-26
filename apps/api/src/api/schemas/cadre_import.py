"""班聯會幹部通訊錄一鍵匯入的請求與回應模型。"""

from __future__ import annotations

from pydantic import BaseModel, Field


class CadreDirectoryImportOut(BaseModel):
    academic_year: int
    source_rows: int
    cadre_members: int
    users_created: int
    users_reused: int
    orgs_created: int
    positions_created: int
    permissions_added: int
    assignments_created: int
    roster_created: int
    roster_updated: int
    class_codes: list[str] = Field(default_factory=list)
