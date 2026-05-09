# 新增功能詳細提案

**生成日期**：2026-05-07  
**優先級分布**：15 個 Tier 1（立即）| 18 個 Tier 2（3 個月）| 10 個 Tier 3（可選）

---

## 📊 Tier 1：立即啟動（優先級排序）

### 1. 📊 參與率統計模組 ⭐⭐⭐ **最高優先**

**優先級指標**：影響力 5/5 | 工作量 1 | **ROI 3.0**

**功能描述**：
- 公告閱讀率（按發佈者、按部門、按日期）
- 問卷回應率（回應人數 vs 目標人數）
- 文件簽核完成率（已簽 vs 待簽）
- 使用者活躍度（登入頻率、操作次數）

**業務價值**：
- 衡量 IT 投資 ROI
- 優化內部溝通策略
- 識別低參與部門，進行改進

**實現方案**：

**後端**（Python FastAPI）：
```python
# apps/api/src/api/models/analytics.py
class ParticipationMetric(Base):
    __tablename__ = "participation_metrics"
    
    id: UUID = mapped_column(UUID, primary_key=True, server_default=gen_random_uuid())
    metric_type: str  # "announcement", "survey", "document"
    metric_date: date
    org_id: UUID = mapped_column(ForeignKey("orgs.id"))
    
    # 統計數據
    total_items: int  # 發佈的項目數
    viewed_count: int  # 閱讀/開啟數
    completed_count: int  # 完成數
    
    participation_rate: float = Computed(
        lambda self: (self.completed_count / self.total_items * 100) if self.total_items > 0 else 0
    )

# apps/api/src/api/services/analytics.py
async def get_participation_stats(
    db: AsyncSession,
    org_id: UUID,
    start_date: date,
    end_date: date,
    metric_type: str | None = None,
) -> list[dict]:
    """查詢參與率統計"""
    q = select(ParticipationMetric).where(
        ParticipationMetric.org_id == org_id,
        ParticipationMetric.metric_date.between(start_date, end_date),
    )
    if metric_type:
        q = q.where(ParticipationMetric.metric_type == metric_type)
    
    result = await db.execute(q.order_by(ParticipationMetric.metric_date))
    metrics = result.scalars().all()
    
    return [
        {
            "date": m.metric_date,
            "type": m.metric_type,
            "participation_rate": m.participation_rate,
            "total": m.total_items,
            "completed": m.completed_count,
        }
        for m in metrics
    ]

# apps/api/src/api/routers/analytics.py
@router.get(
    "/analytics/participation",
    response_model=list[ParticipationMetricsOut],
    dependencies=[Depends(require_permission("admin:all"))]
)
async def get_participation_stats(
    db: DbDep,
    org_id: UUID,
    start_date: date = Query(...),
    end_date: date = Query(...),
    metric_type: str | None = Query(None),
):
    return await analytics_service.get_participation_stats(
        db, org_id, start_date, end_date, metric_type
    )
```

**前端**（Next.js + React）：
```typescript
// apps/web/src/app/analytics/participation/page.tsx
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";

export default function ParticipationAnalyticsPage() {
  const [stats, setStats] = useState([]);
  const [dateRange, setDateRange] = useState({ start: "", end: "" });

  useEffect(() => {
    const fetchStats = async () => {
      const response = await api.get("/analytics/participation", {
        org_id: currentOrg.id,
        start_date: dateRange.start,
        end_date: dateRange.end,
      });
      setStats(response);
    };
    if (dateRange.start && dateRange.end) fetchStats();
  }, [dateRange]);

  return (
    <div>
      <h1>參與率分析</h1>
      <DateRangePicker onChange={setDateRange} />
      <LineChart data={stats}>
        <CartesianGrid />
        <XAxis dataKey="date" />
        <YAxis label={{ value: "參與率 (%)", angle: -90 }} />
        <Tooltip formatter={(v) => `${v.toFixed(2)}%`} />
        <Legend />
        <Line type="monotone" dataKey="participation_rate" stroke="#8884d8" />
      </LineChart>
    </div>
  );
}
```

