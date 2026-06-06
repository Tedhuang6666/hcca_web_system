"""校園自治整合平台 API package。

⚠️ 此檔刻意保持「空」（只有 docstring）。FastAPI app 主程式在 `api.main`。

原因：`import api.xxx`（任何子模組）都會先執行本 package 的 __init__。
若這裡 import 了 FastAPI / 所有 router / middleware，則 celery worker、beat、
healthcheck、任何 `import api.core.*` 都會把整個 Web app 載進來 → 啟動慢、吃 CPU/記憶體。
保持空檔，讓 web 層只在真正需要時（`api.main:app`）才載入。
"""
