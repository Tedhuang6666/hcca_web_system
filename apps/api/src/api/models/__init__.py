"""ORM 模型匯入 - 確保 Alembic autogenerate 能偵測到所有 Table"""

# 基礎
# 公文系統（含字號模板、受文者、審核步驟等）[M-17, M-18]
# 公告系統 [P8+]
from api.models.announcement import (  # noqa: F401
    Announcement,
    AnnouncementAudience,
    AnnouncementMedia,
    AnnouncementRead,
    announcement_audience_orgs,
    announcement_audience_users,
)

# 稽核日誌（不可變）
from api.models.audit_log import AuditLog  # noqa: F401
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
