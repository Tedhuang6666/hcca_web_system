# Apps/Web 驗證作業手冊

本文件用來固定 `apps/web` 的驗證流程，避免重複走錯誤路徑（尤其是 WSL + Windows Node 混用）。

## 1. 執行位置

- 一律在 `apps/web` 目錄下執行。
- 在本專案環境，建議使用以下 `workdir`：
  - `\\wsl.localhost\Ubuntu\home\ted98\projects\0413\apps\web`

## 2. 標準驗證命令（唯一準則）

### Lint

```powershell
& 'C:\Program Files\nodejs\node.exe' '.\node_modules\eslint\bin\eslint.js' --config '.\eslint.config.mjs' '.\src'
```

### Type Check

```powershell
& 'C:\Program Files\nodejs\node.exe' '.\node_modules\typescript\bin\tsc' --noEmit
```

## 3. 成功條件

- Lint：`exit code 0`，且沒有 `error` / `warning`。
- Type check：`exit code 0`。

## 4. 常見錯誤路徑（避免）

- 不要在專案根目錄直接跑 `npm run lint`（容易觸發 Next pages path 偵測錯誤）。
- 不要使用會落到 `CMD + UNC` 的 npm 呼叫路徑（會出現「UNC paths are not supported」）。
- 若要比對歷史結果，優先相信「本文件命令在 `apps/web` workdir 下」的輸出。

## 5. 建議提交流程

每次前端改動後，固定順序：

1. 跑 Lint 命令
2. 跑 Type Check 命令
3. 兩者皆 `exit code 0` 才提交

