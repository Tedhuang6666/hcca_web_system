export default function DelegationPermissions() {
  return (
    <dl className="shop-delegation-permissions">
      <div>
        <dt>家長可以做什麼</dt>
        <dd>在連結授權的活動或商品主題內選購，只能修改透過這個連結登記的品項；無法修改學生本人或其他家人的品項。</dd>
      </div>
      <div>
        <dt>訂單歸誰、由誰繳款</dt>
        <dd>代訂送出後立即加入學生的預購，不需學生再次確認。學生負責繳款與領取，優惠依學生本人與家人登記的品項合計計算。</dd>
      </div>
      <div>
        <dt>學生保有的權限</dt>
        <dd>學生可在訂單明細調整本人與家人代訂的品項，也可撤銷連結。撤銷只停止後續代訂，已登記的品項仍保留；重新產生連結會停用舊連結。</dd>
      </div>
      <div>
        <dt>何時不能再修改</dt>
        <dd>商品截止、班級結單或收款後，相關登記不能再修改。代訂連結不授予班級收款、全校訂單或帳號管理權限。</dd>
      </div>
    </dl>
  );
}
