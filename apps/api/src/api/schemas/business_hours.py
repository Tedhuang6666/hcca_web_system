"""共用營業時間 schema。"""

from __future__ import annotations

from pydantic import BaseModel, Field


class BusinessHoursInterval(BaseModel):
    """單一營業時段；close 早於 open 時代表跨日營業。"""

    open: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    close: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")


type BusinessHours = dict[str, list[BusinessHoursInterval]]
