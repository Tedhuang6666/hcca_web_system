"""ORM 模型匯入 - 確保 Alembic autogenerate 能偵測到所有 Table"""

# 基礎
# 公文系統（含字號模板、受文者、審核步驟等）[M-17, M-18]
# 公告系統
# 稽核日誌（不可變）
from api.models.activity import Activity, ActivityConvener, ActivityStatus  # noqa: F401
from api.models.activity_discord import (  # noqa: F401
    ActivityMember,
    ActivityRole,
    DiscordActivitySyncStatus,
    DiscordActivityWorkspace,
)
from api.models.activity_link import ActivityLink, ActivityLinkKind  # noqa: F401
from api.models.analytics_page_view import AnalyticsPageView  # noqa: F401
from api.models.announcement import (  # noqa: F401
    Announcement,
    AnnouncementAudience,
    AnnouncementMedia,
    AnnouncementRead,
    announcement_audience_orgs,
    announcement_audience_users,
)
from api.models.api_key import ApiKey  # noqa: F401
from api.models.audit_anchor import AuditLogAnchor  # noqa: F401
from api.models.audit_log import AuditLog  # noqa: F401
from api.models.backup_record import BackupKind, BackupRecord, BackupStatus  # noqa: F401
from api.models.calendar import (  # noqa: F401
    CalendarEvent,
    CalendarEventChecklistItem,
    CalendarEventLink,
    CalendarEventParticipant,
    CalendarEventStatus,
    CalendarEventType,
    CalendarLinkType,
    CalendarParticipantResponse,
    CalendarParticipantRole,
    CalendarVisibility,
)
from api.models.council_proposal import (  # noqa: F401
    CouncilProposal,
    CouncilProposalCaseType,
    CouncilProposalKind,
    CouncilProposalStatus,
)
from api.models.defense import DefenseRule, DefenseRuleType  # noqa: F401
from api.models.discord_account import (  # noqa: F401
    DEFAULT_DM_CATEGORIES,
    DiscordAccountLink,
    DiscordGuildConfig,
    DiscordMemberSyncState,
    DiscordNicknamePrefixRule,
    DiscordNotificationPreference,
    DiscordOrgChannelMapping,
    DiscordRoleMapping,
    DiscordRoleMappingKind,
    DiscordRolePolicy,
)
from api.models.document import (  # noqa: F401
    ApprovalStepStatus,
    DelegateSource,
    Document,
    DocumentApproval,
    DocumentApprovalDelegation,
    DocumentAttachment,
    DocumentCategory,
    DocumentClassification,
    DocumentRecipient,
    DocumentRevision,
    DocumentSerialTemplate,
    DocumentStatus,
    DocumentTemplate,
    DocumentUrgency,
    DocumentVisibility,
    RecipientType,
    YearMode,
)
from api.models.election import (  # noqa: F401
    BallotBox,
    BallotBoxStatus,
    Candidate,
    CandidateMember,
    Election,
    ElectionStatus,
    VoteEvent,
    VoteEventKind,
)
from api.models.email_message import (  # noqa: F401
    EmailAttachment,
    EmailAttachmentMode,
    EmailCampaignRecipient,
    EmailEventType,
    EmailMessage,
    EmailRecipientEvent,
    EmailRecipientList,
    EmailRecipientListMember,
    EmailRecipientStatus,
    EmailResourceVisibility,
    EmailStatus,
    EmailSuppression,
    EmailTemplate,
    EmailTemplateVersion,
)
from api.models.exam_paper import ExamGradeTrack, ExamPaper, ExamPaperDownload  # noqa: F401

# Feature Flag
from api.models.feature_flag import FeatureFlag  # noqa: F401
from api.models.finance import (  # noqa: F401
    BankTransaction,
    ChartAccount,
    FinanceAccountType,
    FinanceLedger,
    FiscalPeriod,
    FundAccount,
    FundStorageType,
    JournalEntry,
    JournalLine,
    JournalStatus,
)
from api.models.google_calendar import OrgGoogleCalendarConfig  # noqa: F401
from api.models.governance import (  # noqa: F401
    AutomationRule,
    AutomationRuleStatus,
    CaseStatus,
    Decision,
    DecisionStatus,
    EntityRelation,
    GovernanceCase,
    GovernanceDiscordEventRoute,
    GovernanceDiscordWorkspace,
    GovernanceEventType,
    GovernanceWorkflowTemplate,
    Matter,
    MatterPriority,
    MatterResource,
    MatterResourceType,
    MatterRoleAssignment,
    MatterStatus,
    MatterType,
    MatterVisibility,
    PlanningDocument,
    PlanningDocumentAttachment,
    PlanningDocumentRevision,
    PlanningDocumentRevisionAttachment,
    PlanningDocumentStatus,
    Program,
    TimelineEvent,
)
from api.models.inventory import (  # noqa: F401
    InventoryCategory,
    InventoryItem,
    InventoryItemType,
    InventoryProcurement,
    InventoryProcurementItem,
    InventoryProcurementStatus,
    InventoryTransaction,
    InventoryTxnType,
)
from api.models.judicial_petition import (  # noqa: F401
    JudicialPetition,
    JudicialPetitionStatus,
    JudicialPetitionType,
)
from api.models.line_account import LineAccountLink  # noqa: F401
from api.models.loan import (  # noqa: F401
    LoanItemCategory,
    LoanRecord,
    LoanRecordStatus,
    LoanUnit,
    LoanUnitStatus,
)
from api.models.meal import (  # noqa: F401
    MealClassPickupCode,
    MealOrder,
    MealOrderItem,
    MealOrderStatus,
    MealPickupSlot,
    MealPickupStatus,
    MealProduct,
    MealProductAvailability,
    MealVendor,
    MealVendorApplication,
    MealVendorManager,
    MealVendorStatus,
    MenuItem,
    MenuSchedule,
)
from api.models.meeting import (  # noqa: F401
    AgendaItemType,
    ArtifactLinkType,
    AttendanceRole,
    AttendanceSourceType,
    AttendanceStatus,
    BallotChoice,
    Meeting,
    MeetingAgendaAttachment,
    MeetingAgendaItem,
    MeetingAgendaRecusal,
    MeetingArtifactLink,
    MeetingAttendance,
    MeetingAttendanceSource,
    MeetingBallot,
    MeetingBillStage,
    MeetingDecision,
    MeetingDecisionStatus,
    MeetingEvent,
    MeetingMode,
    MeetingMotion,
    MeetingMotionStatus,
    MeetingMotionType,
    MeetingRequest,
    MeetingRequestStatus,
    MeetingRequestType,
    MeetingScreenState,
    MeetingStatus,
    MeetingVote,
    ScreenReadingMode,
    VoteRecordMethod,
    VoteStatus,
    VoteVisibility,
)
from api.models.merchandise_submission import (  # noqa: F401
    MerchandiseSubmission,
    MerchandiseSubmissionFile,
    MerchandiseSubmissionItem,
    MerchandiseSubmissionSettings,
    MerchandiseSubmissionStatus,
)
from api.models.navigation_profile import NavigationProfile, NavigationProfilePosition  # noqa: F401
from api.models.notification import Notification  # noqa: F401
from api.models.org import Org, Permission, Position, UserPosition  # noqa: F401

