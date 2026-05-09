"""系統權限碼定義與驗證工具。"""

from __future__ import annotations

from enum import StrEnum


class PermissionCode(StrEnum):
    ADMIN_ALL = "admin:all"
    ADMIN_USERS = "admin:users"
    AUDIT_VIEW_ORG = "audit:view_org"
    AUDIT_VIEW_ALL = "audit:view_all"
    AUDIT_VIEW = "audit:view"

    ORG_MANAGE = "org:manage"
    ORG_MANAGE_POSITIONS = "org:manage_positions"
    ORG_MANAGE_MEMBERS = "org:manage_members"
    ORG_VIEW_MEMBERS = "org:view_members"
    ORG_EDIT_PREFIX = "org:edit_prefix"

    DOCUMENT_CREATE = "document:create"
    DOCUMENT_EDIT = "document:edit"
    DOCUMENT_DELETE = "document:delete"
    DOCUMENT_SUBMIT = "document:submit"
    DOCUMENT_RECALL = "document:recall"
    DOCUMENT_APPROVE = "document:approve"
    DOCUMENT_REJECT = "document:reject"
    DOCUMENT_FORWARD = "document:forward"
    DOCUMENT_ISSUE = "document:issue"
    DOCUMENT_ISSUE_DIRECT = "document:issue_direct"
    DOCUMENT_ARCHIVE = "document:archive"
    DOCUMENT_EXPORT = "document:export"
    DOCUMENT_VIEW_ALL = "document:view_all"
    DOCUMENT_ADMIN = "document:admin"

    SERIAL_CREATE = "serial:create"
    SERIAL_EDIT = "serial:edit"
    SERIAL_EDIT_PREFIX = "serial:edit_prefix"
    SERIAL_DELETE = "serial:delete"
    SERIAL_VIEW_ALL = "serial:view_all"

    REGULATION_CREATE = "regulation:create"
    REGULATION_EDIT = "regulation:edit"
    REGULATION_DELETE = "regulation:delete"
    REGULATION_MANAGE_ARTICLES = "regulation:manage_articles"
    REGULATION_PUBLISH = "regulation:publish"
    REGULATION_UNPUBLISH = "regulation:unpublish"
    REGULATION_ARCHIVE = "regulation:archive"
    REGULATION_EXPORT = "regulation:export"
    REGULATION_VIEW_ALL = "regulation:view_all"
    REGULATION_ADMIN = "regulation:admin"

    REGULATION_SUBMIT = "regulation:submit"
    REGULATION_SCHEDULE = "regulation:schedule"
    REGULATION_COUNCIL_APPROVE = "regulation:council_approve"
    REGULATION_PRESIDENT_PUBLISH = "regulation:president_publish"

    MEAL_MANAGE = "meal:manage"
    MEAL_MANAGE_SCHEDULE = "meal:manage_schedule"
    MEAL_CONFIRM_ORDER = "meal:confirm_order"
    MEAL_COMPLETE_ORDER = "meal:complete_order"
    MEAL_EXPORT = "meal:export"

    SURVEY_CREATE = "survey:create"
    SURVEY_MANAGE = "survey:manage"
    SURVEY_VIEW_ALL = "survey:view_all"
    SURVEY_ADMIN = "survey:admin"

    PETITION_TYPE_MANAGE = "petition:type_manage"
    PETITION_VIEW_ORG = "petition:view_org"
    PETITION_ASSIGN = "petition:assign"
    PETITION_HANDLE = "petition:handle"
    PETITION_TRANSFER = "petition:transfer"
    PETITION_VIEW_ALL = "petition:view_all"
    PETITION_ANALYTICS_ORG = "petition:analytics_org"
    PETITION_ANALYTICS_ALL = "petition:analytics_all"
    PETITION_ADMIN = "petition:admin"

    SHOP_MANAGE = "shop:manage"
    SHOP_MANAGE_ORDERS = "shop:manage_orders"
    SHOP_VIEW_ALL = "shop:view_all"
    FINANCE_VIEW = "finance:view"

    ANNOUNCEMENT_CREATE = "announcement:create"
    ANNOUNCEMENT_PUBLISH = "announcement:publish"
    ANNOUNCEMENT_EDIT = "announcement:edit"
    ANNOUNCEMENT_SET_URGENT = "announcement:set_urgent"
    ANNOUNCEMENT_MEDIA_MANAGE = "announcement:media_manage"
    ANNOUNCEMENT_VIEW_STATS = "announcement:view_stats"

    ANALYTICS_VIEW = "analytics:view"


