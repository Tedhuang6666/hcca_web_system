"""品牌化 Email 範本系統。

- templates/ : MJML 原始檔（人工編輯）
- compiled/  : MJML 編譯產物 HTML（renderer 讀取；改範本後需 `npm run build` 重編並一起提交）
- renderer   : 讀 compiled HTML，以 Jinja2 注入變數
- sender     : 高階寄送層（render + 逐封 enqueue）
"""
