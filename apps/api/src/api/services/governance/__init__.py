"""事情導向治理中樞 service

結構：
  _events.py   - 時間軸事件 / 任務 / 決議
  _matter.py   - 事情 / 專案 / 案件 CRUD
  _relations.py - 實體關聯 / 跨模組圖譜
  _planning.py - 企劃書 / 職務 / 工作流 / 自動化 / 儀表板
"""

from api.services.governance._events import (
    create_decision,
    create_matter_task,
    create_timeline_event,
    get_decision,
    record_event,
    update_decision,
)
from api.services.governance._matter import (
    create_case,
    create_matter,
    create_matter_resource,
    create_program,
    delete_matter_resource,
    get_case,
    get_matter,
    get_matter_by_slug,
    get_matter_resource,
    get_program,
    list_matters,
    update_case,
    update_matter,
    update_matter_resource,
    update_program,
)
from api.services.governance._planning import (
    attachment_is_referenced,
    create_automation_rule,
    create_planning_document,
    create_planning_revision,
    create_role_assignment,
    create_workflow_template,
    dashboard,
    get_automation_rule,
    get_planning_attachment,
    get_planning_document,
    get_role_assignment,
    list_automation_rules,
    list_workflow_templates,
    update_automation_rule,
    update_planning_document,
    update_role_assignment,
)
from api.services.governance._relations import (
    create_entity_relation,
    create_relation,
    delete_relation,
    entity_relation_graph,
    get_relation,
    list_entity_relations,
    list_relations_for_target,
)

__all__ = [
    # events
    "record_event",
    "create_timeline_event",
    "create_matter_task",
    "create_decision",
    "get_decision",
    "update_decision",
    # matter
    "list_matters",
    "get_matter",
    "get_matter_by_slug",
    "create_matter",
    "update_matter",
    "create_matter_resource",
    "get_matter_resource",
    "update_matter_resource",
    "delete_matter_resource",
    "create_program",
    "update_program",
    "get_program",
    "create_case",
    "get_case",
    "update_case",
    # relations
    "create_relation",
    "create_entity_relation",
    "list_entity_relations",
    "entity_relation_graph",
    "list_relations_for_target",
    "get_relation",
    "delete_relation",
    # planning
    "create_planning_document",
    "get_planning_document",
    "update_planning_document",
    "create_planning_revision",
    "get_planning_attachment",
    "attachment_is_referenced",
    "create_role_assignment",
    "get_role_assignment",
    "update_role_assignment",
    "create_workflow_template",
    "list_workflow_templates",
    "create_automation_rule",
    "list_automation_rules",
    "get_automation_rule",
    "update_automation_rule",
    "dashboard",
]
