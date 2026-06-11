# k6 壓測操作

`scripts/load-test.js` 預設只執行公開讀取，不會寫入資料。

```bash
docker run --rm --network host \
  -v "$PWD/scripts:/scripts" grafana/k6 run /scripts/load-test.js
```

登入讀取需提供測試帳號的短效 access token：

```bash
AUTH_TOKEN=... DOCUMENT_ID=... k6 run scripts/load-test.js
```

寫入情境只能對隔離 PostgreSQL 測試資料庫執行，且需明確開啟：

```bash
ENABLE_WRITES=true AUTH_TOKEN=... \
APPROVAL_PATH=/documents/<id>/approve APPROVAL_BODY='{"comment":"k6"}' \
MEETING_PATH=/meetings/<id>/decisions MEETING_BODY='{"title":"k6"}' \
ORDER_PATH=/shop/orders ORDER_BODY='{"items":[]}' \
SURVEY_PATH=/surveys/<id>/responses SURVEY_BODY='{"answers":[]}' \
k6 run scripts/load-test.js
```

CI 或正式量測應輸出 `--summary-export` JSON 並保存 artifact。寫入測試完成後刪除隔離資料，
不得使用正式環境 Token 或既有公文、訂單、問卷資料。
