"""ORM 模型匯入 - 確保 Alembic autogenerate 能偵測到所有 Table"""

# 基礎
# 公文系統（含字號模板、受文者、審核步驟等）[M-17, M-18]
from api.models.document import (  # noqa: F401
    ApprovalStepStatus,
    Document,
    DocumentApproval,
    DocumentAttachment,
    DocumentCategory,
    DocumentClassification,
    DocumentRecipient,
    DocumentRevision,
    DocumentSerialTemplate,
    DocumentStatus,
    DocumentUrgency,
    RecipientType,
    YearMode,
)
from api.models.org import Org, Permission, Position, UserPosition  # noqa: F401

# 法規系統（含條文結構與修訂歷程）[M-20]
from api.models.regulation import (  # noqa: F401
    ArticleType,
    Regulation,
    RegulationArticle,
    RegulationCategory,
    RegulationRevision,
)

# 購票 / 校商訂購系統 [M-23]
from api.models.shop import (  # noqa: F401
    Order,
    OrderItem,
    OrderStatus,
    Product,
    ProductStatus,
)
from api.models.user import User  # noqa: F401