**資料庫設計**：
```sql
-- 新增表
CREATE TABLE participation_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    metric_type VARCHAR(50) NOT NULL,  -- 'announcement', 'survey', 'document'
    metric_date DATE NOT NULL,
    org_id UUID REFERENCES orgs(id) ON DELETE CASCADE,
    
    total_items INTEGER DEFAULT 0,
    viewed_count INTEGER DEFAULT 0,
    completed_count INTEGER DEFAULT 0,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(metric_type, metric_date, org_id),
    INDEX idx_metric_date (metric_date),
    INDEX idx_org_id (org_id)
);

-- 定時更新（Celery Beat）
-- 每日 23:59 執行統計計算
```

**預估工作量**：4-5 人天

**交付物**：
- [ ] ParticipationMetric 模型 + migration
- [ ] 統計計算服務（Celery Task）
- [ ] API 端點 + Swagger 文件
- [ ] React 圖表元件
- [ ] 單元測試（happy path + 403 無權限）

---

### 2. 📊 公文處理效率統計 ⭐⭐ **高優先**

**優先級指標**：影響力 5/5 | 工作量 2 | **ROI 2.5**

**功能描述**：
- 平均簽核時間（按部門、按簽核人、按公文類型）
- 簽核卡關分析（待簽超過 N 天的文件）
- 簽核人工作量排行
- 簽核通過率 vs 退回率

**業務價值**：
- 識別簽核瓶頸
- 優化流程，提升效率
- 績效評估基礎數據

**實現方案**：

```python
# apps/api/src/api/models/document_analytics.py
class DocumentSigningAnalytics(Base):
    __tablename__ = "document_signing_analytics"
    
    id: UUID = mapped_column(UUID, primary_key=True, server_default=gen_random_uuid())
    document_id: UUID = mapped_column(ForeignKey("documents.id"))
    approver_id: UUID = mapped_column(ForeignKey("users.id"))
    
    approval_step: int
    time_to_sign: timedelta  # 收到到簽核耗時
    signed_at: datetime
    
    # 統計聚合
    avg_time_by_approver = relationship(...)  # N+1 需優化

# apps/api/src/api/services/document_analytics.py
async def get_document_efficiency_stats(
    db: AsyncSession,
    org_id: UUID,
    start_date: date,
    end_date: date,
) -> dict:
    """查詢公文簽核效率"""
    
    # 1. 計算平均簽核時間
    result = await db.execute(
        select(
            User.id,
            User.name,
            func.avg(DocumentSigningAnalytics.time_to_sign).label("avg_time_days"),
            func.count(DocumentSigningAnalytics.id).label("total_approvals"),
        )
        .join(User, DocumentSigningAnalytics.approver_id == User.id)
        .where(
            DocumentSigningAnalytics.signed_at.between(start_date, end_date),
        )
        .group_by(User.id, User.name)
        .order_by(func.avg(DocumentSigningAnalytics.time_to_sign).desc())
    )
    
    stats = result.all()
    
    return {
        "approvers": [
            {
                "name": row[1],
                "avg_signing_time_hours": row[2].total_seconds() / 3600 if row[2] else 0,
                "total_approvals": row[3],
            }
            for row in stats
        ],
        # ... 其他統計
    }

# apps/api/src/api/routers/analytics.py
@router.get(
    "/analytics/document-efficiency",
    response_model=DocumentEfficiencyStatsOut,
    dependencies=[Depends(require_permission("admin:all"))]
)
async def get_document_efficiency_stats(
    db: DbDep,
    org_id: UUID,
    start_date: date = Query(...),
    end_date: date = Query(...),
):
    return await document_analytics_service.get_document_efficiency_stats(
        db, org_id, start_date, end_date
    )
```

**前端呈現**：
```typescript
// 表格：按簽核人排名
// 圖表：平均簽核時間趨勢
// 熱力圖：按日期 + 簽核人的簽核速度
```

**預估工作量**：3-4 人天

---

### 3. 🔐 2FA 認證實裝 ⭐⭐ **高優先**

**優先級指標**：影響力 4/5 | 工作量 2 | **ROI 2.0**

