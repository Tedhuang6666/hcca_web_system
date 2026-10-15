import DelegationPermissions from "./DelegationPermissions";

export default function DelegationInstructions() {
  return (
    <details className="shop-delegation-help">
      <summary tabIndex={0}>完整操作介紹與權限說明</summary>
      <div className="shop-delegation-instructions">
        <h3>學生怎麼授權</h3>
        <p>已綁定學校與私人帳號？用任一帳號登入，都能以同一個學生身分建立與管理邀請。</p>
        <ol>
          <li>登入學生帳號，點商品頁右下角「代訂」，選擇要授權的活動。</li>
          <li>填寫給哪位家長使用，點「建立代訂驗證碼」，取得七位數驗證碼與分享連結；任選一種私下傳給家長。</li>
          <li>驗證碼須在 30 分鐘內使用。過期時仍可開啟分享連結；需要新碼可在連結管理重新產生，舊連結與驗證碼會停用。</li>
        </ol>
        <h3>家長怎麼開始代訂</h3>
        <ol>
          <li>登入自己的帳號，點商品頁右下角「代訂」，輸入學生提供的七位數驗證碼，或直接開啟學生傳來的連結。</li>
          <li>核對學生姓名、活動範圍與目前帳號，點「確認授權並開始代訂」。每份授權只供一個家長帳號使用。</li>
          <li>在下方選擇商品、規格與數量。登記會直接加入學生預購；之後重開同一連結即可接續，不需要再次輸入驗證碼。</li>
        </ol>
        <h3>使用範圍與訂單責任</h3>
        <DelegationPermissions />
        <p>請只分享給受授權的家人，不需要交換帳號或密碼。驗證碼無效、過期或已綁定別人時，請學生確認或重新產生授權。</p>
      </div>
    </details>
  );
}