ALL_PERMISSION_CODES: list[dict[str, str]] = [
    {
        "group": "系統管理",
        "code": PermissionCode.ADMIN_ALL,
        "label": "系統管理員",
        "desc": "最高權限，跳過所有 RBAC，可存取全部功能",
    },
    {
        "group": "系統管理",
        "code": PermissionCode.ADMIN_USERS,
        "label": "使用者管理",
        "desc": "建立/修改使用者帳號、指派職位",
    },
    {
        "group": "系統管理",
        "code": PermissionCode.AUDIT_VIEW_ORG,
        "label": "查看本組織稽核日誌",
        "desc": "查看目前任期所屬組織內的操作軌跡",
    },
    {
        "group": "系統管理",
        "code": PermissionCode.AUDIT_VIEW_ALL,
        "label": "查看所有稽核日誌",
        "desc": "查看全站所有操作軌跡與稽核事件",
    },
    {
        "group": "組織管理",
        "code": PermissionCode.ORG_MANAGE,
        "label": "管理組織",
        "desc": "新增/修改/刪除組織節點",
    },
    {
        "group": "組織管理",
        "code": PermissionCode.ORG_MANAGE_POSITIONS,
        "label": "管理職位",
        "desc": "在本組織下新增/修改/刪除職位",
    },
    {
        "group": "組織管理",
        "code": PermissionCode.ORG_MANAGE_MEMBERS,
        "label": "管理成員",
        "desc": "指派/移除本組織成員任期",
    },
    {
        "group": "組織管理",
        "code": PermissionCode.ORG_VIEW_MEMBERS,
        "label": "查看成員",
        "desc": "查看本組織成員列表（唯讀）",
    },
    {
        "group": "組織管理",
        "code": PermissionCode.ORG_EDIT_PREFIX,
        "label": "更改組織前稱",
        "desc": "修改字號模板中的組織前稱（org_prefix）",
    },
    {
        "group": "公文系統",
        "code": PermissionCode.DOCUMENT_CREATE,
        "label": "起草公文",
        "desc": "建立公文草稿（限本組織）",
    },
    {
        "group": "公文系統",
        "code": PermissionCode.DOCUMENT_EDIT,
        "label": "編輯公文",
        "desc": "修改草稿內容、附件（限本組織）",
    },
    {
        "group": "公文系統",
        "code": PermissionCode.DOCUMENT_DELETE,
        "label": "刪除草稿",
        "desc": "刪除尚未送審的公文草稿",
    },
    {
        "group": "公文系統",
        "code": PermissionCode.DOCUMENT_SUBMIT,
        "label": "送審公文",
        "desc": "將草稿提交至審核流程",
    },
    {
        "group": "公文系統",
        "code": PermissionCode.DOCUMENT_RECALL,
        "label": "撤回公文",
        "desc": "從審核中撤回至草稿",
    },
    {
        "group": "公文系統",
        "code": PermissionCode.DOCUMENT_APPROVE,
        "label": "核准公文",
        "desc": "核准審核中的公文（限同組織發文）",
    },
    {
        "group": "公文系統",
        "code": PermissionCode.DOCUMENT_REJECT,
        "label": "退回公文",
        "desc": "退件審核中的公文（限同組織發文）",
    },
    {
        "group": "公文系統",
        "code": PermissionCode.DOCUMENT_FORWARD,
        "label": "轉呈公文",
        "desc": "將公文手動轉呈給下一層主管審核",
    },
    {
        "group": "公文系統",
        "code": PermissionCode.DOCUMENT_ISSUE,
        "label": "正式發文",
        "desc": "最終核准後正式發出（產生字號、蓋章）",
    },
    {
        "group": "公文系統",
        "code": PermissionCode.DOCUMENT_ISSUE_DIRECT,
        "label": "逕行發文",
        "desc": "跳過審核流程直接發文（機關首長使用）",
    },
    {
        "group": "公文系統",
        "code": PermissionCode.DOCUMENT_ARCHIVE,
        "label": "歸檔公文",
        "desc": "封存已核准的公文",
    },
    {
        "group": "公文系統",
        "code": PermissionCode.DOCUMENT_EXPORT,
        "label": "匯出公文",
        "desc": "列印或匯出公文為 PDF",
    },
    {
        "group": "公文系統",
        "code": PermissionCode.DOCUMENT_VIEW_ALL,
        "label": "跨組織查閱公文",
        "desc": "查看所有組織的公文（唯讀）",
    },
    {
        "group": "公文系統",
        "code": PermissionCode.DOCUMENT_ADMIN,
        "label": "公文管理員",
        "desc": "跨組織操作、強制封存任意公文",
    },
    {
        "group": "字號系統",
        "code": PermissionCode.SERIAL_CREATE,
        "label": "新增字號模板",
        "desc": "在本組織下建立新字號模板",
    },
    {
        "group": "字號系統",
        "code": PermissionCode.SERIAL_EDIT,
        "label": "修改字號設定",
        "desc": "修改字號字元、年度模式等一般設定",
    },
    {
        "group": "字號系統",
        "code": PermissionCode.SERIAL_EDIT_PREFIX,
        "label": "修改組織前稱",
        "desc": "修改字號模板的 org_prefix（較敏感）",
    },
    {
        "group": "字號系統",
        "code": PermissionCode.SERIAL_DELETE,
        "label": "停用字號模板",
        "desc": "停用/刪除字號模板",
    },
    {
        "group": "字號系統",
        "code": PermissionCode.SERIAL_VIEW_ALL,
        "label": "跨組織查閱字號",
        "desc": "查看所有組織的字號模板",
    },
    {
        "group": "法規系統",
        "code": PermissionCode.REGULATION_CREATE,
        "label": "起草法規",
        "desc": "建立法規草稿（限本組織）",
    },
    {
        "group": "法規系統",
        "code": PermissionCode.REGULATION_EDIT,
        "label": "編輯法規",
        "desc": "修改草稿內容與條文結構",
    },
    {
        "group": "法規系統",
        "code": PermissionCode.REGULATION_DELETE,
        "label": "刪除草稿",
        "desc": "刪除尚未發布的法規草稿",
    },
    {
        "group": "法規系統",
        "code": PermissionCode.REGULATION_MANAGE_ARTICLES,
        "label": "管理條文結構",
        "desc": "新增/修改/刪除章節條文（獨立於全文編輯）",
    },
    {
        "group": "法規系統",
        "code": PermissionCode.REGULATION_PUBLISH,
        "label": "發布法規",
        "desc": "將草稿正式發布（限本組織）",
    },
    {
        "group": "法規系統",
        "code": PermissionCode.REGULATION_UNPUBLISH,
        "label": "撤銷發布",
        "desc": "將已發布法規改回草稿狀態",
    },
    {
        "group": "法規系統",
        "code": PermissionCode.REGULATION_ARCHIVE,
        "label": "停用法規",
        "desc": "將現行法規停用（保留歷史）",
    },
    {
        "group": "法規系統",
        "code": PermissionCode.REGULATION_EXPORT,
        "label": "匯出法規",
        "desc": "列印或匯出法規為 PDF",
    },
    {
        "group": "法規系統",
        "code": PermissionCode.REGULATION_VIEW_ALL,
        "label": "跨組織查閱法規",
        "desc": "查看所有組織法規（唯讀）",
    },
    {
        "group": "法規系統",
        "code": PermissionCode.REGULATION_ADMIN,
        "label": "法規管理員",
        "desc": "跨組織強制停用任意法規",
    },
    {
        "group": "法規審議",
        "code": PermissionCode.REGULATION_SUBMIT,
        "label": "送審法規",
        "desc": "將草稿送交議會審議",
    },
    {
        "group": "法規審議",
        "code": PermissionCode.REGULATION_SCHEDULE,
        "label": "排入議程",
        "desc": "排定法規審議議程（書記官）",
    },
    {
        "group": "法規審議",
        "code": PermissionCode.REGULATION_COUNCIL_APPROVE,
        "label": "議會核定",
        "desc": "議長代表議會核定法案",
    },
    {
        "group": "法規審議",
        "code": PermissionCode.REGULATION_PRESIDENT_PUBLISH,
        "label": "主席公布",
        "desc": "主席正式公布法規",
    },
    {
        "group": "學餐系統",
        "code": PermissionCode.MEAL_MANAGE,
        "label": "學餐完整管理",
        "desc": "管理商家/菜單（含以下所有學餐權限）",
    },
    {
        "group": "學餐系統",
        "code": PermissionCode.MEAL_MANAGE_SCHEDULE,
        "label": "管理排程",
        "desc": "僅建立/修改/結單排程（不含商家/菜單）",
    },
    {
        "group": "學餐系統",
        "code": PermissionCode.MEAL_CONFIRM_ORDER,
        "label": "確認訂單",
        "desc": "將 pending 訂單改為 confirmed",
    },
    {
        "group": "學餐系統",
        "code": PermissionCode.MEAL_COMPLETE_ORDER,
        "label": "完成訂單",
        "desc": "將 confirmed 訂單改為 completed（核銷）",
    },
    {
        "group": "學餐系統",
        "code": PermissionCode.MEAL_EXPORT,
        "label": "匯出報表",
        "desc": "下載訂單/領餐名單 Excel",
    },
    {
        "group": "問卷系統",
        "code": PermissionCode.SURVEY_CREATE,
        "label": "建立問卷",
        "desc": "建立並設計問卷題目",
    },
    {
        "group": "問卷系統",
        "code": PermissionCode.SURVEY_MANAGE,
        "label": "管理問卷",
        "desc": "開放/關閉填答、查看分析結果",
    },
    {
        "group": "問卷系統",
        "code": PermissionCode.SURVEY_VIEW_ALL,
        "label": "查看所有回覆",
        "desc": "查看含匿名問卷的全部回覆資料",
    },
    {
        "group": "問卷系統",
        "code": PermissionCode.SURVEY_ADMIN,
        "label": "問卷管理員",
        "desc": "停用/刪除任意問卷",
    },
    {
        "group": "陳情系統",
        "code": PermissionCode.PETITION_TYPE_MANAGE,
        "label": "管理陳情類型",
        "desc": "設定陳情類型、啟用狀態與預設負責機關",
    },
    {
        "group": "陳情系統",
        "code": PermissionCode.PETITION_VIEW_ORG,
        "label": "查看本機關陳情",
        "desc": "查看目前任期所屬機關的陳情案件與公開處理事件",
    },
    {
        "group": "陳情系統",
        "code": PermissionCode.PETITION_ASSIGN,
        "label": "陳情分案",
        "desc": "將本機關陳情案件指派給內部承辦人",
    },
    {
        "group": "陳情系統",
        "code": PermissionCode.PETITION_HANDLE,
        "label": "處理陳情",
        "desc": "回覆、退回補件、結案、不受理與新增內部備註",
    },
    {
        "group": "陳情系統",
        "code": PermissionCode.PETITION_TRANSFER,
        "label": "轉派陳情",
        "desc": "將陳情案件轉派至其他負責機關",
    },
    {
        "group": "陳情系統",
        "code": PermissionCode.PETITION_VIEW_ALL,
        "label": "跨機關查看陳情",
        "desc": "議會或管理單位查看所有機關的陳情案件",
    },
    {
        "group": "陳情系統",
        "code": PermissionCode.PETITION_ANALYTICS_ORG,
        "label": "查看本機關陳情統計",
        "desc": "查看本機關處理件數、完成數與平均處理時間",
    },
    {
        "group": "陳情系統",
        "code": PermissionCode.PETITION_ANALYTICS_ALL,
        "label": "查看全機關陳情統計",
        "desc": "議會查看各機關處理件數、完成數與平均處理時間",
    },
    {
        "group": "陳情系統",
        "code": PermissionCode.PETITION_ADMIN,
        "label": "陳情系統管理員",
        "desc": "跨機關管理陳情案件、類型與完整內部紀錄",
    },
    {
        "group": "商品系統",
        "code": PermissionCode.SHOP_MANAGE,
        "label": "管理商品",
        "desc": "管理商品庫存、上下架",
    },
    {
        "group": "商品系統",
        "code": PermissionCode.SHOP_MANAGE_ORDERS,
        "label": "管理訂單",
        "desc": "查看/取消所有訂單",
    },
    {
        "group": "商品系統",
        "code": PermissionCode.SHOP_VIEW_ALL,
        "label": "查看所有訂單",
        "desc": "財務用，唯讀查看所有訂單",
    },
    {
        "group": "商品系統",
        "code": PermissionCode.FINANCE_VIEW,
        "label": "財務查閱",
        "desc": "查看財務報表與統計",
    },
    {
        "group": "公告系統",
        "code": PermissionCode.ANNOUNCEMENT_CREATE,
        "label": "建立公告",
        "desc": "建立公告（可立即發布或存為草稿）",
    },
    {
        "group": "公告系統",
        "code": PermissionCode.ANNOUNCEMENT_PUBLISH,
        "label": "發布公告",
        "desc": "將公告草稿發布或取消發布",
    },
    {
        "group": "公告系統",
        "code": PermissionCode.ANNOUNCEMENT_EDIT,
        "label": "編輯公告",
        "desc": "修改公告內容、發布狀態、緊急標籤",
    },
    {
        "group": "公告系統",
        "code": PermissionCode.ANNOUNCEMENT_SET_URGENT,
        "label": "設定緊急",
        "desc": "標記公告為緊急或修改緊急時限",
    },
    {
        "group": "公告系統",
        "code": PermissionCode.ANNOUNCEMENT_MEDIA_MANAGE,
        "label": "管理媒體",
        "desc": "上傳、刪除公告附加的媒體檔案",
    },
    {
        "group": "公告系統",
        "code": PermissionCode.ANNOUNCEMENT_VIEW_STATS,
        "label": "查看公告統計",
        "desc": "查看公告閱讀率與參與統計",
    },
    {
        "group": "數據分析",
        "code": PermissionCode.ANALYTICS_VIEW,
        "label": "查看數據分析",
        "desc": "查看公文效率統計、部門排名與待辦警告",
    },
]

KNOWN_PERMISSION_CODES: frozenset[str] = frozenset(
    item["code"] for item in ALL_PERMISSION_CODES
) | {
    PermissionCode.AUDIT_VIEW,
}


def validate_permission_codes(codes: list[str]) -> list[str]:
    """回傳未知的權限碼清單（已排序且去重）。"""
    return sorted({code for code in codes if code not in KNOWN_PERMISSION_CODES})
