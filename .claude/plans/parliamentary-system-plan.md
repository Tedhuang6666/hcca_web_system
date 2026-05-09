# 學生自治數位議會平台 — 完整系統規劃 v2.1

> **文件性質**：Production-grade 系統設計文件  
> **適用系統**：新竹高中學生議會 / 學生自治組織  
> **基礎架構**：現有 HCCA 平台（FastAPI + SQLAlchemy + Next.js 16）  
> **更新日期**：2026-05-08（v2.1：細粒權限、客製化、簡化發言、投影顯示）

---

## 目錄

1. [系統定位與目標](#一系統定位與目標)
2. [整體模組地圖](#二整體模組地圖)
3. [整合現有系統](#三整合現有系統)
4. [模組設計](#四模組設計)
   - M1 屆期與任期系統
   - M2 會議系統
   - M3 議程系統（可客製化）
   - M4 出席與簽到系統
   - M5 發言系統（純佇列）
   - M6 議會投票系統（可客製化）
   - M7 選舉系統（可客製化）
   - M8 財務預算系統
   - M9 法規三讀審議（擴充現有）
5. [完整資料庫設計](#五完整資料庫設計)
6. [API 端點設計](#六api-端點設計)
7. [完整權限矩陣](#七完整權限矩陣)
8. [即時通訊設計](#八即時通訊設計)
9. [UI/UX 設計規格](#九uiux-設計規格)
10. [後端工程結構](#十後端工程結構)
11. [前端工程結構](#十一前端工程結構)
12. [安全性設計](#十二安全性設計)
13. [部署架構](#十三部署架構)
14. [開發里程碑](#十四開發里程碑)

---

## 一、系統定位與目標

### 1.1 系統定性

| 領域 | 對標系統 | 本系統實現 |
|------|---------|-----------|
| 財務管理 | 政府預算 ERP | 預算提報 → 議會審理 → 決算核銷 |
| 議事系統 | 立法院議事系統 | 三讀程序、發言佇列、表決 |
| 法規管理 | 法規資料庫 + Git | 條文版本、修法審議 |
| 選舉系統 | 電子投票系統 | 候選人管理、電子投票、開票 |
| 工作流引擎 | GitHub PR + Jira | 狀態機、審核流程、版本追蹤 |
| 投影顯示 | 現場大螢幕顯示 | 開會/選舉/出席即時投影頁 |

### 1.2 核心設計原則

```
制度透明  ─ 所有決策過程公開可查
可追溯性  ─ 每個動作都有完整歷程
不可竄改  ─ 版本快照、審計日誌不可刪改
權限明確  ─ RBAC 最細粒度，每個小步驟均可獨立授權
最大客製  ─ 議程/投票/選舉皆可由管理員完整設定
真實議會  ─ 法定人數、表決門檻、屆期任期
```

### 1.3 使用者角色總覽

| 角色 | 議會職稱 | 核心權限 |
|------|---------|---------|
| 一般議員 | 議員 | 提案、投票、簽到、發言登記 |
| 部門幹部 | 部長/召委 | 部門審核、委員會主持 |
| 財務部 | 財務長 | 預算審核、決算管理 |
| 議會幹部 | 正副議長 | 主持院會、議程管理 |
| 行政首長 | 學生會主席 | 行政核定、法規公布 |
| 秘書長 | 秘書長 | 會議紀錄、文書管理 |
| 選委會 | 選委 | 選舉管理 |
| 系統管理員 | — | 全系統管理 |

---

## 二、整體模組地圖

```
┌─────────────────────────────────────────────────────────────────────┐
│                    HCCA 學生自治數位議會平台                           │
├─────────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │  M1 屆期系統  │  │  M2 會議系統  │  │  M3 議程系統  │              │
│  │  term/session│  │  meeting mgmt│  │  客製化議程   │              │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘              │
│  ┌──────┴───────┐  ┌──────┴───────┐  ┌──────┴───────┐              │
│  │  M4 簽到系統  │  │  M5 發言佇列  │  │  M6 投票系統  │              │
│  │  attendance  │  │  純序列/排隊  │  │  客製化表決   │              │
│  └──────────────┘  └──────────────┘  └──────────────┘              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │  M7 選舉系統  │  │  M8 財務系統  │  │  M9 法規三讀  │              │
│  │  客製化選舉   │  │  budget/ERP  │  │  3-readings  │              │
│  └──────────────┘  └──────────────┘  └──────────────┘              │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  M10 投影顯示頁（Display Page）— 開會/選舉/出席即時大螢幕      │   │
│  └─────────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────┤
│              現有基礎模組（已完成，直接整合）                           │
│  公文 │ 法規 │ 公告 │ 問卷 │ 通知 │ 審計 │ 陳情 │ WebSocket          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 三、整合現有系統

### 3.1 直接複用（零修改）

| 現有模組 | 整合用途 |
|---------|---------|
| `User` + `Org` + `Position` + `UserPosition` | 議員身份、任期驗證基礎 |
| `AuditLog` | 所有新模組操作自動寫入 |
| `Notification` + `create_notification()` | 所有議會通知統一發送 |
| `WebSocket` (`ws_manager`) | 投票同步、簽到同步、即時議程 |
| `Document` 系統 | 會議紀錄公文化、法規公布令 |
| `StorageBackend` | 議程附件、候選人政見上傳 |

### 3.2 擴充現有模組

#### 法規系統擴充

```
DRAFT → UNDER_REVIEW → SCHEDULED →
FIRST_READING → COMMITTEE_REVIEW → SECOND_READING → THIRD_READING →
COUNCIL_APPROVED → PUBLISHED
```

新增 `Regulation` 欄位：`meeting_id`, `reading_count`, `committee_org_id`

#### 通知類型擴充

```python
"meeting_scheduled"       # 新會議排定
"meeting_starting"        # 會議即將開始（15分鐘前）
"sign_in_open"            # 簽到開放
"vote_open"               # 投票開放
"vote_result"             # 投票結果
"budget_status_changed"   # 預算案狀態變更
"amendment_proposed"      # 新修正案提出
"election_open"           # 選舉開始
"regulation_reading"      # 法規進入某讀次
```

### 3.3 完整 Permission Codes（最細粒度）

> **設計原則**：每個可獨立授權的動作都有對應代碼，角色由 Position 的 Permission 組合決定，管理員可自由調整。

```python
# ── 屆期系統 ────────────────────────────────────────────
TERM_CREATE               = "term:create"
TERM_EDIT                 = "term:edit"
TERM_CLOSE                = "term:close"
TERM_SESSION_CREATE       = "term:session_create"
TERM_SESSION_EDIT         = "term:session_edit"
TERM_VIEW_PRIVATE         = "term:view_private"

# ── 會議系統 ────────────────────────────────────────────
MEETING_CREATE            = "meeting:create"
MEETING_EDIT              = "meeting:edit"
MEETING_DELETE            = "meeting:delete"
MEETING_START             = "meeting:start"           # 宣布開會
MEETING_END               = "meeting:end"             # 宣布散會
MEETING_ARCHIVE           = "meeting:archive"
MEETING_PRESIDE           = "meeting:preside"         # 主持（含以下步驟）
MEETING_SET_QUORUM        = "meeting:set_quorum"      # 設定法定人數
MEETING_SET_PRESIDER      = "meeting:set_presider"    # 指定主持人
MEETING_SET_SECRETARY     = "meeting:set_secretary"   # 指定秘書
MEETING_GENERATE_MINUTES  = "meeting:generate_minutes"
MEETING_VIEW_PRIVATE      = "meeting:view_private"    # 查看私人會議
MEETING_VIEW_ALL          = "meeting:view_all"

# ── 議程系統 ────────────────────────────────────────────
AGENDA_CREATE             = "agenda:create"
AGENDA_EDIT               = "agenda:edit"
AGENDA_DELETE             = "agenda:delete"
AGENDA_REORDER            = "agenda:reorder"           # 拖曳重排
AGENDA_ACTIVATE           = "agenda:activate"          # 設為當前議程
AGENDA_COMPLETE           = "agenda:complete"          # 完成議程
AGENDA_DEFER              = "agenda:defer"             # 延後審理
AGENDA_WITHDRAW           = "agenda:withdraw"          # 撤回
AGENDA_ADD_ATTACHMENT     = "agenda:add_attachment"
AGENDA_LINK_ITEM          = "agenda:link_item"         # 連結預算/法規/選舉
AGENDA_SET_RESOLUTION     = "agenda:set_resolution"    # 填寫決議
AGENDA_SET_TIME_LIMIT     = "agenda:set_time_limit"    # 設定討論時限
AGENDA_MANAGE_TYPES       = "agenda:manage_types"      # 新增/修改自訂議程類型

# ── 出席系統 ────────────────────────────────────────────
ATTENDANCE_OPEN_SIGNIN    = "attendance:open_signin"
ATTENDANCE_CLOSE_SIGNIN   = "attendance:close_signin"
ATTENDANCE_MANUAL_RECORD  = "attendance:manual_record" # 人工出席登記
ATTENDANCE_OVERRIDE       = "attendance:override"      # 修改出席狀態
ATTENDANCE_APPROVE_LEAVE  = "attendance:approve_leave" # 核准請假
ATTENDANCE_VIEW_ALL       = "attendance:view_all"
ATTENDANCE_EXPORT         = "attendance:export"

# ── 發言系統（純佇列） ──────────────────────────────────
SPEECH_REGISTER           = "speech:register"          # 自行登記發言
SPEECH_REGISTER_FOR_OTHER = "speech:register_for_other"# 代為登記
SPEECH_OPEN_QUEUE         = "speech:open_queue"        # 開放登記
SPEECH_CLOSE_QUEUE        = "speech:close_queue"       # 關閉登記
SPEECH_START              = "speech:start"             # 叫號開始發言
SPEECH_SKIP               = "speech:skip"              # 跳過
SPEECH_END_SPEECH         = "speech:end_speech"        # 結束發言
SPEECH_CLEAR_QUEUE        = "speech:clear_queue"       # 清空佇列
SPEECH_REORDER            = "speech:reorder"           # 調整順序
SPEECH_SET_TIME_LIMIT     = "speech:set_time_limit"    # 設定時間限制

# ── 投票系統 ────────────────────────────────────────────
VOTE_CREATE               = "vote:create"
VOTE_EDIT                 = "vote:edit"                # 編輯（DRAFT）
VOTE_DELETE               = "vote:delete"
VOTE_SET_TYPE             = "vote:set_type"            # 記名/不記名
VOTE_SET_THRESHOLD        = "vote:set_threshold"       # 設定通過門檻
VOTE_SET_CHOICES          = "vote:set_choices"         # 自訂選項
VOTE_SET_DURATION         = "vote:set_duration"        # 設定投票時限
VOTE_SET_LIVE_COUNT       = "vote:set_live_count"      # 設定是否即時顯示計票
VOTE_OPEN                 = "vote:open"
VOTE_CLOSE                = "vote:close"
VOTE_CAST                 = "vote:cast"
VOTE_TALLY                = "vote:tally"               # 結算
VOTE_ANNOUNCE             = "vote:announce"            # 公布結果
VOTE_VOID                 = "vote:void"                # 廢止表決
VOTE_VIEW_NAMED_RESULTS   = "vote:view_named_results"  # 查看記名投票明細

# ── 選舉系統 ────────────────────────────────────────────
ELECTION_CREATE           = "election:create"
ELECTION_EDIT_SETTINGS    = "election:edit_settings"
ELECTION_SET_ELIGIBILITY  = "election:set_eligibility" # 設定投票資格（班級/職位）
ELECTION_SET_SEATS        = "election:set_seats"       # 設定席次
ELECTION_SET_BALLOT_TYPE  = "election:set_ballot_type" # 單選/多選/排序
ELECTION_SET_TIMELINE     = "election:set_timeline"    # 設定報名/投票時間
ELECTION_SET_DISPLAY      = "election:set_display"     # 設定投影顯示選項
ELECTION_OPEN_REGISTRATION= "election:open_registration"
ELECTION_CLOSE_REGISTRATION="election:close_registration"
ELECTION_REVIEW_CANDIDATE = "election:review_candidate"# 審查資格
ELECTION_DISQUALIFY       = "election:disqualify"      # 取消資格
ELECTION_OPEN_VOTING      = "election:open_voting"
ELECTION_CLOSE_VOTING     = "election:close_voting"
ELECTION_TALLY            = "election:tally"           # 開票
ELECTION_ANNOUNCE         = "election:announce"        # 公告結果
ELECTION_VOID_BALLOT      = "election:void_ballot"
ELECTION_CANDIDATE        = "election:candidate"       # 自行報名參選
ELECTION_VOTE             = "election:vote"

# ── 財務預算系統 ────────────────────────────────────────
BUDGET_CREATE             = "budget:create"
BUDGET_EDIT_OWN           = "budget:edit_own"
BUDGET_EDIT_ANY           = "budget:edit_any"
BUDGET_SUBMIT             = "budget:submit"
BUDGET_RECALL             = "budget:recall"
BUDGET_DEPT_REVIEW_APPROVE= "budget:dept_review_approve"
BUDGET_DEPT_REVIEW_REJECT = "budget:dept_review_reject"
BUDGET_FINANCE_REVIEW_APPROVE="budget:finance_review_approve"
BUDGET_FINANCE_REVIEW_REJECT ="budget:finance_review_reject"
BUDGET_EXEC_APPROVE       = "budget:exec_approve"
BUDGET_EXEC_REJECT        = "budget:exec_reject"
BUDGET_LEGISLATIVE        = "budget:legislative"       # 議員審議（查看+表決）
BUDGET_AMEND_PROPOSE      = "budget:amend_propose"     # 提修正案
BUDGET_AMEND_REVIEW       = "budget:amend_review"      # 審查修正案
BUDGET_VOTE               = "budget:vote"              # 預算表決
BUDGET_SETTLE             = "budget:settle"
BUDGET_SETTLE_APPROVE     = "budget:settle_approve"
BUDGET_VIEW_ALL           = "budget:view_all"
BUDGET_EXPORT             = "budget:export"
BUDGET_ADMIN              = "budget:admin"

EXPENDITURE_CREATE        = "expenditure:create"
EXPENDITURE_EDIT_OWN      = "expenditure:edit_own"
EXPENDITURE_APPROVE       = "expenditure:approve"
EXPENDITURE_REJECT        = "expenditure:reject"
EXPENDITURE_UPLOAD_RECEIPT= "expenditure:upload_receipt"
EXPENDITURE_VIEW_ALL      = "expenditure:view_all"
FINANCE_MANAGE            = "finance:manage"

# ── 法規三讀系統 ────────────────────────────────────────
REGULATION_ASSIGN_COMMITTEE  = "regulation:assign_committee"
REGULATION_COMMITTEE_REPORT  = "regulation:committee_report"
REGULATION_ADVANCE_READING   = "regulation:advance_reading"
REGULATION_VOTE_SECOND       = "regulation:vote_second"
REGULATION_VOTE_THIRD        = "regulation:vote_third"
REGULATION_COUNCIL_APPROVE   = "regulation:council_approve"
REGULATION_PRESIDENT_PUBLISH = "regulation:president_publish"

# ── 投影顯示頁 ──────────────────────────────────────────
DISPLAY_MANAGE            = "display:manage"           # 設定顯示內容/模式

# ── 分析系統 ─────────────────────────────────────────────
ANALYTICS_VIEW            = "analytics:view"
ANALYTICS_LEGISLATIVE     = "analytics:legislative"
```

---

## 四、模組設計

---

### M1：屆期與任期系統

```python
class Term(Base, TimestampMixin):
    __tablename__ = "terms"
    id: UUID (PK)
    term_number: int             # 75
    name: str                    # "第75屆學生議會"
    start_date: date
    end_date: date
    status: TermStatus           # preparing / active / closed
    fiscal_year_id: UUID | None
    description: str | None
    created_by: UUID

class TermSession(Base, TimestampMixin):
    __tablename__ = "term_sessions"
    id: UUID (PK)
    term_id: UUID
    session_number: int
    session_type: SessionType    # regular / extraordinary
    start_date: date
    end_date: date
    description: str | None
```

---

### M2：會議系統

#### 會議狀態機

```
scheduled → preparing → open → in_progress → closed → archived
```

#### 核心 Model

```python
class MeetingType(StrEnum):
    PLENARY = "plenary"
    EXTRAORDINARY = "extraordinary"
    COMMITTEE = "committee"
    COORDINATION = "coordination"
    PUBLIC_HEARING = "public_hearing"
    LEGISLATION = "legislation"
    BUDGET_REVIEW = "budget_review"

class Meeting(Base, TimestampMixin):
    __tablename__ = "meetings"
    id: UUID (PK)
    term_id: UUID
    session_id: UUID | None
    title: str
    meeting_type: MeetingType
    venue: str
    scheduled_at: datetime
    started_at: datetime | None
    ended_at: datetime | None
    status: MeetingStatus
    presider_id: UUID
    secretary_id: UUID | None
    quorum: int
    total_members: int
    minutes_document_id: UUID | None
    is_public: bool
    note: str | None
```

---

### M3：議程系統（可客製化）

#### 議程類型系統

議程類型支援**完全客製化**，系統提供預設類型，有 `agenda:manage_types` 權限者可新增/停用/修改順序。

```python
class AgendaTypeDefinition(Base, TimestampMixin):
    """自訂議程類型（可由管理員新增）"""
    __tablename__ = "agenda_type_definitions"
    id: UUID (PK)
    code: str                  # "report" / "discussion" / 自訂 code
    label: str                 # 顯示名稱（中文）
    sort_order: int
    is_system: bool            # 系統預設，不可刪除
    is_active: bool
    default_time_limit_minutes: int | None
    requires_vote: bool        # 此類型議程是否通常需要表決


class MeetingAgenda(Base, TimestampMixin):
    __tablename__ = "meeting_agendas"
    id: UUID (PK)
    meeting_id: UUID
    parent_id: UUID | None      # 巢狀議程
    sort_index: int
    display_number: str         # "二(一)"
    title: str
    agenda_type_code: str       # FK→agenda_type_definitions.code
    proposer_id: UUID | None
    summary: str | None
    status: AgendaStatus
    time_limit_minutes: int | None  # 可覆蓋預設時限
    linked_budget_id: UUID | None
    linked_regulation_id: UUID | None
    linked_election_id: UUID | None
    linked_document_id: UUID | None
    resolution: str | None
    vote_result_id: UUID | None
```

---

### M4：出席與簽到系統

```python
class SignInSession(Base, TimestampMixin):
    __tablename__ = "sign_in_sessions"
    id: UUID (PK)
    meeting_id: UUID
    code: str                    # 6位代碼（已雜湊）
    qr_payload: str              # HMAC 簽名 payload
    valid_from: datetime
    valid_until: datetime
    is_active: bool
    created_by: UUID
    late_threshold_minutes: int  # 幾分鐘後算遲到（可設定）

class Attendance(Base, TimestampMixin):
    __tablename__ = "attendances"
    __table_args__ = (UniqueConstraint("meeting_id", "user_id"),)
    id: UUID (PK)
    meeting_id: UUID
    user_id: UUID
    status: AttendanceStatus     # present/late/absent/leave/attending
    sign_in_at: datetime | None
    sign_in_method: str          # "qr" / "code" / "manual"
    sign_in_session_id: UUID | None
    ip_address: str | None
    user_agent: str | None
    leave_reason: str | None
    note: str | None
```

---

### M5：發言系統（純佇列）

> **v2.1 簡化**：只保留序列排隊功能。無發言紀錄、無逐字稿、無摘要。計時僅在前端顯示，不持久化。

```python
class SpeechStatus(StrEnum):
    WAITING = "waiting"
    SPEAKING = "speaking"
    COMPLETED = "completed"
    SKIPPED = "skipped"
    WITHDRAWN = "withdrawn"


class SpeechQueue(Base, TimestampMixin):
    """發言排隊（一名議員登記一次為一筆）"""
    __tablename__ = "speech_queues"
    id: UUID (PK)
    meeting_id: UUID          # FK→meetings
    agenda_id: UUID | None    # FK→meeting_agendas
    speaker_id: UUID          # FK→users
    queue_order: int          # 排隊序號（主持人可調整）
    registered_at: datetime
    status: SpeechStatus
    speech_type: str          # "question" / "comment" / "motion" / "reply"
    is_point_of_order: bool   # 程序問題（優先插隊）
    time_limit_seconds: int | None  # 此次發言時間限制（可個別設定）
```

#### 業務邏輯

- 主持人呼叫 `speech:start` → 狀態改為 `speaking`，WebSocket 推送叫號
- 計時只由前端管理（`SpeechTimer` 元件），不寫回後端
- 超時時前端發出警告音，主持人手動呼叫 `speech:end_speech`
- `is_point_of_order = true` 時插隊至當前發言者之後第一位

---

### M6：議會投票系統（可客製化）

#### 高度客製化表決設定

```python
class VoteType(StrEnum):
    NAMED = "named"            # 記名
    ANONYMOUS = "anonymous"    # 不記名
    SHOW_OF_HANDS = "hands"    # 舉手（人工輸入）
    ROLL_CALL = "roll_call"    # 點名

class ThresholdType(StrEnum):
    SIMPLE_MAJORITY = "simple"        # 普通多數（>50% 出席者）
    ABSOLUTE_MAJORITY = "absolute"    # 絕對多數（>50% 全體）
    TWO_THIRDS = "two_thirds"         # 特別多數（≥2/3）
    THREE_QUARTERS = "three_quarters" # ≥3/4（修憲用）
    CUSTOM_COUNT = "custom_count"     # 自訂票數（如 3 票通過）
    CUSTOM_PERCENT = "custom_percent" # 自訂百分比


class VoteMotion(Base, TimestampMixin):
    __tablename__ = "vote_motions"
    id: UUID (PK)
    meeting_id: UUID
    agenda_id: UUID | None
    title: str
    description: str | None
    vote_type: VoteType
    threshold_type: ThresholdType
    custom_threshold_value: float | None  # 搭配 CUSTOM_COUNT/PERCENT 使用
    quorum_required: int
    eligible_voters: int                  # 建立時快照
    status: VoteMotionStatus
    # ── 客製化選項 ──────────────────────
    choices: list[str]          # JSONB，預設 ["yes","no","abstain"]，可自訂如 ["方案A","方案B","棄權"]
    time_limit_seconds: int | None  # 自動關閉計時（None = 不限）
    show_live_count: bool           # 投票中是否顯示即時計票（預設 false）
    reveal_named_after_close: bool  # 記名投票結束後揭露名單（預設 true）
    allow_change_before_close: bool # 是否允許投票前更改（預設 false）
    result_note: str | None
    created_by: UUID
    opened_at: datetime | None
    closed_at: datetime | None


class VoteSession(Base, TimestampMixin):
    """投票統計結果（by choice 計數）"""
    __tablename__ = "vote_sessions"
    id: UUID (PK)
    motion_id: UUID
    tally: dict                 # JSONB: {"yes": 12, "no": 3, "abstain": 2} 或自訂
    total_cast: int
    total_eligible: int
    result: str                 # "passed" / "failed" / "invalid"
    tallied_by: UUID
    tallied_at: datetime


class BallotRecord(Base, TimestampMixin):
    """記名投票明細"""
    __tablename__ = "ballot_records"
    __table_args__ = (UniqueConstraint("motion_id", "voter_id"),)
    id: UUID (PK)
    motion_id: UUID
    voter_id: UUID
    choice: str                 # 對應 VoteMotion.choices 中的值
    voted_at: datetime
```

---

### M7：選舉系統（可客製化）

#### 完全客製化選舉設定

```python
class ElectionType(StrEnum):
    SPEAKER = "speaker"
    DEPUTY_SPEAKER = "deputy_speaker"
    COMMITTEE_CHAIR = "committee_chair"
    JUDICIAL = "judicial"
    CUSTOM = "custom"           # 完全自訂，所有設定由管理員決定


class Election(Base, TimestampMixin):
    __tablename__ = "elections"
    id: UUID (PK)
    term_id: UUID
    meeting_id: UUID | None
    election_type: ElectionType
    title: str
    description: str | None
    status: ElectionStatus

    # ── 基本規則（可客製） ──────────────
    max_choices: int                    # 每張選票最多選幾人
    seats: int                          # 應選席次
    is_anonymous: bool                  # 不記名
    is_ranked: bool                     # 排序投票

    # ── 投票資格（可客製） ──────────────
    eligible_position_ids: list[UUID]   # JSONB：指定職位
    eligible_org_ids: list[UUID]        # JSONB：指定組織（空=全部）
    eligible_user_ids: list[UUID]       # JSONB：白名單（空=依上方條件）

    # ── 時間軸（可客製） ────────────────
    registration_start: datetime
    registration_end: datetime
    voting_start: datetime
    voting_end: datetime

    # ── 候選人設定（可客製） ───────────
    require_statement: bool             # 是否需要政見
    statement_sections: list[dict]      # JSONB：[{"title":"個人理念","max_len":300}]
    min_statement_length: int           # 最少字數
    max_statement_length: int | None

    # ── 顯示設定（投影頁用，可客製） ─────
    show_live_progress_by_group: bool   # 顯示哪幾班/組已投票
    progress_group_by: str              # "class" / "org" / "position"
    show_vote_count_during_voting: bool # 投票中是否顯示即時票數（預設 false）
    result_announcement_delay_minutes: int  # 開票後幾分鐘才顯示結果（0=立即）

    # ── 其他 ────────────────────────────
    tiebreaker_rule: str                # "redraw" / "joint_elected" / "revote"
    created_by: UUID


class Candidate(Base, TimestampMixin):
    __tablename__ = "candidates"
    id: UUID (PK)
    election_id: UUID
    user_id: UUID
    number: int
    statement: dict             # JSONB：對應 statement_sections
    status: CandidateStatus     # pending/qualified/disqualified/withdrawn
    disqualify_reason: str | None
    reviewed_by: UUID | None
    reviewed_at: datetime | None


class ElectionBallot(Base, TimestampMixin):
    __tablename__ = "election_ballots"
    __table_args__ = (UniqueConstraint("election_id", "voter_id"),)
    id: UUID (PK)
    election_id: UUID
    voter_id: UUID | None        # 不記名時為 null
    ballot_token: str            # HMAC token（不記名防重複）
    voted_at: datetime
    is_void: bool


class ElectionBallotChoice(Base, TimestampMixin):
    __tablename__ = "election_ballot_choices"
    id: UUID (PK)
    ballot_id: UUID
    candidate_id: UUID
    preference_rank: int | None


class ElectionResult(Base, TimestampMixin):
    __tablename__ = "election_results"
    id: UUID (PK)
    election_id: UUID
    candidate_id: UUID
    vote_count: int
    is_elected: bool
    rank: int
    announced_at: datetime
    announced_by: UUID
```

#### 投影顯示進度分組邏輯

```python
# 按 progress_group_by 計算哪幾個 group 已完成投票
# "class"    → 從 UserPosition.org_id 取各班，計算每班已/未投票人數
# "org"      → 按組織樹分組
# "position" → 按職位分組
```

---

### M8：財務預算系統

> 詳細設計見前版。**v2.1 移除** `budget_comments`（即時留言），改由議程下的 `resolution` 欄位記錄決議。

#### 核心 Tables（移除留言）

```
fiscal_years          會計年度
budgets               預算案（含狀態機）
budget_items          預算項目（樹狀）
budget_versions       版本快照（不可變）
budget_workflow_logs  狀態轉移歷程
amendments            修正案（含金額增減）
amendment_votes       修正案投票
expenditures          支出申請
expenditure_receipts  核銷附件
settlements           決算記錄
settlement_items      決算明細比較
```

**移除** `budget_comments`（即時留言功能已刪除）

---

### M9：法規三讀審議（擴充現有）

```python
class RegulationReadingLog(Base, TimestampMixin):
    __tablename__ = "regulation_reading_logs"
    id: UUID (PK)
    regulation_id: UUID
    regulation_version_id: UUID | None
    reading_stage: str           # "first" / "committee" / "second" / "third"
    meeting_id: UUID | None
    agenda_id: UUID | None
    vote_session_id: UUID | None
    result: str | None
    note: str | None
    recorded_by: UUID
```

---

### M10：投影顯示頁（Display Page）

#### 設計目標

提供一個**無需登入**（或簡單 token）的全螢幕顯示頁，專為開會時投影至大螢幕使用。

#### 顯示模式

| 模式 | 觸發時機 | 顯示內容 |
|------|---------|---------|
| `meeting` | 會議進行中 | 當前議程、發言佇列、投票狀態 |
| `vote` | 投票開放時 | 動議標題、即時計票（若啟用）、倒計時 |
| `vote_result` | 投票結算後 | 結果動畫、贊成/反對/棄權票數 |
| `election` | 選舉進行中 | 候選人列表、哪幾班/組已投票進度 |
| `election_result` | 選舉開票後 | 當選名單、得票動畫 |
| `attendance` | 簽到開放時 | 即時出席名單、已到/未到人數 |
| `idle` | 無活動 | 屆期資訊、Logo |

#### API（公開端點，無 Auth 要求）

```
GET /display/current                  取得當前顯示狀態（由 ws_manager 決定）
GET /display/meeting/{id}/live        會議即時資訊
GET /display/election/{id}/progress   選舉投票進度（依分組顯示哪些已投票）
GET /display/election/{id}/results    選舉結果（延遲公告後才有資料）
GET /display/attendance/{meeting_id}  出席即時清單
```

#### 選舉進度 Response 格式

```json
{
  "election_id": "uuid",
  "title": "第75屆議長選舉",
  "status": "voting",
  "total_eligible": 30,
  "total_voted": 17,
  "groups": [
    { "label": "101班", "eligible": 2, "voted": 2, "completed": true },
    { "label": "102班", "eligible": 2, "voted": 1, "completed": false },
    { "label": "103班", "eligible": 2, "voted": 0, "completed": false }
  ],
  "show_vote_count": false
}
```

---

## 五、完整資料庫設計

### 5.1 Table 清單總覽

| 分類 | Table 名稱 | 說明 |
|------|-----------|------|
| **現有** | users, orgs, positions, permissions, user_positions | RBAC 基礎 |
| **現有** | documents, document_approvals, document_revisions | 公文系統 |
| **現有** | regulations, regulation_articles, regulation_revisions | 法規系統 |
| **現有** | audit_logs, notifications, outbox_events | 基礎設施 |
| **現有** | announcements, surveys, petitions | 功能模組 |
| **M1 新增** | terms, term_sessions | 屆期系統 |
| **M2 新增** | meetings | 會議 |
| **M3 新增** | agenda_type_definitions, meeting_agendas, agenda_attachments | 議程 |
| **M4 新增** | sign_in_sessions, attendances | 出席 |
| **M5 新增** | speech_queues | 發言佇列（無紀錄表） |
| **M6 新增** | vote_motions, vote_sessions, ballot_records | 投票 |
| **M7 新增** | elections, candidates, election_ballots, election_ballot_choices, election_results | 選舉 |
| **M8 新增** | fiscal_years, budgets, budget_items, budget_versions, budget_workflow_logs, amendments, amendment_votes, expenditures, expenditure_receipts, settlements, settlement_items | 財務（無留言） |
| **M9 新增** | regulation_reading_logs | 三讀歷程 |

**新增 Table 總計**：30 個（移除 speech_records、budget_comments，新增 agenda_type_definitions）

### 5.2 關鍵 FK 關係圖

```
terms ──────────────────────────────────────────────────────────────┐
  ├── term_sessions                                                  │
  ├── meetings ────────────────────────────────────────────────┐    │
  │     ├── meeting_agendas ──── budget / regulation / election │    │
  │     ├── sign_in_sessions ─── attendances                   │    │
  │     ├── speech_queues                                       │    │
  │     └── vote_motions ─────── vote_sessions                 │    │
  │                               └── ballot_records           │    │
  └── elections ──────────────────────────────────────────────── ┘    │
        ├── candidates                                                │
        └── election_ballots ── election_ballot_choices              │
                                                                     │
fiscal_years ─── budgets ──── budget_items ─────────────────────── ┘
                   ├── budget_versions
                   ├── budget_workflow_logs
                   ├── amendments ─── amendment_votes
                   ├── expenditures ─ expenditure_receipts
                   └── settlements ── settlement_items
```

### 5.3 重要 Index

```sql
CREATE INDEX ix_meetings_term_status ON meetings(term_id, status);
CREATE INDEX ix_attendances_meeting_user ON attendances(meeting_id, user_id);
CREATE INDEX ix_ballot_records_motion_voter ON ballot_records(motion_id, voter_id);
CREATE INDEX ix_budgets_fiscal_status ON budgets(fiscal_year_id, status);
CREATE INDEX ix_vote_motions_meeting ON vote_motions(meeting_id, status);
CREATE INDEX ix_sign_in_sessions_code ON sign_in_sessions(code) WHERE is_active = true;
CREATE INDEX ix_speech_queues_meeting_status ON speech_queues(meeting_id, status);
CREATE INDEX ix_election_ballots_election ON election_ballots(election_id);
```

---

## 六、API 端點設計

### 6.1 屆期系統 `/terms`

```
GET    /terms
POST   /terms                        [term:create]
GET    /terms/current
GET    /terms/{id}
PATCH  /terms/{id}                   [term:edit]
POST   /terms/{id}/close             [term:close]
GET    /terms/{id}/members
GET    /terms/{id}/sessions
POST   /terms/{id}/sessions          [term:session_create]
PATCH  /terms/{id}/sessions/{sid}    [term:session_edit]
```

### 6.2 會議系統 `/meetings`

```
GET    /meetings
POST   /meetings                     [meeting:create]
GET    /meetings/{id}
PATCH  /meetings/{id}                [meeting:edit]
DELETE /meetings/{id}                [meeting:delete]
POST   /meetings/{id}/start          [meeting:start]
POST   /meetings/{id}/end            [meeting:end]
POST   /meetings/{id}/archive        [meeting:archive]
POST   /meetings/{id}/generate-minutes [meeting:generate_minutes]
GET    /meetings/{id}/summary
```

### 6.3 議程系統 `/meetings/{id}/agendas`

```
GET    /meetings/{id}/agendas
POST   /meetings/{id}/agendas        [agenda:create]
PATCH  /meetings/{id}/agendas/{ag}   [agenda:edit]
DELETE /meetings/{id}/agendas/{ag}   [agenda:delete]
POST   /meetings/{id}/agendas/reorder [agenda:reorder]
POST   /meetings/{id}/agendas/{ag}/activate [agenda:activate]
POST   /meetings/{id}/agendas/{ag}/complete [agenda:complete]
POST   /meetings/{id}/agendas/{ag}/defer    [agenda:defer]
POST   /meetings/{id}/agendas/{ag}/withdraw [agenda:withdraw]
PATCH  /meetings/{id}/agendas/{ag}/resolution [agenda:set_resolution]
POST   /meetings/{id}/agendas/{ag}/attachments [agenda:add_attachment]

# 議程類型管理（系統設定）
GET    /agenda-types
POST   /agenda-types                 [agenda:manage_types]
PATCH  /agenda-types/{code}          [agenda:manage_types]
```

### 6.4 出席系統

```
POST   /meetings/{id}/signin/open     [attendance:open_signin]
POST   /meetings/{id}/signin/close    [attendance:close_signin]
POST   /meetings/{id}/signin/submit   [任何登入用戶]
POST   /meetings/{id}/signin/manual   [attendance:manual_record]
GET    /meetings/{id}/attendances
PATCH  /meetings/{id}/attendances/{uid} [attendance:override]
POST   /meetings/{id}/attendances/{uid}/leave [attendance:approve_leave]
GET    /analytics/attendance          [attendance:view_all]
GET    /analytics/attendance/export   [attendance:export]
```

### 6.5 發言系統（純佇列）

```
GET    /meetings/{id}/speeches
POST   /meetings/{id}/speeches/register     [speech:register]
POST   /meetings/{id}/speeches/register-for [speech:register_for_other]
POST   /meetings/{id}/speeches/open         [speech:open_queue]
POST   /meetings/{id}/speeches/close        [speech:close_queue]
POST   /meetings/{id}/speeches/{q}/start    [speech:start]
POST   /meetings/{id}/speeches/{q}/skip     [speech:skip]
POST   /meetings/{id}/speeches/{q}/end      [speech:end_speech]
POST   /meetings/{id}/speeches/{q}/withdraw [speech:register 或本人]
POST   /meetings/{id}/speeches/reorder      [speech:reorder]
POST   /meetings/{id}/speeches/clear        [speech:clear_queue]
PATCH  /meetings/{id}/speeches/{q}/time-limit [speech:set_time_limit]
```

### 6.6 投票系統

```
GET    /meetings/{id}/votes
POST   /meetings/{id}/votes              [vote:create]
GET    /meetings/{id}/votes/{v}
PATCH  /meetings/{id}/votes/{v}          [vote:edit]（DRAFT only）
DELETE /meetings/{id}/votes/{v}          [vote:delete]
PATCH  /meetings/{id}/votes/{v}/type     [vote:set_type]
PATCH  /meetings/{id}/votes/{v}/threshold [vote:set_threshold]
PATCH  /meetings/{id}/votes/{v}/choices  [vote:set_choices]
PATCH  /meetings/{id}/votes/{v}/settings [vote:set_duration + vote:set_live_count]
POST   /meetings/{id}/votes/{v}/open     [vote:open]
POST   /meetings/{id}/votes/{v}/cast     [vote:cast]
POST   /meetings/{id}/votes/{v}/close    [vote:close]
POST   /meetings/{id}/votes/{v}/tally    [vote:tally]
POST   /meetings/{id}/votes/{v}/announce [vote:announce]
POST   /meetings/{id}/votes/{v}/void     [vote:void]
GET    /meetings/{id}/votes/{v}/result
GET    /meetings/{id}/votes/{v}/ballots  [vote:view_named_results]
```

### 6.7 選舉系統

```
GET    /elections
POST   /elections                        [election:create]
GET    /elections/{id}
PATCH  /elections/{id}/settings          [election:edit_settings]
PATCH  /elections/{id}/eligibility       [election:set_eligibility]
PATCH  /elections/{id}/ballot-type       [election:set_ballot_type]
PATCH  /elections/{id}/timeline          [election:set_timeline]
PATCH  /elections/{id}/display-settings  [election:set_display]
POST   /elections/{id}/open-registration [election:open_registration]
POST   /elections/{id}/close-registration [election:close_registration]
GET    /elections/{id}/candidates
POST   /elections/{id}/candidates        [election:candidate]
PATCH  /elections/{id}/candidates/{c}    [election:review_candidate]
POST   /elections/{id}/candidates/{c}/disqualify [election:disqualify]
POST   /elections/{id}/open-voting       [election:open_voting]
POST   /elections/{id}/vote              [election:vote]
POST   /elections/{id}/close-voting      [election:close_voting]
POST   /elections/{id}/tally             [election:tally]
POST   /elections/{id}/announce          [election:announce]
POST   /elections/{id}/ballots/{b}/void  [election:void_ballot]
GET    /elections/{id}/results
```

### 6.8 財務系統 `/finance`

```
# 會計年度
GET/POST  /finance/fiscal-years
GET/PATCH /finance/fiscal-years/{id}

# 預算案工作流
GET/POST  /finance/budgets
GET/PATCH /finance/budgets/{id}
POST      /finance/budgets/{id}/submit           [budget:submit]
POST      /finance/budgets/{id}/recall           [budget:recall]
POST      /finance/budgets/{id}/dept-approve     [budget:dept_review_approve]
POST      /finance/budgets/{id}/dept-reject      [budget:dept_review_reject]
POST      /finance/budgets/{id}/finance-approve  [budget:finance_review_approve]
POST      /finance/budgets/{id}/finance-reject   [budget:finance_review_reject]
POST      /finance/budgets/{id}/exec-approve     [budget:exec_approve]
POST      /finance/budgets/{id}/exec-reject      [budget:exec_reject]

# 預算項目
GET/POST  /finance/budgets/{id}/items
PATCH     /finance/budgets/{id}/items/{item_id}
POST      /finance/budgets/{id}/items/reorder

# 版本管理
GET       /finance/budgets/{id}/versions
GET       /finance/budgets/{id}/diff/{v1}/{v2}

# 修正案
GET/POST  /finance/budgets/{id}/amendments       [budget:amend_propose]
PATCH     /finance/budgets/{id}/amendments/{a}   [budget:amend_review]
POST      /finance/budgets/{id}/amendments/{a}/vote [budget:vote]

# 支出
GET/POST  /finance/expenditures
GET/PATCH /finance/expenditures/{id}
POST      /finance/expenditures/{id}/approve     [expenditure:approve]
POST      /finance/expenditures/{id}/receipts    [expenditure:upload_receipt]

# 決算
GET/POST  /finance/settlements
GET/PATCH /finance/settlements/{id}
POST      /finance/settlements/{id}/approve      [budget:settle_approve]

# 分析
GET       /finance/analytics/overview            [budget:view_all]
GET       /finance/analytics/by-dept
GET       /finance/analytics/budget-vs-actual
GET       /finance/analytics/export              [budget:export]
```

### 6.9 投影顯示頁 `/display`（公開端點）

```
GET  /display/current                  # 取得系統當前活躍的顯示狀態
GET  /display/meeting/{id}/live        # 會議即時資訊
GET  /display/election/{id}/progress   # 選舉投票進度（含分組）
GET  /display/election/{id}/results    # 選舉結果（公告後才有資料）
GET  /display/attendance/{meeting_id}  # 出席即時清單
```

---

## 七、完整權限矩陣

### 7.1 角色 → 核心權限示意

> 以下為建議起始配置，系統管理員可透過 Position 管理頁自由調整各職位的權限組合。

| 功能群組 | 一般議員 | 部門幹部 | 財務長 | 議長/副議長 | 行政主席 | 秘書長 | 選委 | Admin |
|---------|:-------:|:-------:|:------:|:----------:|:------:|:-----:|:----:|:-----:|
| **屆期管理** | | | | | | | | ✓ |
| `term:create/edit/close` | | | | | | | | ✓ |
| `term:session_create/edit` | | | | | | | | ✓ |
| **會議** | | | | | | | | |
| `meeting:create` | | | | ✓ | | | | ✓ |
| `meeting:edit` | | | | ✓ | | | | ✓ |
| `meeting:start/end` | | | | ✓ | | | | ✓ |
| `meeting:set_quorum` | | | | ✓ | | | | ✓ |
| `meeting:set_presider/secretary` | | | | ✓ | | | | ✓ |
| `meeting:generate_minutes` | | | | | | ✓ | | ✓ |
| **議程** | | | | | | | | |
| `agenda:create/edit/delete` | | | | ✓ | | ✓ | | ✓ |
| `agenda:reorder` | | | | ✓ | | | | ✓ |
| `agenda:activate/complete/defer` | | | | ✓ | | | | ✓ |
| `agenda:set_resolution` | | | | ✓ | | ✓ | | ✓ |
| `agenda:manage_types` | | | | | | | | ✓ |
| **出席** | | | | | | | | |
| `attendance:open_signin` | | | | ✓ | | | | ✓ |
| `attendance:manual_record` | | | | | | ✓ | | ✓ |
| `attendance:override` | | | | ✓ | | | | ✓ |
| `attendance:approve_leave` | | | | | | ✓ | | ✓ |
| **發言佇列** | | | | | | | | |
| `speech:register` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | | ✓ |
| `speech:open_queue/close_queue` | | | | ✓ | | | | ✓ |
| `speech:start/skip/end_speech` | | | | ✓ | | | | ✓ |
| `speech:reorder/clear_queue` | | | | ✓ | | | | ✓ |
| **投票** | | | | | | | | |
| `vote:create/edit/delete` | | | | ✓ | | | | ✓ |
| `vote:set_type/threshold/choices` | | | | ✓ | | | | ✓ |
| `vote:set_duration/live_count` | | | | ✓ | | | | ✓ |
| `vote:open/close/tally/announce` | | | | ✓ | | | | ✓ |
| `vote:cast` | ✓ | ✓ | ✓ | ✓ | ✓ | | | ✓ |
| `vote:void` | | | | | | | | ✓ |
| `vote:view_named_results` | | | | ✓ | | | | ✓ |
| **選舉** | | | | | | | | |
| `election:create` | | | | | | | ✓ | ✓ |
| `election:edit_settings` | | | | | | | ✓ | ✓ |
| `election:set_eligibility/seats/ballot_type/timeline/display` | | | | | | | ✓ | ✓ |
| `election:open/close_registration` | | | | | | | ✓ | ✓ |
| `election:review_candidate/disqualify` | | | | | | | ✓ | ✓ |
| `election:open/close_voting/tally/announce` | | | | | | | ✓ | ✓ |
| `election:void_ballot` | | | | | | | ✓ | ✓ |
| `election:candidate` | ✓ | ✓ | ✓ | ✓ | ✓ | | | ✓ |
| `election:vote` | ✓ | ✓ | ✓ | ✓ | ✓ | | | ✓ |
| **預算** | | | | | | | | |
| `budget:create/edit_own/submit/recall` | ✓ | ✓ | | | | | | ✓ |
| `budget:dept_review_approve/reject` | | ✓ | | | | | | ✓ |
| `budget:finance_review_approve/reject` | | | ✓ | | | | | ✓ |
| `budget:exec_approve/reject` | | | | | ✓ | | | ✓ |
| `budget:legislative` | ✓ | ✓ | ✓ | ✓ | | | | ✓ |
| `budget:amend_propose` | ✓ | ✓ | | | | | | ✓ |
| `budget:amend_review/vote` | | | | ✓ | | | | ✓ |
| `budget:settle` | | | ✓ | | | | | ✓ |
| `budget:settle_approve` | | | | | ✓ | | | ✓ |
| **法規** | | | | | | | | |
| `regulation:assign_committee` | | | | ✓ | | | | ✓ |
| `regulation:committee_report` | | ✓ | | | | | | ✓ |
| `regulation:advance_reading` | | | | ✓ | | | | ✓ |
| `regulation:council_approve` | | | | ✓ | | | | ✓ |
| `regulation:president_publish` | | | | | ✓ | | | ✓ |
| **投影顯示** | | | | | | | | |
| `display:manage` | | | | ✓ | | | | ✓ |

### 7.2 Row-Level Permission 規則（Service 層）

```python
# 會議查看：公開會議 or 議員任期有效
# 投票：status=open + 尚未投票 + 有效任期
# 選舉投票：在 eligible_position/org/user_ids 中
# 預算案編輯：owner + status=draft
# 支出申請：active budget + 不超支（SELECT FOR UPDATE）
# 候選人登記：本人 + 在登記時間內 + 資格未被取消
```

---

## 八、即時通訊設計

### 8.1 WebSocket 事件規格

```python
# 會議（room = meeting:{meeting_id}）
WS_MEETING_STATUS_CHANGED = "meeting.status_changed"
WS_AGENDA_ACTIVATED       = "meeting.agenda_activated"
WS_SIGNIN_OPENED          = "meeting.signin_opened"
WS_ATTENDANCE_UPDATED     = "meeting.attendance_updated"   # 即時出席人數
WS_SPEECH_QUEUE_UPDATED   = "meeting.speech_queue"         # 佇列變動
WS_SPEECH_CALLED          = "meeting.speech_called"        # 叫號（含姓名/序號）
WS_TIMER_STARTED          = "meeting.timer_started"        # {seconds: N}
WS_TIMER_WARNING          = "meeting.timer_warning"        # 最後 30 秒

# 投票（room = vote:{motion_id}）
WS_VOTE_OPENED            = "vote.opened"
WS_VOTE_PROGRESS          = "vote.progress"    # {cast: N, eligible: M}（不含明細）
WS_VOTE_CLOSED            = "vote.closed"
WS_VOTE_RESULT            = "vote.result"

# 選舉（room = election:{election_id}）
WS_ELECTION_PROGRESS      = "election.progress"  # 哪幾組已投票
WS_ELECTION_RESULT        = "election.result"     # 開票公告後

# 投影顯示（room = display:global）
WS_DISPLAY_MODE_CHANGED   = "display.mode_changed"  # 模式切換通知投影頁重整
```

### 8.2 投票安全

```
記名投票：UniqueConstraint DB 層 + Service 二次驗證
不記名投票：ballot_token = HMAC(user_id + motion_id + secret)，不儲存 voter_id
選舉不記名：ballot_token = HMAC(user_id + election_id + secret)
```

---

## 九、UI/UX 設計規格

### 9.1 全站導航架構

```
頂部欄：[HCCA Logo] [第75屆 ▾] [113學年 ▾]   [🔔] [👤]

左側 Sidebar：
├── 📊 首頁 Dashboard
├── ── 議會系統 ──
├── 🏛️  院會 / 委員會
├── 📋 議程管理
├── 📊 出席統計
├── 🗳️  投票紀錄
├── 🗣️  發言佇列
├── ── 立法系統 ──
├── 📜 法規資料庫
├── ✏️  修法提案
├── ── 財務系統 ──
├── 💰 財務總覽
├── 📁 預算案
├── 🧾 支出管理
├── 📊 決算報告
├── ── 選舉系統 ──
├── 🗳️  選舉管理
├── ── 其他 ──
├── 📄 公文系統
├── 📢 公告系統
├── 📊 數據分析
└── ⚙️  系統設定
```

### 9.2 核心頁面：進行中會議（Live View）

```
┌──────────────────────────────────────────────────────────────┐
│ 🔴 第75屆第3次院會 · 進行中    出席：23/30 (76.7%) · 達法定人數  │
├──────────────────────┬───────────────────────────────────────┤
│  🔵 當前議程          │  ── 發言佇列 ──                         │
│  ─────────────────── │  1. 🟢 王議員（發言中）00:02:15           │
│  二、討論事項(一)      │  2. 陳議員（等待中）                     │
│  「115年度總預算案」   │  3. 林議員（等待中）                     │
│                      │  [登記發言]                              │
│  狀態：討論中         │                                         │
│  時間：00:35:22       │  ── 上一個投票結果 ──                    │
│                      │  程序動議 → 通過 17:3:2                  │
│  [凍結討論] [進入投票] │                                         │
├──────────────────────┘                                         │
│  議程進度                                                       │
│  ✅ 一、報告事項 (完成)                                          │
│  🔵 二(一)、總預算案 (進行中)                                    │
│  ⬜ 二(二)、修法案                                               │
└─────────────────────────────────────────────────────────────-─┘
```

（已移除即時留言板）

### 9.3 核心頁面：投票介面

```
┌──────────────────────────────────────────────┐
│  🗳️ 即時投票                                   │
│  動議：「115年度總預算案 - 音響費修正案」         │
│  投票類型：記名  門檻：出席過半               │
│  已投票：12 / 23                             │
│  ████████████░░░░░░░░░░░  52%                │
│  ┌──────┐ ┌──────┐ ┌──────┐                  │
│  │ 贊成  │ │ 反對  │ │ 棄權  │                  │
│  └──────┘ └──────┘ └──────┘                  │
│  ⏱️ 剩餘：02:34                               │
└──────────────────────────────────────────────┘
```

### 9.4 投影顯示頁（Display Page）

URL：`/display`（全螢幕，無側欄，大字體）

#### 選舉模式範例

```
┌──────────────────────────────────────────────────────────────────┐
│                 第75屆議長選舉 · 投票進行中                          │
│                                                                   │
│  已投票  17 / 30  人                                               │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  班級      應投  已投  進度                                 │    │
│  │  101班  ██████  2/2  ✅ 完成                               │    │
│  │  102班  ███░░░  1/2  進行中                                │    │
│  │  103班  ░░░░░░  0/2  未開始                               │    │
│  │  104班  ██████  2/2  ✅ 完成                               │    │
│  │  105班  ███░░░  1/2  進行中                                │    │
│  │  ...                                                      │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  請各班尚未投票的議員儘速至投票頁面完成投票                           │
└──────────────────────────────────────────────────────────────────┘
```

#### 出席模式範例

```
┌──────────────────────────────────────────────────────────────────┐
│              第75屆第3次院會 · 簽到中                               │
│                                                                   │
│   已到  23 人  ·  未到  7 人  ·  法定人數  20 人  ✅               │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │  出席議員                                                  │    │
│  │  王O明  陳O安  林O蓉  黃O誠  李O芬  張O凱  吳O霖  ...        │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                   │
│  掃描 QR Code 或輸入代碼 123456 完成簽到                            │
└──────────────────────────────────────────────────────────────────┘
```

---

## 十、後端工程結構

```
apps/api/src/api/
├── models/
│   ├── term.py              # Term, TermSession
│   ├── meeting.py           # Meeting
│   ├── agenda.py            # AgendaTypeDefinition, MeetingAgenda, AgendaAttachment
│   ├── attendance.py        # SignInSession, Attendance
│   ├── speech.py            # SpeechQueue（無 SpeechRecord）
│   ├── vote.py              # VoteMotion, VoteSession, BallotRecord
│   ├── election.py          # Election, Candidate, ElectionBallot, ElectionBallotChoice, ElectionResult
│   ├── finance.py           # FiscalYear, Budget, BudgetItem, BudgetVersion, BudgetWorkflowLog
│   ├── expenditure.py       # Expenditure, ExpenditureReceipt, Settlement, SettlementItem
│   ├── amendment.py         # Amendment, AmendmentVote
│   └── regulation_reading.py # RegulationReadingLog
│
├── schemas/
│   ├── term.py
│   ├── meeting.py
│   ├── agenda.py
│   ├── attendance.py
│   ├── speech.py
│   ├── vote.py
│   ├── election.py
│   ├── finance.py
│   ├── expenditure.py
│   └── amendment.py
│
├── services/
│   ├── term.py
│   ├── meeting.py
│   ├── agenda.py
│   ├── attendance.py        # 簽到驗證（HMAC + 防重複）
│   ├── speech.py            # 佇列管理（排序/叫號）
│   ├── vote.py              # 投票邏輯 + 結算
│   ├── election.py          # 選舉 + 開票 + 進度分組
│   ├── display.py           # 投影顯示資料聚合
│   ├── finance.py
│   ├── budget_workflow.py   # 預算狀態機
│   ├── budget_items.py
│   ├── budget_version.py
│   ├── amendment.py
│   ├── expenditure.py       # 超支保護（SELECT FOR UPDATE）
│   └── meeting_minutes.py   # 自動生成公文
│
└── routers/
    ├── terms.py
    ├── meetings.py          # 含 agendas/attendance/speeches/votes
    ├── elections.py
    ├── finance.py
    └── display.py           # 公開投影端點（無 Auth）
```

---

## 十一、前端工程結構

```
apps/web/src/
├── app/
│   ├── parliament/
│   │   ├── page.tsx                 # 議會 Dashboard
│   │   ├── meetings/
│   │   │   ├── page.tsx             # 會議列表
│   │   │   ├── new/page.tsx
│   │   │   └── [id]/
│   │   │       ├── page.tsx         # 詳情
│   │   │       └── live/page.tsx    # 進行中 Live View
│   │   ├── attendance/page.tsx
│   │   └── votes/page.tsx
│   ├── elections/
│   │   ├── page.tsx
│   │   ├── [id]/
│   │   │   ├── page.tsx             # 投票頁
│   │   │   └── results/page.tsx
│   │   └── manage/page.tsx
│   ├── finance/
│   │   ├── page.tsx
│   │   ├── budgets/
│   │   │   ├── page.tsx
│   │   │   ├── new/page.tsx
│   │   │   └── [id]/
│   │   │       ├── page.tsx
│   │   │       └── review/page.tsx  # 議會審理（修正案/投票）
│   │   ├── expenditures/
│   │   └── analytics/page.tsx
│   ├── display/                     # 投影顯示頁（全螢幕）
│   │   ├── page.tsx                 # 入口：自動偵測當前模式
│   │   ├── meeting/[id]/page.tsx    # 會議投影
│   │   ├── election/[id]/page.tsx   # 選舉投影（含分組進度）
│   │   └── attendance/[id]/page.tsx # 出席投影
│   └── regulations/                 # 現有，擴充三讀狀態
│
└── components/
    ├── parliament/
    │   ├── LiveMeetingView.tsx
    │   ├── AgendaTimeline.tsx
    │   ├── AgendaTree.tsx           # 拖曳排序
    │   ├── AttendancePanel.tsx
    │   ├── QRSignIn.tsx
    │   ├── SpeechQueuePanel.tsx     # 純排隊顯示
    │   ├── SpeechTimer.tsx          # 前端計時（不儲存）
    │   ├── VoteModal.tsx
    │   ├── VoteResultDisplay.tsx
    │   └── MeetingStatusBadge.tsx
    ├── elections/
    │   ├── CandidateCard.tsx
    │   ├── BallotForm.tsx
    │   ├── ElectionProgressByGroup.tsx  # 分班/組顯示進度
    │   └── ElectionResultChart.tsx
    ├── display/                     # 投影頁專用元件（大字體）
    │   ├── DisplayElectionProgress.tsx  # 哪幾班已投票
    │   ├── DisplayAttendanceBoard.tsx   # 出席大螢幕
    │   ├── DisplayVoteResult.tsx        # 投票結果動畫
    │   ├── DisplaySpeechQueue.tsx       # 發言佇列投影
    │   └── DisplayMeetingInfo.tsx       # 當前議程資訊
    └── finance/
        ├── BudgetItemTree.tsx
        ├── BudgetDiffViewer.tsx
        ├── WorkflowTimeline.tsx
        ├── AmendmentPanel.tsx
        ├── ExpenditureForm.tsx
        └── BudgetGauge.tsx
```

---

## 十二、安全性設計

### 12.1 審計不可竄改

```python
# 所有新模組關鍵動作寫入現有 AuditLog
# 不可變資料：
# ① BudgetVersion.snapshot_json  — 無 UPDATE API
# ② ballot_records               — 投票後不可撤回
# ③ BudgetWorkflowLog            — 只 INSERT
# ④ election_results             — 公告後鎖定
# ⑤ ElectionBallot               — 不可刪除
```

### 12.2 簽到防偽

```python
# code = HMAC(meeting_id + session_id + timestamp + secret)[:6]
# 有效期可設定（預設10分鐘）
# QRCode payload：{ meeting_id, session_id, code, exp } → Base64URL
```

### 12.3 投票防重複

```python
# 記名：UniqueConstraint("motion_id", "voter_id")
# 不記名：ballot_token = HMAC(user_id + motion_id + secret)，不存 voter_id
# 選舉不記名：ballot_token = HMAC(user_id + election_id + secret)
```

### 12.4 財務超支防護

```python
# SELECT FOR UPDATE 鎖定 Budget
# 任何支出審核前重新計算 available = total_amount - used_amount
```

### 12.5 投影顯示頁安全

```python
# GET /display/* 為公開端點
# 回傳資料依選舉/投票設定過濾：
#   show_vote_count = false → 不回傳即時票數
#   result_announcement_delay → 未到時間不回傳結果
#   不記名選舉 → 分組進度只顯示「已投/未投人數」，不揭露個人
```

---

## 十三、部署架構

```
現有 Docker Compose 直接擴充：
  PostgreSQL 16 / Redis 7 / FastAPI / Next.js / Celery / MinIO

新增 bucket：
  agenda-attachments/  candidates/  election-statements/

新增環境變數：
  SIGN_IN_SECRET=<256-bit>
  ELECTION_TOKEN_SECRET=<256-bit>
  SIGN_IN_VALID_MINUTES=10
  LATE_THRESHOLD_MINUTES=15
```

---

## 十四、開發里程碑

### Phase 0：基礎建設（1 週）

```
□ 建立所有新 Models + Alembic migration
□ 新增所有 Permission Codes（細粒度版）至 permission_codes.py
□ 更新 .env.example（SIGN_IN_SECRET 等）
□ 擴充 RegulationWorkflowStatus enum
□ 更新通知類型清單
□ 前端：lib/types.ts + lib/api.ts 骨架
```

### Phase 1：屆期 + 會議 + 議程（2 週）

```
Week 1：
  □ terms/term_sessions CRUD
  □ meetings CRUD + 狀態機
  □ agenda_type_definitions CRUD（客製化類型）
  □ 前端：會議列表 + 議程樹

Week 2：
  □ meeting_agendas 完整 CRUD + 拖曳排序
  □ agenda_attachments 上傳
  □ 前端：AgendaTree（拖曳）+ 時間軸
```

### Phase 2：出席 + 發言佇列 + 即時（2 週）

```
Week 3：
  □ sign_in_sessions（HMAC）+ attendances（防重複）
  □ 出席統計 API
  □ 前端：QRSignIn + 即時出席（WebSocket）

Week 4：
  □ speech_queues（純佇列，無紀錄）
  □ 前端：SpeechQueuePanel + SpeechTimer（純前端計時）
  □ 前端：Live Meeting View（整合介面）
  □ 投影顯示頁基礎框架（/display）
```

### Phase 3：投票系統（2 週）

```
Week 5：
  □ vote_motions（可客製化選項/門檻/時限/計票顯示）
  □ ballot_records + 結算邏輯
  □ 前端：VoteModal + 投影模式（DisplayVoteResult）

Week 6：
  □ 法規三讀擴充
  □ 前端：修法 Diff 增強 + 三讀狀態
  □ 前端：歷次表決頁
```

### Phase 4：選舉系統（2 週）

```
Week 7：
  □ elections（完整客製設定：資格/席次/投票方式/時間）
  □ candidates（政見分段，可自訂欄位）
  □ election_ballots（記名/不記名）
  □ 前端：候選人頁 + 投票表單

Week 8：
  □ 開票 + election_results
  □ 投影顯示：選舉分組進度頁（DisplayElectionProgress）
  □ 投影顯示：開票結果動畫
  □ 前端：ElectionProgressByGroup 元件
```

### Phase 5：財務系統（4 週）

```
Week 9：fiscal_years + budgets + budget_items 樹狀
Week 10：budget_versions + amendments + amendment_votes
Week 11：expenditures（SELECT FOR UPDATE）+ receipts
Week 12：settlements + 財務分析 API + 圖表
```

### Phase 6：整合收尾（2 週）

```
Week 13：
  □ 會議紀錄自動生成（整合 Document 系統）
  □ 全站通知整合（新增 9 種通知類型）
  □ 投影顯示頁完善（出席/會議/選舉/投票全模式）
  □ 議會 Analytics Dashboard

Week 14：
  □ 後端全模組測試
  □ 安全審查（HMAC/權限邊界）
  □ 效能調校（Index/N+1）
  □ CLAUDE.md 更新
  □ 部署驗證
```

---

## 附錄：關鍵設計決策

| 決策點 | 選擇 | 理由 |
|--------|------|------|
| 權限粒度 | 每個操作步驟獨立 code | 讓管理員能精確授權，不必給超額權限 |
| 議程類型 | `agenda_type_definitions` 表 | 管理員可新增自訂類型，不限於預設值 |
| 發言系統 | 純佇列，無發言紀錄 | 簡化系統，減少法律與隱私顧慮 |
| 即時留言 | 移除 | 避免留言被截圖或引發爭議；會議發言走正式佇列 |
| 投票客製 | choices JSONB + 多種門檻 | 支援超出 yes/no/abstain 的複雜表決 |
| 選舉客製 | 完整 JSONB 設定欄位 | 議長/選委可完全控制每次選舉規則 |
| 投影顯示 | 獨立 /display 路由，公開端點 | 便於直接投影，不需登入，確保敏感資料依設定過濾 |
| 選舉進度 | 按班/組顯示，不揭露個人 | 公開已投/未投，但保護個別隱私 |
| 不記名投票 | HMAC ballot_token | 防重複 + 完全匿名 |
| 金額儲存 | BigInteger（元） | 無浮點精度問題 |
| 超支防護 | SELECT FOR UPDATE | 防並發競態條件 |
| 簽到碼 | HMAC-SHA256 截斷 6 位 | 防偽造 + 短碼易輸入 |
| 審計 | 現有 AuditLog | 統一查詢，不分散 |

---

*文件版本：v2.1 | 維護者：Claude Code | 最後更新：2026-05-08*