# Outbox 事件表（at-least-once 通知保障）
from api.models.outbox import OutboxEvent  # noqa: F401
from api.models.partner_map import (  # noqa: F401
    PartnerBusiness,
    PartnerBusinessStatus,
    PartnerLocation,
    PartnerOffer,
    PartnerRating,
    PartnerSubmission,
    PartnerSubmissionStatus,
    PartnerTag,
    partner_business_tags,
)
from api.models.person import (  # noqa: F401
    Person,
    PersonAffiliation,
    PersonAffiliationKind,
    PersonAffiliationSource,
    PersonAffiliationStatus,
    PersonStatus,
)
from api.models.petition import (  # noqa: F401
    PetitionAttachment,
    PetitionAttachmentVisibility,
    PetitionCase,
    PetitionCaseEvent,
    PetitionEventType,
    PetitionEventVisibility,
    PetitionStatus,
    PetitionType,
)

# 政策版本與同意紀錄
from api.models.policy import (  # noqa: F401
    PolicyConsent,
    PolicyDocument,
    PolicyKind,
    PrivacyRequest,
    PrivacyRequestStatus,
    PrivacyRequestType,
)
from api.models.publication import (  # noqa: F401
    PublicationCampaign,
    PublicationDelivery,
    PublicationDeliveryStatus,
    PublicationStatus,
)
from api.models.receivable import Receivable, ReceivableSource, ReceivableStatus  # noqa: F401
from api.models.recommended_vendor import (  # noqa: F401
    RecommendedVendor,
    RecommendedVendorProduct,
    RecommendedVendorStatus,
)

# 法規系統（含條文結構與修訂歷程）[M-20]
from api.models.regulation import (  # noqa: F401
    ArticleType,
    Regulation,
    RegulationArticle,
    RegulationCategory,
    RegulationRevision,
)

# 儲存常用篩選（公開檢索/檔案系統化查詢）
from api.models.saved_filter import SavedFilter  # noqa: F401

# 班級系統（學號區間自動歸班、幹部結單）
from api.models.school_class import (  # noqa: F401
    ClassCadre,
    ClassConsolidationMixin,
    ClassManualMember,
    ClassMembership,
    ClassMembershipSource,
    ClassMembershipStatus,
    ClassRoleBinding,
    ClassRoleKey,
    ClassRosterEntry,
    ClassStudentRange,
    SchoolClass,
)

# 劃位 / 票券系統（商品票種延伸）
from api.models.seating import (  # noqa: F401
    Seat,
    SeatAssignment,
    SeatAssignmentStatus,
    SeatHold,
    SeatingMode,
    SeatingWave,
    SeatingZone,
    SeatStatus,
)

# 商品訂購系統 [M-23]
from api.models.shop import (  # noqa: F401
    Cart,
    CartItem,
    Order,
    OrderItem,
    OrderStatus,
    Product,
    ProductCategory,
    ProductSeries,
    ProductStatus,
    ProductVariantGroup,
    ProductVariantOption,
    ShopOrderClose,
)
from api.models.site import (  # noqa: F401
    PublicLink,
    PublicLinkCategory,
    PublicOfficerProfile,
    PublicSitePage,
    PublicSiteSettings,
)
from api.models.survey import (  # noqa: F401
    QuestionType,
    Survey,
    SurveyAnswer,
    SurveyQuestion,
    SurveyResponse,
    SurveyStatus,
)
from api.models.user import User  # noqa: F401
from api.models.user_google_tasks import UserGoogleTasksConfig  # noqa: F401

# 外部身份綁定
from api.models.user_identity import UserIdentity  # noqa: F401
from api.models.web_push import WebPushSubscription  # noqa: F401

# Webhook 訂閱與投遞紀錄
from api.models.webhook import (  # noqa: F401
    DeliveryStatus,
    WebhookDelivery,
    WebhookSubscription,
)
from api.models.work_item import WorkItem, WorkItemStatus  # noqa: F401
from api.models.workflow import (  # noqa: F401
    WorkflowEvent,
    WorkflowEventType,
    WorkflowInstance,
    WorkflowLink,
    WorkflowSourceType,
)
