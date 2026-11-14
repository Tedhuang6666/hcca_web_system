export default function DelegationPermissions() {
  return (
    <dl className="shop-delegation-permissions">
      <div>
        <dt>家長可以做什麼</dt>
        <dd>可選購授權活動商品，僅能修改此連結登記的品項。</dd>
      </div>
      <div>
        <dt>訂單歸誰、由誰繳款</dt>
        <dd>送出即加入學生預購，由學生繳款與領取；優惠合併計算。</dd>
      </div>
      <div>
        <dt>學生保有的權限</dt>
        <dd>學生可調整所有品項。撤銷授權後，已登記品項仍保留；重新產生會停用舊連結。</dd>
      </div>
      <div>
        <dt>何時不能再修改</dt>
        <dd>商品截止、班級結單或收款後，相關登記無法修改。</dd>
      </div>
    </dl>
  );
}
