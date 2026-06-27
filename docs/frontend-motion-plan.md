# 前端基礎動畫規畫

## 目標

- 讓換頁、載入、忙碌狀態與區塊進場有一致的回饋。
- 優先使用 CSS 與既有 Next.js loading route，不增加大型動畫依賴。
- 尊重 `prefers-reduced-motion`，避免必要資訊仰賴動畫。

## 已建立的基礎層

- `components/layout/PageTransition.tsx`
  - 依 `pathname` 重新掛載主內容，觸發全站頁面進場。
  - 在 `AppShell` 的 `<main>` 內包住頁面內容。
- `components/layout/NavigationProgress.tsx`
  - 內部連結點擊時設定 `html[data-navigation="pending"]`，提供進度條與頁面外殼等待回饋。
- `components/ui/LoadingState.tsx`
  - `LoadingState`：行內或區塊載入提示。
  - `PageLoading`：列表頁標準 loading。
  - `DetailPageLoading`：詳情頁標準 loading。
- `globals.css`
  - `.app-page-transition`：全站頁面進場。
  - `.motion-enter`、`.motion-fade`、`.motion-stagger`：頁面局部進場工具。
  - `[aria-busy="true"]` / `.is-loading`：按鈕與操作中的共用忙碌狀態。
  - `.card-hover`、`.btn`、表格列、表單 focus、toast：共用微互動與光澤回饋。
  - reduced-motion media query：降低或移除非必要動態。

## 套用準則

- App Router 的 `loading.tsx` 優先使用 `PageLoading` 或 `DetailPageLoading`。
- 長列表或資料表載入優先使用骨架，不只顯示 spinner。
- 表單送出、上傳、重新整理按鈕使用 `aria-busy="true"`，保留原本文字並讓 CSS 顯示旋轉提示。
- 一次性區塊進場使用 `.motion-enter`；多個同級卡片可用 `.motion-stagger` 並設定 `--stagger-index`。
- 互動元素優先靠既有 `.btn`、`.card-hover`、`.table-row`、`.input` 類別取得動畫，不另外寫一次性效果。
- 需要常駐動畫時，必須確認 reduced-motion 下仍可使用。

## 後續建議

- 將高頻頁面內部的 `loading ? "載入中..." : ...` 逐步改為 `LoadingState compact` 或骨架。
- 表格元件可集中支援 `aria-busy` 與空狀態轉場。
- 表單元件可統一接收 `submitting`，由共用按鈕樣式處理忙碌狀態。
