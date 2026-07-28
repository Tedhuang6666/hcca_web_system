"""電子證件回應 Schema。"""

from typing import Literal

from pydantic import BaseModel, ConfigDict


class ElectronicCredentialOut(BaseModel):
    """登入者可出示的象徵性電子證件。"""

    model_config = ConfigDict(from_attributes=True)

    display_name: str
    email: str
    student_id: str | None = None
    identity_kind: Literal["student", "teacher", "authorized"]
    identity_label: str
    status_label: str
