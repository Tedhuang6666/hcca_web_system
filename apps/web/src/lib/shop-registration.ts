/** 商品登記頁共用的變體識別與鎖定說明。 */

export function registrationVariantKey(options: readonly { option_id: string }[]) {
  return options.map((option) => option.option_id).sort().join(",");
}

export function registrationLockMessage({
  registrationLocked,
  classClosed,
  deadlinePassed,
}: {
  registrationLocked: boolean;
  classClosed: boolean;
  deadlinePassed: boolean;
}) {
  if (registrationLocked) return "班級幹部已登記收款，商品登記已鎖定";
  if (classClosed) return "本班已停止訂購，如需更改請聯繫班代";
  if (deadlinePassed) return "商品登記已截止";
  return "登入後即可登記商品";
}
