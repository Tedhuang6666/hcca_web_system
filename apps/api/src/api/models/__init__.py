"""ORM 模型匯入 - 確保 Alembic autogenerate 能偵測到所有 Table"""

# 基礎
# 公文系統（含字號模板、受文者、審核步驟等）[M-17, M-18]
# 公告系統 [P8+]
# 稽核日誌（不可變）
from api.models.activity import Activity, ActivityConvener, ActivityStatus  # noqa: F401
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
from api.models.defense import DefenseRule, DefenseRuleType  # noqa: F401
from api.models.discord_account import (  # noqa: F401
    DEFAULT_DM_CATEGORIES,
    DiscordAccountLink,
    DiscordGuildConfig,
    DiscordNicknamePrefixRule,
    DiscordNotificationPreference,
    DiscordOrgChannelMapping,
    DiscordRoleMapping,
    DiscordRoleMappingKind,
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
from api.models.email_message import EmailMessage, EmailStatus  # noqa: F401
from api.models.exam_paper import ExamGradeTrack, ExamPaper, ExamPaperDownload  # noqa: F401

# Feature Flag（Phase D3）
from api.models.feature_flag import FeatureFlag  # noqa: F401
from api.models.line_account import LineAccountLink  # noqa: F401
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
    MeetingArtifactLink,
    MeetingAttendance,
    MeetingAttendanceSource,
    MeetingBallot,
    MeetingBillStage,
    MeetingDecision,
    MeetingDecisionStatus,
    MeetingEvent,
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
    VoteStatus,
    VoteVisibility,
)
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
<<<<<<< HEAD
from api.models.passkey import PasskeyCredential, WebAuthnChallenge  # noqa: F401
from api.models.person import (  # noqa: F401
    Person,
    PersonAffiliation,
    PersonAffiliationKind,
    PersonAffiliationSource,
    PersonAffiliationStatus,
    PersonStatus,
)
=======
>>>>>>> 27e0ebc9c13e971c3303ece60e51366e8c113b71
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

# 政策版本與同意紀錄（Phase B1 / ADR-003）
from api.models.policy import (  # noqa: F401
    PolicyConsent,
    PolicyDocument,
    PolicyKind,
    PrivacyRequest,
    PrivacyRequestStatus,
    PrivacyRequestType,
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
    ClassStudentRange,
    SchoolClass,
)

# 校商訂購系統 [M-23]
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
)
from api.models.user import User  # noqa: F401

# 外部身份綁定（Phase D1 / ADR-005）
from api.models.user_identity import UserIdentity  # noqa: F401
from api.models.web_push import WebPushSubscription  # noqa: F401

# Webhook 訂閱與投遞紀錄（Phase D2）
from api.models.webhook import (  # noqa: F401
    DeliveryStatus,
    WebhookDelivery,
    WebhookSubscription,
)
from api.models.work_item import WorkItem, WorkItemStatus  # noqa: F401