**功能描述**：
- TOTP（Time-based One-Time Password）認證
- 備用碼生成與恢復
- 設定管理 UI
- 強制 2FA（針對管理員）

**實現方案**：

```python
# 1. 新增依賴
# pyproject.toml
dependencies = [
    ...,
    "pyotp",  # TOTP 生成
    "qrcode",  # QR Code 生成
]

# 2. 更新 User 模型
# apps/api/src/api/models/user.py
class User(Base):
    __tablename__ = "users"
    
    # 現有欄位
    id: UUID = ...
    email: str = ...
    is_superuser: bool = ...
    
    # 新增欄位
    mfa_enabled: bool = mapped_column(Boolean, default=False)
    mfa_secret: str | None = mapped_column(String(32), nullable=True)  # 加密
    backup_codes: str | None = mapped_column(String, nullable=True)  # JSON 加密
    mfa_created_at: datetime | None = mapped_column(DateTime, nullable=True)

# 3. 創建 migration
# uv run --project apps/api alembic revision --autogenerate -m "add_mfa_fields_to_user"

# 4. 服務層
# apps/api/src/api/services/mfa.py
class MFAService:
    @staticmethod
    def generate_secret() -> tuple[str, str]:
        """生成 TOTP 祕密與 QR Code"""
        secret = pyotp.random_base32()
        totp = pyotp.TOTP(secret)
        qr_uri = totp.provisioning_uri(
            name="user@example.com",
            issuer_name="HCCA Campus Platform"
        )
        qr_code = qrcode.make(qr_uri).tobase64()
        return secret, qr_code
    
    @staticmethod
    def verify_token(secret: str, token: str) -> bool:
        """驗證 TOTP 令牌（允許時間偏差）"""
        totp = pyotp.TOTP(secret)
        return totp.verify(token, valid_window=1)
    
    @staticmethod
    def generate_backup_codes(count: int = 10) -> list[str]:
        """生成備用碼"""
        return [secrets.token_urlsafe(6) for _ in range(count)]

# 5. 路由
# apps/api/src/api/routers/mfa.py
@router.post("/mfa/setup")
async def setup_mfa(
    db: DbDep,
    user: CurrentUser,
):
    """1. 初始化 2FA 設定"""
    secret, qr_code = MFAService.generate_secret()
    backup_codes = MFAService.generate_backup_codes()
    
    return MFASetupOut(
        secret=secret,  # 不傳給前端，僅用於驗證
        qr_code=qr_code,
        backup_codes=[c[:6] + "****" for c in backup_codes],  # 掩蓋部分
    )

@router.post("/mfa/confirm")
async def confirm_mfa(
    db: DbDep,
    user: CurrentUser,
    body: MFAConfirmIn,  # { token, secret }
):
    """2. 驗證並啟用 2FA"""
    if not MFAService.verify_token(body.secret, body.token):
        raise HTTPException(400, "Invalid TOTP token")
    
    # 加密存儲
    user.mfa_secret = encrypt_secret(body.secret)
    user.backup_codes = json.dumps(
        encrypt_backup_codes(MFAService.generate_backup_codes())
    )
    user.mfa_enabled = True
    user.mfa_created_at = datetime.now(UTC)
    
    await db.commit()
    
    logger.info("2FA enabled", extra={"user": user.id})

@router.post("/auth/verify-mfa")
async def verify_mfa_token(
    db: DbDep,
    token: str = Query(...),  # 6 位 TOTP
    user_email: str = Query(...),  # 第一步認證後已知
):
    """3. 登入時驗證 TOTP"""
    user = await db.get_one(User, User.email == user_email)
    
    if not user.mfa_enabled:
        # 直接發行 JWT
        return AuthTokenOut(access_token=..., token_type="bearer")
    
    if MFAService.verify_token(user.mfa_secret, token):
        return AuthTokenOut(access_token=..., token_type="bearer")
    
    raise HTTPException(400, "Invalid 2FA token")
```

