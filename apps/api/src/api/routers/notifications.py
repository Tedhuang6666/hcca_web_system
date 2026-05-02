"""通知路由 - Email 發送觸發端點"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel, EmailStr

from api.dependencies.auth import get_current_active_user
from api.models.user import User
from api.services.mail import enqueue_email

router = APIRouter(prefix="/notifications", tags=["通知"])


class EmailRequest(BaseModel):
    to: list[EmailStr]
    subject: str
    body: str
    subtype: str = "html"


class TaskEnqueuedResponse(BaseModel):
    task_id: str
    status: str = "queued"
    message: str


@router.post("/email", response_model=TaskEnqueuedResponse, summary="發送 Email（Celery 背景任務）")
async def send_email_notification(
    payload: EmailRequest,
    current_user: User = Depends(get_current_active_user),
) -> TaskEnqueuedResponse:
    """
    將郵件推入 Celery 佇列後立即回應，實際發送由 Worker 處理。
    回傳 task_id 供前端輪詢任務狀態。
    """
    task_id = enqueue_email(
        to=[str(e) for e in payload.to],
        subject=payload.subject,
        body=payload.body,
        subtype=payload.subtype,
    )
    return TaskEnqueuedResponse(
        task_id=task_id,
        message=f"郵件任務已排入佇列，將發送至 {len(payload.to)} 位收件人",
    )


@router.get("/tasks/{task_id}", summary="查詢 Celery 任務狀態")
async def get_task_status(
    task_id: str,
    _: User = Depends(get_current_active_user),
) -> dict[str, object]:
    """透過 task_id 查詢 Celery 任務執行狀態"""
    from api.core.celery_app import celery_app
    from celery.result import AsyncResult

    result: AsyncResult = celery_app.AsyncResult(task_id)
    response: dict[str, object] = {
        "task_id": task_id,
        "status": result.status,
    }
    if result.successful():
        response["result"] = result.get()
    elif result.failed():
        response["error"] = str(result.info)
    return response
