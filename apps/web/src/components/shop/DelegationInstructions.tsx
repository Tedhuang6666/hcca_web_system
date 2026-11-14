import DelegationPermissions from "./DelegationPermissions";

export default function DelegationInstructions() {
  return (
    <details className="shop-delegation-help">
      <summary tabIndex={0}>完整操作介紹與權限說明</summary>
      <div className="shop-delegation-instructions">
        <h3>學生怎麼授權</h3>
        <p>已連結的學校與私人帳號皆可管理授權。</p>
        <ol>
          <li>登入學生帳號，點商品頁「家人代訂」，選擇要授權的活動。</li>
          <li>建立驗證碼，將驗證碼或分享連結私下傳給家長。</li>
          <li>授權至商品截止或班級結單；重新產生時，舊授權停用。</li>
        </ol>
        <h3>家長怎麼開始代訂</h3>
        <ol>
          <li>登入自己的帳號，輸入驗證碼或開啟分享連結。</li>
          <li>核對學生、活動與帳號後確認授權；每份限一個家長帳號。</li>
          <li>送出即加入學生預購；重開原連結可接續。</li>
        </ol>
        <h3>使用範圍與訂單責任</h3>
        <DelegationPermissions />
        <p>請勿分享帳密；驗證碼失效時，請學生重新產生。</p>
      </div>
    </details>
  );
}