**前端**：
```typescript
// apps/web/src/app/settings/mfa/setup/page.tsx
import QRCode from "qrcode.react";

export default function MFASetupPage() {
  const [step, setStep] = useState<"display" | "verify" | "complete">("display");
  const [mfaData, setMfaData] = useState(null);
  const [token, setToken] = useState("");

  const handleSetupStart = async () => {
    const resp = await api.post("/mfa/setup");
    setMfaData(resp);
    setStep("verify");
  };

  const handleVerify = async () => {
    await api.post("/mfa/confirm", { token, secret: mfaData.secret });
    setStep("complete");
    toast.success("2FA 已啟用");
  };

  return step === "display" ? (
    <button onClick={handleSetupStart}>開始設定 2FA</button>
  ) : step === "verify" ? (
    <div>
      <QRCode value={mfaData.qr_code} />
      <input value={token} onChange={(e) => setToken(e.target.value)} />
      <button onClick={handleVerify}>驗證</button>
    </div>
  ) : (
    <p>2FA 已啟用！備用碼已保存。</p>
  );
}
```

**資料庫遷移**：
```bash
uv run --project apps/api alembic revision --autogenerate -m "Add 2FA fields to users"
uv run --project apps/api alembic upgrade head
```

**預估工作量**：3-4 人天

---

### 4. 📋 法規對比檢視（完善）⭐⭐ **高優先**

**優先級指標**：影響力 5/5 | 工作量 2 | **ROI 2.5**

**功能描述**：
- 修正前後法規並排比較
- 差異高亮（新增、刪除、修改）
- 版本時間軸
- 條文對應追蹤

**前端實現**：

```typescript
// apps/web/src/components/regulations/RegulationDiff.tsx
import { ReactDiffViewer } from "react-diff-viewer";

export function RegulationDiffViewer({ regulation, versionA, versionB }) {
  const [diff, setDiff] = useState(null);

  useEffect(() => {
    const fetchDiff = async () => {
      const resp = await api.get(
        `/regulations/${regulation.id}/diff?v1=${versionA}&v2=${versionB}`
      );
      setDiff(resp);
    };
    fetchDiff();
  }, [versionA, versionB]);

  if (!diff) return <LoadingSpinner />;

  return (
    <div className="flex gap-4">
      {/* 版本時間軸 */}
      <div className="w-1/4">
        <RegulationTimeline
          versions={regulation.versions}
          selected={[versionA, versionB]}
          onChange={(a, b) => {}}
        />
      </div>

      {/* 並排對比 */}
      <div className="w-3/4">
        <ReactDiffViewer
          oldValue={diff.oldContent}
          newValue={diff.newContent}
          splitView={true}
          highlightLines={diff.changedArticles}  // 高亮修改的條文
        />
      </div>
    </div>
  );
}
```

**後端 API**：
```python
@router.get("/regulations/{reg_id}/diff")
async def get_regulation_diff(
    db: DbDep,
    reg_id: UUID,
    v1: int,  # 版本 1
    v2: int,  # 版本 2
):
    """比較兩個版本的法規"""
    rev1 = await db.get_one(
        RegulationRevision,
        RegulationRevision.regulation_id == reg_id,
        RegulationRevision.version == v1,
    )
    rev2 = await db.get_one(
        RegulationRevision,
        RegulationRevision.regulation_id == reg_id,
        RegulationRevision.version == v2,
    )
    
    # 使用 difflib 計算差異
    from difflib import unified_diff
    diff = list(unified_diff(
        rev1.content.splitlines(),
        rev2.content.splitlines(),
        lineterm=""
    ))
    
    return RegulationDiffOut(
        oldContent=rev1.content,
        newContent=rev2.content,
        differences=diff,
    )
```

**預估工作量**：2 人天

---

### 5. 🔐 廢止法規管理 ⭐⭐

**優先級指標**：影響力 4/5 | 工作量 2 | **ROI 2.0**

**功能描述**：
- 標記法規廢止日期
- 自動隱藏已廢止
- 廢止理由記錄
- 廢止版本歷史追蹤

**實現方案**：

