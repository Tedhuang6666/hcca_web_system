"""事情導向治理中樞 Router。"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from api.core.database import get_db
from api.core.permission_codes import PermissionCode
from api.dependencies.auth import get_current_active_user
from api.dependencies.permissions import require_any
from api.models.governance import GovernanceCase, Matter, Program
from api.models.user import User
from api.schemas.governance import (
    AutomationRuleCreate,
    AutomationRuleOut,
    AutomationRuleUpdate,
    DecisionCreate,
    DecisionOut,
    DecisionUpdate,
    EntityRelationCreate,
    EntityRelationGraphOut,
    EntityRelationOut,
    GovernanceCaseCreate,
    GovernanceCaseOut,
    GovernanceCaseUpdate,
    GovernanceDashboardOut,
    GovernanceWorkflowTemplateCreate,
    GovernanceWorkflowTemplateOut,
    MatterCreate,
    MatterLinkRefOut,
    MatterListItem,
    MatterOut,
    MatterRoleAssignmentCreate,
    MatterRoleAssignmentOut,
    MatterRoleAssignmentUpdate,
    MatterSpawnIn,
    MatterSpawnOut,
    MatterUpdate,
    PlanningDocumentCreate,
    PlanningDocumentOut,
    PlanningDocumentRevisionCreate,
    PlanningDocumentRevisionOut,
    PlanningDocumentUpdate,
    ProgramCreate,
    ProgramOut,
    ProgramUpdate,
    TimelineEventCreate,
    TimelineEventOut,
)
from api.schemas.work_item import WorkItemCreate, WorkItemOut
from api.services import announcement as announcement_svc
from api.services import audit as audit_svc
from api.services import governance as governance_svc
from api.services import governance_ingest
from api.services import meeting as meeting_svc
from api.services import survey as survey_svc
from api.services import work_item as work_item_svc

router = APIRouter(prefix="/governance", tags=["事情治理中樞"])

DbDep = Annotated[AsyncSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_active_user)]
GovernanceManagerDep = Depends(
    require_any(
        PermissionCode.GOVERNANCE_MANAGE,
        PermissionCode.MEETING_MANAGE,
        PermissionCode.ACTIVITY_MANAGE,
        PermissionCode.DOCUMENT_ADMIN,
        PermissionCode.ADMIN_ALL,
    )
)


async def _matter_or_404(db: AsyncSession, matter_id: uuid.UUID) -> Matter:
    matter = await governance_svc.get_matter(db, matter_id)
    if matter is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="事情不存在")
    return matter


async def _program_or_404(db: AsyncSession, program_id: uuid.UUID) -> Program:
    program = await governance_svc.get_program(db, program_id)
    if program is None or not program.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="專案不存在")
    return program


async def _case_or_404(db: AsyncSession, case_id: uuid.UUID) -> GovernanceCase:
    case = await governance_svc.get_case(db, case_id)
    if case is None or not case.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="案件不存在")
    return case


@router.get("/dashboard", response_model=GovernanceDashboardOut, summary="治理工作台")
async def get_governance_dashboard(db: DbDep, user: CurrentUser) -> dict:
    return await governance_svc.dashboard(db, user=user)


@router.get("/matters", response_model=list[MatterListItem], summary="列出事情")
async def list_matters(
    db: DbDep,
    user: CurrentUser,
    status_filter: str | None = Query(None, alias="status"),
    matter_type: str | None = Query(None),
    q: str | None = Query(None),
    limit: int = Query(80, ge=1, le=300),
    offset: int = Query(0, ge=0),
) -> list[MatterListItem]:
    return await governance_svc.list_matters(
        db,
        user=user,
        status=status_filter,
        matter_type=matter_type,
        q=q,
        limit=limit,
        offset=offset,
    )


@router.post(
    "/matters",
    response_model=MatterOut,
    status_code=status.HTTP_201_CREATED,
    summary="建立事情",
    dependencies=[GovernanceManagerDep],
)
async def create_matter(body: MatterCreate, db: DbDep, user: CurrentUser) -> Matter:
    matter = await governance_svc.create_matter(db, data=body, user=user)
    await audit_svc.record(
        db,
        entity_type="matter",
        entity_id=str(matter.id),
        action="matter.create",
        actor_id=str(user.id),
        actor_email=user.email,
        meta=body.model_dump(mode="json"),
        summary=f"建立事情：{matter.title}",
    )
    return await _matter_or_404(db, matter.id)


@router.get("/matters/{matter_id}", response_model=MatterOut, summary="取得事情中心")
async def get_matter(matter_id: uuid.UUID, db: DbDep, _: CurrentUser) -> Matter:
    return await _matter_or_404(db, matter_id)


@router.patch(
    "/matters/{matter_id}",
    response_model=MatterOut,
    summary="更新事情",
    dependencies=[GovernanceManagerDep],
)
async def update_matter(
    matter_id: uuid.UUID,
    body: MatterUpdate,
    db: DbDep,
    user: CurrentUser,
) -> Matter:
    matter = await _matter_or_404(db, matter_id)
    updated = await governance_svc.update_matter(db, matter=matter, data=body, user=user)
    await audit_svc.record(
        db,
        entity_type="matter",
        entity_id=str(updated.id),
        action="matter.update",
        actor_id=str(user.id),
        actor_email=user.email,
        meta=body.model_dump(mode="json", exclude_unset=True),
        summary=f"更新事情：{updated.title}",
    )
    return await _matter_or_404(db, updated.id)


@router.post(
    "/matters/{matter_id}/programs",
    response_model=ProgramOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增專案",
    dependencies=[GovernanceManagerDep],
)
async def create_program(
    matter_id: uuid.UUID,
    body: ProgramCreate,
    db: DbDep,
    user: CurrentUser,
) -> Program:
    matter = await _matter_or_404(db, matter_id)
    return await governance_svc.create_program(db, matter=matter, data=body, user=user)


@router.patch(
    "/programs/{program_id}",
    response_model=ProgramOut,
    summary="更新專案",
    dependencies=[GovernanceManagerDep],
)
async def update_program(
    program_id: uuid.UUID,
    body: ProgramUpdate,
    db: DbDep,
    user: CurrentUser,
) -> Program:
    program = await _program_or_404(db, program_id)
    return await governance_svc.update_program(db, program=program, data=body, user=user)


@router.post(
    "/matters/{matter_id}/cases",
    response_model=GovernanceCaseOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增案件",
    dependencies=[GovernanceManagerDep],
)
async def create_case(
    matter_id: uuid.UUID,
    body: GovernanceCaseCreate,
    db: DbDep,
    user: CurrentUser,
) -> GovernanceCase:
    matter = await _matter_or_404(db, matter_id)
    return await governance_svc.create_case(db, matter=matter, data=body, user=user)


@router.patch(
    "/cases/{case_id}",
    response_model=GovernanceCaseOut,
    summary="更新案件",
    dependencies=[GovernanceManagerDep],
)
async def update_case(
    case_id: uuid.UUID,
    body: GovernanceCaseUpdate,
    db: DbDep,
    user: CurrentUser,
) -> GovernanceCase:
    case = await _case_or_404(db, case_id)
    return await governance_svc.update_case(db, case=case, data=body, user=user)


@router.post(
    "/matters/{matter_id}/relations",
    response_model=EntityRelationOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增關聯資源",
    dependencies=[GovernanceManagerDep],
)
async def create_relation(
    matter_id: uuid.UUID,
    body: EntityRelationCreate,
    db: DbDep,
    user: CurrentUser,
) -> EntityRelationOut:
    matter = await _matter_or_404(db, matter_id)
    relation = await governance_svc.create_relation(db, matter=matter, data=body, user=user)
    return EntityRelationOut.model_validate(relation)


@router.get(
    "/links",
    response_model=list[MatterLinkRefOut],
    summary="反向查詢：某模組資源被哪些事情納入",
)
async def list_links_for_target(
    db: DbDep,
    _: CurrentUser,
    target_type: str = Query(..., min_length=1, max_length=50),
    target_id: uuid.UUID = Query(...),
) -> list[MatterLinkRefOut]:
    rows = await governance_svc.list_relations_for_target(
        db, target_type=target_type, target_id=target_id
    )
    return [
        MatterLinkRefOut(
            relation_id=relation.id,
            matter_id=matter.id,
            matter_title=matter.title,
            matter_status=str(matter.status),
            matter_progress=matter.progress_percent,
            relation=relation.relation,
            case_id=relation.case_id,
        )
        for relation, matter in rows
    ]


@router.get(
    "/entities/{entity_type}/{entity_id}/relations",
    response_model=list[EntityRelationOut],
    summary="列出任意模組實體的正反向關聯",
)
async def list_entity_relations(
    entity_type: str,
    entity_id: uuid.UUID,
    db: DbDep,
    _: CurrentUser,
) -> list[EntityRelationOut]:
    rows = await governance_svc.list_entity_relations(
        db, entity_type=entity_type, entity_id=entity_id
    )
    return [EntityRelationOut.model_validate(row) for row in rows]


@router.post(
    "/entities/{entity_type}/{entity_id}/relations",
    response_model=EntityRelationOut,
    status_code=status.HTTP_201_CREATED,
    summary="建立任意模組實體間的關聯",
    dependencies=[GovernanceManagerDep],
)
async def create_entity_relation(
    entity_type: str,
    entity_id: uuid.UUID,
    body: EntityRelationCreate,
    db: DbDep,
    user: CurrentUser,
) -> EntityRelationOut:
    relation = await governance_svc.create_entity_relation(
        db,
        source_type=entity_type,
        source_id=entity_id,
        data=body,
        user=user,
    )
    return EntityRelationOut.model_validate(relation)


@router.get(
    "/entities/{entity_type}/{entity_id}/graph",
    response_model=EntityRelationGraphOut,
    summary="取得跨模組關聯圖",
)
async def get_entity_relation_graph(
    entity_type: str,
    entity_id: uuid.UUID,
    db: DbDep,
    _: CurrentUser,
    depth: int = Query(2, ge=1, le=3),
) -> EntityRelationGraphOut:
    nodes, edges = await governance_svc.entity_relation_graph(
        db,
        entity_type=entity_type,
        entity_id=entity_id,
        depth=depth,
    )
    return EntityRelationGraphOut(
        nodes=[{"type": node["type"], "id": str(node["id"])} for node in nodes],
        edges=[EntityRelationOut.model_validate(edge) for edge in edges],
    )


@router.delete(
    "/relations/{relation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="移除關聯",
    dependencies=[GovernanceManagerDep],
)
async def delete_relation(relation_id: uuid.UUID, db: DbDep, user: CurrentUser) -> None:
    relation = await governance_svc.get_relation(db, relation_id)
    if relation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="關聯不存在")
    await governance_svc.delete_relation(db, relation=relation, user=user)


@router.post(
    "/matters/{matter_id}/spawn",
    response_model=MatterSpawnOut,
    status_code=status.HTTP_201_CREATED,
    summary="從事情建立並連動模組artifact（指揮中心）",
    dependencies=[GovernanceManagerDep],
)
async def spawn_artifact(
    matter_id: uuid.UUID,
    body: MatterSpawnIn,
    db: DbDep,
    user: CurrentUser,
) -> MatterSpawnOut:
    """在事情頁一鍵建立公告草稿／問卷／會議／任務，並自動回填 EntityRelation。

    讓 Matter 不只是觀察者，而是指揮中心：產出的 artifact 一出生就連動本事情，
    後續其生命週期事件（經 audit 橋接）會自動回流到事情時間軸。
    """
    from api.schemas.announcement import AnnouncementCreate
    from api.schemas.meeting import MeetingCreate
    from api.schemas.survey import SurveyCreate

    matter = await _matter_or_404(db, matter_id)
    org_id = body.org_id or matter.org_id
    title = body.title.strip()

    if body.kind == "task":
        item = await governance_svc.create_matter_task(
            db, matter=matter, data=WorkItemCreate(title=title), user=user
        )
        # 任務以 source_type=matter 連動，已顯示於任務面板，無需額外 EntityRelation。
        return MatterSpawnOut(kind="task", id=item.id, title=title, href="/tasks")

    if body.kind == "announcement":
        artifact = await announcement_svc.create(
            db, author=user, body=AnnouncementCreate(title=title, content={}, org_id=org_id)
        )
        target_type, href = "announcement", f"/announcements/{artifact.id}"
    elif body.kind == "survey":
        if org_id is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="建立問卷需先為事情設定負責組織",
            )
        artifact = await survey_svc.create_survey(
            db, data=SurveyCreate(title=title, org_id=org_id), created_by=user.id
        )
        target_type, href = "survey", f"/surveys/{artifact.id}"
    elif body.kind == "meeting":
        if org_id is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="建立會議需先為事情設定負責組織",
            )
        artifact = await meeting_svc.create_meeting(
            db, data=MeetingCreate(title=title, org_id=org_id), created_by=user.id
        )
        target_type, href = "meeting", f"/meetings/{artifact.id}"
    else:  # pragma: no cover - schema 已限制 kind
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不支援的建立類型")

    await governance_svc.create_relation(
        db,
        matter=matter,
        data=EntityRelationCreate(
            source_type="matter",
            source_id=matter.id,
            target_type=target_type,
            target_id=artifact.id,
            relation="includes",
            title=title,
            href=href,
            meta={"spawned_from_matter": True},
        ),
        user=user,
    )
    return MatterSpawnOut(kind=body.kind, id=artifact.id, title=title, href=href)


@router.post(
    "/matters/{matter_id}/events",
    response_model=TimelineEventOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增時間軸紀錄",
    dependencies=[GovernanceManagerDep],
)
async def create_timeline_event(
    matter_id: uuid.UUID,
    body: TimelineEventCreate,
    db: DbDep,
    user: CurrentUser,
) -> TimelineEventOut:
    matter = await _matter_or_404(db, matter_id)
    event = await governance_svc.create_timeline_event(db, matter=matter, data=body, user=user)
    return TimelineEventOut.model_validate(event)


@router.post(
    "/matters/{matter_id}/tasks",
    response_model=WorkItemOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增事情任務",
    dependencies=[GovernanceManagerDep],
)
async def create_matter_task(
    matter_id: uuid.UUID,
    body: WorkItemCreate,
    db: DbDep,
    user: CurrentUser,
) -> WorkItemOut:
    matter = await _matter_or_404(db, matter_id)
    item = await governance_svc.create_matter_task(db, matter=matter, data=body, user=user)
    return WorkItemOut.model_validate(item)


@router.get(
    "/matters/{matter_id}/tasks",
    response_model=list[WorkItemOut],
    summary="列出事情任務",
)
async def list_matter_tasks(
    matter_id: uuid.UUID,
    db: DbDep,
    _: CurrentUser,
    include_done: bool = Query(True),
) -> list[WorkItemOut]:
    await _matter_or_404(db, matter_id)
    rows = await work_item_svc.list_work_items_by_source(
        db,
        source_type="matter",
        source_id=matter_id,
        include_done=include_done,
    )
    return [WorkItemOut.model_validate(row) for row in rows]


@router.post(
    "/matters/{matter_id}/decisions",
    response_model=DecisionOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增決議",
    dependencies=[GovernanceManagerDep],
)
async def create_decision(
    matter_id: uuid.UUID,
    body: DecisionCreate,
    db: DbDep,
    user: CurrentUser,
) -> DecisionOut:
    matter = await _matter_or_404(db, matter_id)
    decision = await governance_svc.create_decision(db, matter=matter, data=body, user=user)
    return DecisionOut.model_validate(decision)


@router.patch(
    "/decisions/{decision_id}",
    response_model=DecisionOut,
    summary="更新決議",
    dependencies=[GovernanceManagerDep],
)
async def update_decision(
    decision_id: uuid.UUID,
    body: DecisionUpdate,
    db: DbDep,
    user: CurrentUser,
) -> DecisionOut:
    decision = await governance_svc.get_decision(db, decision_id)
    if decision is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="決議不存在")
    updated = await governance_svc.update_decision(db, decision=decision, data=body, user=user)
    return DecisionOut.model_validate(updated)


@router.post(
    "/matters/{matter_id}/planning-documents",
    response_model=PlanningDocumentOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增企劃書",
    dependencies=[GovernanceManagerDep],
)
async def create_planning_document(
    matter_id: uuid.UUID,
    body: PlanningDocumentCreate,
    db: DbDep,
    user: CurrentUser,
) -> PlanningDocumentOut:
    matter = await _matter_or_404(db, matter_id)
    document = await governance_svc.create_planning_document(
        db, matter=matter, data=body, user=user
    )
    refreshed = await governance_svc.get_planning_document(db, document.id)
    return PlanningDocumentOut.model_validate(refreshed or document)


@router.patch(
    "/planning-documents/{document_id}",
    response_model=PlanningDocumentOut,
    summary="更新企劃書",
    dependencies=[GovernanceManagerDep],
)
async def update_planning_document(
    document_id: uuid.UUID,
    body: PlanningDocumentUpdate,
    db: DbDep,
    user: CurrentUser,
) -> PlanningDocumentOut:
    document = await governance_svc.get_planning_document(db, document_id)
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="企劃書不存在")
    updated = await governance_svc.update_planning_document(
        db, document=document, data=body, user=user
    )
    refreshed = await governance_svc.get_planning_document(db, updated.id)
    return PlanningDocumentOut.model_validate(refreshed or updated)


@router.post(
    "/planning-documents/{document_id}/revisions",
    response_model=PlanningDocumentRevisionOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增企劃書版本",
    dependencies=[GovernanceManagerDep],
)
async def create_planning_revision(
    document_id: uuid.UUID,
    body: PlanningDocumentRevisionCreate,
    db: DbDep,
    user: CurrentUser,
) -> PlanningDocumentRevisionOut:
    document = await governance_svc.get_planning_document(db, document_id)
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="企劃書不存在")
    revision = await governance_svc.create_planning_revision(
        db, document=document, data=body, user=user
    )
    return PlanningDocumentRevisionOut.model_validate(revision)


@router.post(
    "/matters/{matter_id}/roles",
    response_model=MatterRoleAssignmentOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增事情組織職務",
    dependencies=[GovernanceManagerDep],
)
async def create_role_assignment(
    matter_id: uuid.UUID,
    body: MatterRoleAssignmentCreate,
    db: DbDep,
    user: CurrentUser,
) -> MatterRoleAssignmentOut:
    matter = await _matter_or_404(db, matter_id)
    assignment = await governance_svc.create_role_assignment(
        db, matter=matter, data=body, user=user
    )
    return MatterRoleAssignmentOut.model_validate(assignment)


@router.patch(
    "/roles/{assignment_id}",
    response_model=MatterRoleAssignmentOut,
    summary="更新事情組織職務",
    dependencies=[GovernanceManagerDep],
)
async def update_role_assignment(
    assignment_id: uuid.UUID,
    body: MatterRoleAssignmentUpdate,
    db: DbDep,
    user: CurrentUser,
) -> MatterRoleAssignmentOut:
    assignment = await governance_svc.get_role_assignment(db, assignment_id)
    if assignment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="職務不存在")
    updated = await governance_svc.update_role_assignment(
        db, assignment=assignment, data=body, user=user
    )
    return MatterRoleAssignmentOut.model_validate(updated)


@router.get(
    "/workflow-templates",
    response_model=list[GovernanceWorkflowTemplateOut],
    summary="列出流程模板",
)
async def list_workflow_templates(db: DbDep, _: CurrentUser) -> list:
    return await governance_svc.list_workflow_templates(db)


@router.post(
    "/workflow-templates",
    response_model=GovernanceWorkflowTemplateOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增流程模板",
    dependencies=[GovernanceManagerDep],
)
async def create_workflow_template(
    body: GovernanceWorkflowTemplateCreate,
    db: DbDep,
    user: CurrentUser,
) -> GovernanceWorkflowTemplateOut:
    template = await governance_svc.create_workflow_template(db, data=body, user=user)
    return GovernanceWorkflowTemplateOut.model_validate(template)


@router.get(
    "/automation-rules",
    response_model=list[AutomationRuleOut],
    summary="列出自動化規則",
)
async def list_automation_rules(
    db: DbDep,
    _: CurrentUser,
    matter_id: uuid.UUID | None = Query(None),
) -> list:
    return await governance_svc.list_automation_rules(db, matter_id=matter_id)


@router.get(
    "/automation-meta",
    summary="自動化規則編輯器選項（觸發/動作/實體型別）",
)
async def get_automation_meta(_: CurrentUser) -> dict:
    return {
        "trigger_types": governance_ingest.TRIGGER_TYPES,
        "action_types": governance_ingest.ACTION_TYPES,
        "entity_types": governance_ingest.ENTITY_LABEL,
    }


@router.post(
    "/automation-rules",
    response_model=AutomationRuleOut,
    status_code=status.HTTP_201_CREATED,
    summary="新增自動化規則",
    dependencies=[GovernanceManagerDep],
)
async def create_automation_rule(
    body: AutomationRuleCreate,
    db: DbDep,
    user: CurrentUser,
) -> AutomationRuleOut:
    rule = await governance_svc.create_automation_rule(db, data=body, user=user)
    return AutomationRuleOut.model_validate(rule)


@router.patch(
    "/automation-rules/{rule_id}",
    response_model=AutomationRuleOut,
    summary="更新自動化規則（含啟用／暫停）",
    dependencies=[GovernanceManagerDep],
)
async def update_automation_rule(
    rule_id: uuid.UUID,
    body: AutomationRuleUpdate,
    db: DbDep,
    user: CurrentUser,
) -> AutomationRuleOut:
    rule = await governance_svc.get_automation_rule(db, rule_id)
    if rule is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="自動化規則不存在")
    updated = await governance_svc.update_automation_rule(db, rule=rule, data=body, user=user)
    return AutomationRuleOut.model_validate(updated)
