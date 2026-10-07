# 🥚 茶葉蛋養成計畫（tea-egg）

寫 code 的時候，在 Claude Code 裡養一顆泡在滷汁裡的蛋。你每完成一件事，蛋就入味一點；大約一週後出鍋。

```
 🥚(•ᴗ•)  小蛋 #3 ｜ 入味 ██████░░░░ 62% ｜ 滷汁 ███░░ ｜ 茶香越來越濃了…
```

## 安裝

```
/plugin install tea-egg --marketplace helenlin0621/tea-egg
```

需要 Claude Code 2.1.289 以上（可用 `claude update` 更新）。

## 指令

| 指令 | 功能 |
|---|---|
| `/egg` | 開啟／關閉面板 |
| `/egg refill` | 加滷汁 |
| `/egg flip` | 翻面 |
| `/egg dex` | 顯示圖鑑 |
| `/egg name <名字>` | 幫目前的蛋取名 |
| `/egg help` | 說明 |

出鍋結果由你的寫 code 習慣決定，蒐集全部的蛋吧！

## 安全

| 網路 | 執行程式 | 讀寫檔案 | 呼叫 AI | 傳送資料 | 阻擋或修改指令 |
|---|---|---|---|---|---|
| No | No | No | No | No | No |

- 這個 Mod 只「看」Bash／PowerShell 指令的文字與成功與否，用來判斷有沒有跑測試、有沒有下危險指令；比對清單公開在 `hooks/detect.ts`。
- 所有資料只存在 Claude Code 為這個 Mod 保留的本機儲存區。
- 圖鑑內容經過編碼以防劇透，詳見 `hooks/spoilers.ts` 開頭說明。