```python
# 新增欄位至 Regulation 模型
class Regulation(Base):
    # 現有欄位
    id: UUID = ...
    org_id: UUID = ...
    title: str = ...
    status: RegulationStatus = ...
    
    # 新增欄位
    is_repealed: bool = mapped_column(Boolean, default=False)
    repealed_date: date | None = mapped_column(Date, nullable=True)
    repeal_reason: str | None = mapped_column(String, nullable=True)
    repeal_replacement: UUID | None = mapped_column(
        ForeignKey("regulations.id"), nullable=True
    )  # 替代法規

# 服務層
async def repeal_regulation(
    db: AsyncSession,
    regulation_id: UUID,
    reason: str,
    replacement_id: UUID | None = None,
) -> Regulation:
    """廢止法規"""
    reg = await db.get(Regulation, regulation_id)
    reg.is_repealed = True
    reg.repealed_date = date.today()
    reg.repeal_reason = reason
    reg.repeal_replacement = replacement_id
    
    await db.commit()
    logger.info("Regulation repealed", extra={"reg_id": regulation_id})
    
    return reg

# 路由
@router.post(
    "/regulations/{reg_id}/repeal",
    dependencies=[Depends(require_permission("regulation:publish"))]
)
async def repeal_regulation(
    db: DbDep,
    reg_id: UUID,
    body: RepealRegulationIn,  # { reason, replacement_id }
):
    return await regulation_service.repeal_regulation(
        db, reg_id, body.reason, body.replacement_id
    )

# 列表時自動過濾
async def list_regulations(...) -> list[RegulationOut]:
    q = select(Regulation).where(
        Regulation.is_repealed == False,  # 隱藏已廢止
        # ... 其他條件
    )
    # ...
```

**預估工作量**：2 人天

---

### 6. 📋 公文範本庫 ⭐

**優先級指標**：影響力 4/5 | 工作量 3 | **ROI 1.33**

**功能描述**：
- 機關可建立常用公文範本
- 從範本快速起稿
- 共用 vs 私有範本
- 範本版本管理

**實現方案**：

```python
# models
class DocumentTemplate(Base):
    __tablename__ = "document_templates"
    
    id: UUID = primary_key()
    org_id: UUID = ForeignKey("orgs.id")
    created_by: UUID = ForeignKey("users.id")
    
    name: str  # "常規公文"、"簽辦單"
    category: DocumentCategory
    description: str
    
    # 範本內容
    title_template: str  # "{organization_prefix}○○○" 
    content_template: str  # Markdown，支援變數替換
    
    is_shared: bool = True  # 組織內共用
    version: int = 1
    
    # 元數據
    created_at: datetime
    updated_at: datetime
    is_active: bool = True

# services
class DocumentTemplateService:
    async def create_from_template(
        self, 
        db: AsyncSession,
        template_id: UUID,
        user: User,
        substitutions: dict,  # { "{variable}": "值" }
    ) -> Document:
        """使用範本建立公文"""
        template = await db.get(DocumentTemplate, template_id)
        
        # 替換變數
        title = template.title_template.format(**substitutions)
        content = template.content_template.format(**substitutions)
        
        doc = Document(
            org_id=template.org_id,
            created_by=user.id,
            title=title,
            content=content,
            category=template.category,
            status=DocumentStatus.DRAFT,
        )
        db.add(doc)
        await db.commit()
        
        return doc

# routers
@router.post("/document-templates")
async def create_document_template(
    db: DbDep,
    user: CurrentUser,
    body: DocumentTemplateCreate,
    _: Annotated[None, Depends(require_permission("document:create"))],
):
    return await template_service.create(db, user, body)

@router.post("/documents/from-template/{template_id}")
async def create_from_template(
    db: DbDep,
    user: CurrentUser,
    template_id: UUID,
    body: CreateFromTemplateIn,  # { substitutions }
):
    return await template_service.create_from_template(
        db, template_id, user, body.substitutions
    )
```

**前端**：
```typescript
// 公文新建頁面新增"使用範本"選項
// apps/web/src/app/documents/new/page.tsx
export default function NewDocumentPage() {
  const [useTemplate, setUseTemplate] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [selectedTemplate, setSelectedTemplate] = useState(null);

  if (useTemplate) {
    return (
      <div>
        <h2>選擇範本</h2>
        <TemplateSelector
          templates={templates}
          onSelect={async (template) => {
            const doc = await api.post(
              `/documents/from-template/${template.id}`,
              {}
            );
            navigate(`/documents/${doc.id}/edit`);
          }}
        />
      </div>
    );
  }

  return (
    <div>
      <button onClick={() => setUseTemplate(true)}>從範本建立</button>
      <button onClick={() => setUseTemplate(false)}>空白新建</button>
    </div>
  );
}
```

