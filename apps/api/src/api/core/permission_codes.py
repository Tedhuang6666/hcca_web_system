"""系統權限碼定義與驗證工具。"""

from __future__ import annotations

from enum import StrEnum


class PermissionCode(StrEnum):
    ADMIN_ALL = "admin:all"
    ADMIN_USERS = "admin:users"
    SYSTEM_MAINTENANCE_BYPASS = "system:maintenance_bypass"
    SYSTEM_TRASH_VIEW = "system:trash_view"
    SYSTEM_LIFECYCLE = "system:lifecycle"
    SYSTEM_PRIVACY = "system:privacy"
    SYSTEM_TERM_ROLLOVER = "system:term_rollover"
    SYSTEM_USER_LIFECYCLE = "system:user_lifecycle"
    SYSTEM_REPORTS = "system:reports"
    AUDIT_VIEW_ORG = "audit:view_org"
    AUDIT_VIEW_ALL = "audit:view_all"
    AUDIT_VIEW = "audit:view"

    ACTIVITY_MANAGE = "activity:manage"
    ACTIVITY_APPOINT = "activity:appoint"

    ORG_MANAGE = "org:manage"
    ORG_MANAGE_POSITIONS = "org:manage_positions"
    ORG_MANAGE_MEMBERS = "org:manage_members"
    ORG_VIEW_MEMBERS = "org:view_members"
    ORG_EDIT_PREFIX = "org:edit_prefix"

    DOCUMENT_CREATE = "document:create"
    DOCUMENT_DRAFT = "document:draft"
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

    SEATING_MANAGE = "seating:manage"
    SEATING_ASSIGN = "seating:assign"

    CLASS_MANAGE = "class:manage"
    CLASS_VIEW_MEMBERS = "class:view_members"
    CLASS_MANAGE_MEMBERS = "class:manage_members"
    CLASS_MANAGE_ROLES = "class:manage_roles"
    CLASS_SHOP_COLLECT = "class:shop_collect"
    CLASS_SHOP_CLOSE = "class:shop_close"
    CLASS_MEAL_COLLECT = "class:meal_collect"
    CLASS_MEAL_CLOSE = "class:meal_close"
    CLASS_MEAL_PICKUP = "class:meal_pickup"

    ANNOUNCEMENT_CREATE = "announcement:create"
    ANNOUNCEMENT_PUBLISH = "announcement:publish"
    ANNOUNCEMENT_EDIT = "announcement:edit"
    ANNOUNCEMENT_SET_URGENT = "announcement:set_urgent"
    ANNOUNCEMENT_MEDIA_MANAGE = "announcement:media_manage"
    ANNOUNCEMENT_VIEW_STATS = "announcement:view_stats"
    ANNOUNCEMENT_PUBLIC_LIST = "announcement:public_list"
    ANNOUNCEMENT_PUBLIC_DETAIL = "announcement:public_detail"
    ANNOUNCEMENT_PUBLIC_LAYOUT = "announcement:public_layout"

    ANALYTICS_VIEW = "analytics:view"
    GOVERNANCE_MANAGE = "governance:manage"
    ELECTION_MANAGE = "election:manage"

    EMAIL_SEND = "email:send"
    EMAIL_SEND_BULK = "email:send_bulk"
    EMAIL_VIEW_LOGS = "email:view_logs"
    EMAIL_TEMPLATE_MANAGE = "email:template_manage"

    EXAM_MANAGE = "exam:manage"
    EXAM_DOWNLOAD = "exam:download"

    MEETING_CREATE = "meeting:create"
    MEETING_MANAGE = "meeting:manage"
    MEETING_CHAIR = "meeting:chair"
    MEETING_VOTE = "meeting:vote"
    MEETING_VIEW_ALL = "meeting:view_all"
    MEETING_EXPORT = "meeting:export"

    COUNCIL_PROPOSAL_MANAGE = "council_proposal:manage"
    JUDICIAL_PETITION_MANAGE = "judicial_petition:manage"

    CALENDAR_CREATE = "calendar:create"
    CALENDAR_MANAGE = "calendar:manage"
    CALENDAR_VIEW_ALL = "calendar:view_all"
    CALENDAR_ADMIN = "calendar:admin"

    PARTNER_MAP_MANAGE = "partner_map:manage"
    PARTNER_MAP_VIEW_STATS = "partner_map:view_stats"

    SITE_MANAGE = "site:manage"

    # Phase B1 / D2（企業級升級路線圖、ADR-003 / ADR-005 / Phase D2）
    POLICY_ADMIN = "policy:admin"
    API_KEY_ADMIN = "api_key:admin"
    WEBHOOK_ADMIN = "webhook:admin"
    # Phase C3 客服工具
    ADMIN_IMPERSONATE = "admin:impersonate"
    # Phase D3 Feature flags
    FEATURE_FLAG_ADMIN = "feature_flag:admin"


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
        "code": PermissionCode.SYSTEM_MAINTENANCE_BYPASS,
        "label": "忽略維護模式",
        "desc": "維護模式啟用時仍可進入網站與使用非公開功能",
    },
    {
        "group": "系統管理",
        "code": PermissionCode.SYSTEM_TRASH_VIEW,
        "label": "誤刪救援檢視",
        "desc": "查看最近 N 天 audit log 中的刪除事件以利還原協調",
    },
    {
        "group": "系統管理",
        "code": PermissionCode.SYSTEM_LIFECYCLE,
        "label": "資料生命週期管理",
        "desc": "執行批次壓縮歸檔與清理（notification / outbox / audit_log 等）",
    },
    {
        "group": "系統管理",
        "code": PermissionCode.SYSTEM_PRIVACY,
        "label": "個資匯出與假名化",
        "desc": "處理當事人個資請求：匯出全部資料、假名化（保留 audit 痕跡）",
    },
    {
        "group": "系統管理",
        "code": PermissionCode.SYSTEM_TERM_ROLLOVER,
        "label": "換屆精靈",
        "desc": "批次轉移任期、結束舊一屆、建立新一屆；支援 dry-run 與 rollback",
    },
    {
        "group": "系統管理",
        "code": PermissionCode.SYSTEM_USER_LIFECYCLE,
        "label": "學籍異動",
        "desc": "凍結 / 校友歸檔 / 恢復個別使用者；保留 audit 痕跡",
    },
    {
        "group": "系統管理",
        "code": PermissionCode.SYSTEM_REPORTS,
        "label": "預寫常用報表",
        "desc": "執行平台預設的 10 個查詢報表並匯出 CSV",
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
        "group": "活動系統",
        "code": PermissionCode.ACTIVITY_MANAGE,
        "label": "管理活動",
        "desc": "建立、編輯、封存活動基本資料",
    },
    {
        "group": "活動系統",
        "code": PermissionCode.ACTIVITY_APPOINT,
        "label": "任命活動總召",
        "desc": "指派、調整與卸任活動總召任期",
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
        "label": "發起公文",
        "desc": "代表本組織發起公文流程，可送審由部門最高權限者發出",
    },
    {
        "group": "公文系統",
        "code": PermissionCode.DOCUMENT_DRAFT,
        "label": "草擬公文",
        "desc": "代本組織建立與編輯公文草稿，不包含正式送審或發文",
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
        "desc": "管理主題 / 系列 / 商品 / 變體、庫存與上下架",
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
        "group": "商品系統",
        "code": PermissionCode.SEATING_MANAGE,
        "label": "管理劃位",
        "desc": "建立場次座位圖、設定分批開放時段與座位",
    },
    {
        "group": "商品系統",
        "code": PermissionCode.SEATING_ASSIGN,
        "label": "代為劃位",
        "desc": "依到場順序為已購票者指定座位（管理員代劃）",
    },
    {
        "group": "班級管理",
        "code": PermissionCode.CLASS_MANAGE,
        "label": "管理班級",
        "desc": "建立 / 編輯班級、設定學號區間、指定幹部、逐年重設班級",
    },
    {
        "group": "班級管理",
        "code": PermissionCode.CLASS_VIEW_MEMBERS,
        "label": "查看本班成員",
        "desc": "查看任職班級的名冊與訂購彙整",
    },
    {
        "group": "班級管理",
        "code": PermissionCode.CLASS_MEAL_PICKUP,
        "label": "本班學餐領取",
        "desc": "取得本班同商家同時段的班級領取碼並處理領餐",
    },
    {
        "group": "班級管理",
        "code": PermissionCode.CLASS_MEAL_COLLECT,
        "label": "本班學餐收款",
        "desc": "標示本班學餐訂單收款狀態",
    },
    {
        "group": "班級管理",
        "code": PermissionCode.CLASS_SHOP_COLLECT,
        "label": "本班商品收款",
        "desc": "標示本班商品訂單收款狀態",
    },
    {
        "group": "班級管理",
        "code": PermissionCode.CLASS_MANAGE_MEMBERS,
        "label": "管理本班成員",
        "desc": "維護任職班級的名冊",
    },
    {
        "group": "班級管理",
        "code": PermissionCode.CLASS_MANAGE_ROLES,
        "label": "管理本班職位",
        "desc": "任命或調整任職班級的職位",
    },
    {
        "group": "班級管理",
        "code": PermissionCode.CLASS_SHOP_CLOSE,
        "label": "本班商品結單",
        "desc": "處理本班商品結單彙整",
    },
    {
        "group": "班級管理",
        "code": PermissionCode.CLASS_MEAL_CLOSE,
        "label": "本班學餐結單",
        "desc": "處理本班學餐結單彙整",
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
        "group": "公告系統",
        "code": PermissionCode.ANNOUNCEMENT_PUBLIC_LIST,
        "label": "管理公開公告列表",
        "desc": "調整對外公告列表頁的分類、排序與呈現規則",
    },
    {
        "group": "公告系統",
        "code": PermissionCode.ANNOUNCEMENT_PUBLIC_DETAIL,
        "label": "管理公開公告詳情",
        "desc": "調整對外公告詳情頁的顯示欄位、分享資訊與版面",
    },
    {
        "group": "公告系統",
        "code": PermissionCode.ANNOUNCEMENT_PUBLIC_LAYOUT,
        "label": "管理公開公告版面",
        "desc": "管理公開公告頁的 SEO、導覽入口與視覺設定",
    },
    {
        "group": "數據分析",
        "code": PermissionCode.ANALYTICS_VIEW,
        "label": "查看數據分析",
        "desc": "查看公文效率統計、部門排名與待辦警告",
    },
    {
        "group": "治理中樞",
        "code": PermissionCode.GOVERNANCE_MANAGE,
        "label": "管理事情治理",
        "desc": "建立與維護 Matter / Program / Case、任務與跨模組關聯",
    },
    {
        "group": "即時開票",
        "code": PermissionCode.ELECTION_MANAGE,
        "label": "管理即時開票",
        "desc": "建立選舉、控制票匭狀態、記票、更正與鎖定結果",
    },
    {
        "group": "通知與郵件",
        "code": PermissionCode.EMAIL_SEND,
        "label": "寄送 Email（個別）",
        "desc": "透過平台寄送 Email 給個別使用者",
    },
    {
        "group": "通知與郵件",
        "code": PermissionCode.EMAIL_SEND_BULK,
        "label": "批次寄送 Email",
        "desc": "對特定職位、機關全體成員或全平台批次寄送 Email",
    },
    {
        "group": "通知與郵件",
        "code": PermissionCode.EMAIL_VIEW_LOGS,
        "label": "查看寄信紀錄",
        "desc": "查看所有寄信稽核紀錄與實際收件清單",
    },
    {
        "group": "通知與郵件",
        "code": PermissionCode.EMAIL_TEMPLATE_MANAGE,
        "label": "管理組織郵件範本",
        "desc": "建立、修改與停用所屬組織共享的郵件範本與名單",
    },
    {
        "group": "段考題庫",
        "code": PermissionCode.EXAM_MANAGE,
        "label": "管理段考題庫",
        "desc": "上傳、編輯、上下架段考題 PDF，並查看下載追蹤紀錄",
    },
    {
        "group": "段考題庫",
        "code": PermissionCode.EXAM_DOWNLOAD,
        "label": "下載段考題",
        "desc": "下載段考題 PDF；校內成員亦可下載已上架題目",
    },
    {
        "group": "議事系統",
        "code": PermissionCode.MEETING_CREATE,
        "label": "建立會議",
        "desc": "建立議會會議與基本門檻設定",
    },
    {
        "group": "議事系統",
        "code": PermissionCode.MEETING_MANAGE,
        "label": "管理議程與出席",
        "desc": "管理議程、出列席、投影大屏與現場名冊",
    },
    {
        "group": "議事系統",
        "code": PermissionCode.MEETING_CHAIR,
        "label": "主席場控",
        "desc": "開始/暫停/結束會議，開啟與關閉現場表決",
    },
    {
        "group": "議事系統",
        "code": PermissionCode.MEETING_VOTE,
        "label": "議員表決",
        "desc": "列入預設表決權名冊並可在現場投票",
    },
    {
        "group": "議事系統",
        "code": PermissionCode.MEETING_VIEW_ALL,
        "label": "查看所有會議",
        "desc": "跨組織查看會議資料",
    },
    {
        "group": "議事系統",
        "code": PermissionCode.MEETING_EXPORT,
        "label": "匯出會議紀錄",
        "desc": "查看會後紀錄、匯出或轉成公文草稿",
    },
    {
        "group": "議事系統",
        "code": PermissionCode.COUNCIL_PROPOSAL_MANAGE,
        "label": "管理議會提案",
        "desc": "審查議會提案、記錄常委審查與排入議程狀態",
    },
    {
        "group": "評議委員會",
        "code": PermissionCode.JUDICIAL_PETITION_MANAGE,
        "label": "管理評議聲請",
        "desc": "收案、審查與更新評議委員會訴訟或法規範審查聲請",
    },
    {
        "group": "行事曆",
        "code": PermissionCode.CALENDAR_CREATE,
        "label": "建立行程",
        "desc": "建立活動、準備、彩排、他校會議與截止日",
    },
    {
        "group": "行事曆",
        "code": PermissionCode.CALENDAR_MANAGE,
        "label": "管理行程",
        "desc": "管理本平台行事曆事件、參與者、準備清單與關聯連結",
    },
    {
        "group": "行事曆",
        "code": PermissionCode.CALENDAR_VIEW_ALL,
        "label": "查看組織行程",
        "desc": "跨組織查看組織可見的行事曆事件",
    },
    {
        "group": "行事曆",
        "code": PermissionCode.CALENDAR_ADMIN,
        "label": "行事曆管理員",
        "desc": "跨組織查看與管理所有行事曆事件",
    },
    {
        "group": "特約地圖",
        "code": PermissionCode.PARTNER_MAP_MANAGE,
        "label": "管理特約地圖",
        "desc": "建立/修改/刪除特約店家、點位、標籤與優惠",
    },
    {
        "group": "特約地圖",
        "code": PermissionCode.PARTNER_MAP_VIEW_STATS,
        "label": "查看特約地圖統計",
        "desc": "查看特約店家點擊、瀏覽與互動統計（預留）",
    },
    {
        "group": "公開網站",
        "code": PermissionCode.SITE_MANAGE,
        "label": "管理公開網站",
        "desc": "管理官網首頁、公開頁面、平台連結與公開幹部顯示設定",
    },
    # ── 企業級升級（Phase B1 / D2 / C3 / D3）──────────────────────────
    {
        "group": "企業級治理",
        "code": PermissionCode.POLICY_ADMIN,
        "label": "政策版本管理",
        "desc": "建立 / 編輯 / 啟用隱私政策、ToS、無障礙等公開政策版本（ADR-003）",
    },
    {
        "group": "企業級治理",
        "code": PermissionCode.API_KEY_ADMIN,
        "label": "API Key 管理",
        "desc": "發行、查詢、撤銷對外整合用的 API Key（限管理員、有完整審計）",
    },
    {
        "group": "企業級治理",
        "code": PermissionCode.WEBHOOK_ADMIN,
        "label": "Webhook 管理",
        "desc": "建立 / 編輯 / 刪除事件投遞訂閱與檢視投遞紀錄",
    },
    {
        "group": "企業級治理",
        "code": PermissionCode.ADMIN_IMPERSONATE,
        "label": "代理登入（客服）",
        "desc": "以目標使用者身分檢視介面（read-only、有時效、完整 audit log）",
    },
    {
        "group": "企業級治理",
        "code": PermissionCode.FEATURE_FLAG_ADMIN,
        "label": "Feature Flag 管理",
        "desc": "管理新功能灰度開關、依角色 / 比例切流量",
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
