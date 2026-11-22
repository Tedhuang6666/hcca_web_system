/**
 * 判斷某個 API 狀態碼是否屬於「再重試也沒意義」的致命錯誤：
 *  - 401 / 403：未授權／被拒絕 → 需要重新登入或補權限，輪詢不該繼續打。
 *  - 521–524：Cloudflare 來源／閘道錯誤（522 = 連線逾時）→ 後端不可達，
 *    應停止輪詢以免空打，待網路恢復或使用者回到頁面再重新嘗試。
 *
 * 其餘錯誤（暫時性網路錯誤、5xx 應用錯誤）交由呼叫端以退避方式重試。
 */
export function isFatalApiStatus(status: number): boolean {
  return status === 401 || status === 403 || (status >= 521 && status <= 524);
}