**預估工作量**：3-4 人天

---

## 📋 Tier 2：2-3 個月內啟動

### 7. ⚙️ 批量操作

**功能**：多文件同簽核、轉發、封存

**工作量**：2 人天

**API 設計**：
```python
@router.post("/documents/batch/approve")
async def batch_approve_documents(
    db: DbDep,
    user: CurrentUser,
    body: BatchApproveIn,  # { doc_ids, decision, comment }
    _: Depends(require_permission("document:approve")),
):
    """批量簽核文件"""
    results = []
    for doc_id in body.doc_ids:
        doc = await document_service.approve(
            db, doc_id, user, body.decision, body.comment
        )
        results.append(doc)
    return results
```

---

### 8. 🔐 雙重授權（Dual Approval）

**功能**：敏感操作需兩人確認

**工作量**：2 人天

**實現**：
```python
# 針對高風險操作
@router.post(
    "/regulations/{reg_id}/publish",
    dependencies=[Depends(require_permission("regulation:publish"))],
)
async def publish_regulation(
    db: DbDep,
    user: CurrentUser,
    reg_id: UUID,
    body: PublishRegulationIn,
    second_approver_id: UUID = Query(...),  # 第二簽核人
):
    """發佈法規（需雙重授權）"""
    # 建立待雙簽記錄
    pending = DualApprovalRequest(
        resource_type="regulation",
        resource_id=reg_id,
        initiator_id=user.id,
        approver_id=second_approver_id,
        action="publish",
    )
    db.add(pending)
    await db.commit()
    
    # 通知第二簽核人
    await send_notification(second_approver_id, f"需要簽核法規發佈")
```

---

### 9. 🔔 簽核期限管理

**功能**：自動催辦、超期警告

**工作量**：3 人天

**實現**：
```python
# models
class DocumentApproval(Base):
    # ... 現有欄位
    deadline: datetime | None  # 簽核期限
    is_overdue: bool = Computed(
        lambda self: datetime.now(UTC) > self.deadline 
        if self.deadline else False
    )

# Celery Beat Task
@celery_app.task
def send_approval_reminders():
    """每小時執行一次，發送超期警告"""
    # 查找超期 > 24 小時的待簽
    overdue_approvals = session.execute(
        select(DocumentApproval)
        .where(
            DocumentApproval.status == ApprovalStatus.PENDING,
            DocumentApproval.deadline < datetime.now(UTC) - timedelta(hours=24),
        )
    ).scalars().all()
    
    for approval in overdue_approvals:
        send_email(
            approval.approver.email,
            subject="公文簽核已超期",
            body=f"文件 {approval.document.title} 已超過簽核期限",
        )
```

---

### 10. 🤖 AI 自動摘要

**功能**：使用 Claude API 自動生成摘要

**工作量**：2 人天

**實現**：
```python
# services
from anthropic import AsyncAnthropic

async def generate_document_summary(content: str) -> str:
    """使用 Claude 生成摘要"""
    client = AsyncAnthropic()
    response = await client.messages.create(
        model="claude-opus-4-1",
        max_tokens=500,
        messages=[
            {
                "role": "user",
                "content": f"請用 100-200 字總結以下公文內容：\n\n{content}",
            }
        ],
    )
    return response.content[0].text
```

---

### 11. 🤖 智能簽核路由

**功能**：根據主旨自動推薦簽核人

**工作量**：3 人天

---

### 12. 🤖 法規變更提醒

**功能**：相關法規更新時通知

**工作量**：2 人天

---

### 13. 🔔 通知訂閱管理 UI

**功能**：使用者自訂通知喜好

**工作量**：1 人天

