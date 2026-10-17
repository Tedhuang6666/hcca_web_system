"""首次登入的班級確認契約。"""

import uuid

from pydantic import BaseModel, ConfigDict, Field

from api.schemas.school_class import MySchoolClassOut, SchoolClassListItem


class ClassConfirmationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    class_id: uuid.UUID
    seat_number: int = Field(ge=1, le=999)


class ClassConfirmationOut(BaseModel):
    required: bool
    student_id: str | None
    current_class: MySchoolClassOut | None
    class_options: list[SchoolClassListItem]