**前端**：
```typescript
// apps/web/src/app/settings/notifications/page.tsx
export default function NotificationSettingsPage() {
  const [preferences, setPreferences] = useState({
    announcements: true,
    document_approvals: true,
    surveys: true,
    email_digest: "daily",  // daily, weekly, never
  });

  const handleSave = async () => {
    await api.post("/users/notification-preferences", preferences);
    toast.success("設定已保存");
  };

  return (
    <div>
      <label>
        <input
          type="checkbox"
          checked={preferences.announcements}
          onChange={(e) =>
            setPreferences({
              ...preferences,
              announcements: e.target.checked,
            })
          }
        />
        公告通知
      </label>
      {/* 更多選項... */}
      <button onClick={handleSave}>保存</button>
    </div>
  );
}
```

---

### 14. 📝 文件評論線程

**功能**：公文/法規評論回覆

**工作量**：3 人天

**實現**：
```python
# models
class DocumentComment(Base):
    __tablename__ = "document_comments"
    
    id: UUID = primary_key()
    document_id: UUID = ForeignKey("documents.id")
    author_id: UUID = ForeignKey("users.id")
    
    content: str
    parent_id: UUID | None = ForeignKey("document_comments.id")  # 回覆
    
    created_at: datetime
    updated_at: datetime
    
    replies = relationship("DocumentComment", backref="parent")
```

---

### 15. 🔐 完整審計日誌 UI

**功能**：查詢與合規報告

**工作量**：1 人天

**前端**：
```typescript
// apps/web/src/app/admin/audit-logs/page.tsx
export default function AuditLogsPage() {
  const [logs, setLogs] = useState([]);
  const [filters, setFilters] = useState({
    resource_type: "",
    user_id: "",
    action: "",
    dateRange: { start: "", end: "" },
  });

  const handleExport = async () => {
    const csv = await api.get("/admin/audit-logs/export", { params: filters });
    downloadCSV(csv, "audit-logs.csv");
  };

  return (
    <div>
      <h1>審計日誌</h1>
      <AuditLogFilters onChange={setFilters} />
      <AuditLogTable data={logs} />
      <button onClick={handleExport}>匯出 CSV</button>
    </div>
  );
}
```

---

## 📋 Tier 3：可選功能（3-6 個月）

### 16. 🤝 Slack 機器人整合

**功能**：簽核待辦、新公告推送至 Slack

**工作量**：2 人天

---

### 17. 🌐 行動 PWA（Progressive Web App）

**功能**：離線支援、安裝應用、推送通知

**工作量**：4-5 人天

---

### 18. ♿ 無障礙 WCAG 2.1 認證

**功能**：鍵盤導航、螢幕閱讀器支援

**工作量**：2-3 人天

---

### 19. 📊 日誌聚合 / APM 監控

**功能**：ELK Stack、Datadog 整合

**工作量**：2 人天

---

### 20. 📞 SMS / Push 通知整合

**功能**：Twilio、Firebase Cloud Messaging

**工作量**：2 人天

---

## 📈 功能優先級矩陣

```
高影響力 │
        │  2FA ★★★★★  │  參與率統計 ★★★★★
        │  廢止管理      │  公文效率統計
        │  法規對比      │  公文範本庫
        │ ─────────────────────────────
        │  批量操作      │  通知訂閱
        │  簽核期限      │  評論線程
        │  AI 摘要       │
低影響力 │
        └──────────────────────────────
        低工作量      高工作量
```

**建議優先順序**：
1. 參與率統計（ROI 3.0）
2. 公文效率統計（ROI 2.5）
3. 2FA（ROI 2.0）
4. 法規對比完善（ROI 2.5）
5. 批量操作（ROI 1.5）
6. 公文範本庫（ROI 1.33）

---

## ✅ 功能交付清單範本

每個功能實裝時：

- [ ] **後端**：Models + Services + Routers
- [ ] **遷移**：Alembic migration 若有 schema 變更
- [ ] **前端**：頁面 + 元件 + API 呼叫
- [ ] **類型**：前端 types.ts 更新
- [ ] **測試**：Unit + Integration 測試
- [ ] **文件**：API Swagger + 使用者文件
- [ ] **審查**：代碼審查 + QA 驗收

