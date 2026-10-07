// 圖鑑條件與彩蛋內容經過 base64 編碼，避免劇透收集的樂趣。
// 這裡只有文字和數字資料，沒有任何程式邏輯、網路或檔案操作。
// 想看的話：呼叫 decodeSpoilers()，或把字串貼到任何 base64 解碼工具。
// 本檔由 scripts/encode-spoilers.ts 產生，請勿手動修改。
import type { Spoilers } from './spoiler-types'

export const SPOILERS =
  "eyJjcmFja1RvYXN0Ijoi8J+SpSDllarvvIHom4vooqsgYHtrd31gIOWah+egtOS6huKApuKApuiuiuaIkHtuYW1lfSB7aWNv" +
  "bn0iLCJkYXRlTW9kZSI6eyJiYW5kIjp7ImJhciI6IuS6uumhnuWFpeWRsyIsImZhY2UiOiIowqzigL/CrCkiLCJoaW50cyI6" +
  "WyLkvaDogZ7otbfkvobpgoTlvojnlJ/igKYiLCLkvaDnnIvotbfkvobmnInpu57pubnigKYiLCLkvaDplovlp4vmnInmu7fl" +
  "kbPkuobigKYiLCLkvaDlv6vooqvmu7fpgI/kuobigKYiXSwiaWNvbiI6IvCfkKMiLCJ0aXRsZSI6IuWwj+mbnuato+WcqOa7" +
  "t+S9oCJ9LCJkYXkiOjEsImRleFRpdGxlIjoi5Lq66aGe5ZyW6ZGRIiwiaHVtYW5TdGVwIjoyLCJsaW5lcyI6eyJkYW5nZXIi" +
  "Olsi5Lq66aGe5Y+I5Zyo546p5Y2x6Zqq55qE5p2x6KW/5LqG77yM5bCP6Zue6KaB6Lef5L2g5aq96KybIl0sIm1ha2V1cCI6" +
  "IuaYqOWkqeaYr+aEmuS6uuevgOWWlCDwn4OPIOS9oOmMr+mBjuS6huWwj+mbnu+8jOS9huaEmuS6uuibi+mChOaYr+e1puS9" +
  "oCIsInJldmVhbCI6IvCfjokg5oSa5Lq656+A5b+r5qiC77yB5bCP6Zue5piO5aSp5pyD57iu5Zue6JuL5q686KOh44CC6YCB" +
  "5L2g5LiA6aGG57SA5b+15ZOBIOKGkiIsInRlc3RGYWlsIjpbIuaykumXnOS/gu+8jOS6uumhnuacrOS+huWwseaYr+mAmeao" +
  "oyIsIuWwj+mbnuW3sue2k+e/kuaFo+S6hiJdLCJ0ZXN0UGFzcyI6WyLpm6PlvpfllpTvvIzntabkvaDkuIDpoYbpo7zmlpki" +
  "XSwidHVybiI6WyLmiJHnmoTkurrpoZ7ku4rlpKnlvojkuZbvvIzlj6rlr6vkuoYgMyDlgIsgYnVnIPCfjawiLCLkurrpoZ7l" +
  "j4jlrozmiJDkuIDku7bkuovkuobvvIzlpb3mo5Lmo5IiLCLmu7fkuobkvaDkuIDmlbTlpKnvvIzpgoTmmK/mspLku4Dpurzl" +
  "kbPpgZMiXX0sIm1vbnRoIjo0LCJwcml6ZSI6Ing5IiwicmVwbGllcyI6eyJmbGlwIjoi5bCP6Zue6Kmm5ZyW5oqK5L2g57+7" +
  "6Z2i77yM5aSx5pWX5LqGIiwicmVmaWxsIjoi5bCP6Zue5bmr5L2g5YCS5LqG5LiA5p2v5rC044CC5Lq66aGe6KaB5aSa5Zad" +
  "5rC0IPCfkqcifSwicmV2ZWFsSG91ciI6MTcsInRocm90dGxlTXMiOjYwMDAwMH0sImRleFNsb3RzIjpbImU4IiwiZTYiLCJl" +
  "NCIsImUxIiwiZTciLCJlMyIsImU1IiwiZTIiLCJ4OSJdLCJlZ2dzIjp7ImUxIjp7Imljb24iOiLwn42zIiwibmFtZSI6IuiN" +
  "t+WMheibiyJ9LCJlMiI6eyJpY29uIjoi4pyoIiwibmFtZSI6IumHkeibiyJ9LCJlMyI6eyJpY29uIjoi8J+WpCIsIm5hbWUi" +
  "OiLnmq7om4sifSwiZTQiOnsiaWNvbiI6IvCfp4IiLCJuYW1lIjoi6bm56JuLIn0sImU1Ijp7Imljb24iOiLwn5SpIiwibmFt" +
  "ZSI6IumQteibiyJ9LCJlNiI6eyJpY29uIjoi8J+NsiIsIm5hbWUiOiLmu7fom4sifSwiZTciOnsiaWNvbiI6IuKZqO+4jyIs" +
  "Im5hbWUiOiLmuqvms4nom4sifSwiZTgiOnsiaWNvbiI6IvCfpZoiLCJuYW1lIjoi6Iy26JGJ6JuLIn0sIng5Ijp7Imljb24i" +
  "OiLwn4OPIiwibmFtZSI6IuaEmuS6uuibiyJ9fSwiaGludHMiOnsiZTMiOiLom4vmrrzlpb3lg4/mnInpu57nmbzntqDigKYi" +
  "LCJlNCI6Iuibi+auvOWGkuWHuuS6hum5veiKseKApiIsImU1Ijoi6YCZ6aGG6JuL6LaK5L6G6LaK56Gs5LqG4oCmIiwiZTYi" +
  "OiLogZ7otbfkvobmnInmv4Pmv4PnmoTmu7flkbPigKYiLCJlNyI6IuaRuOi1t+S+hua6q+a6q+i7n+i7n+eahOKApiIsImU4" +
  "Ijoi6Iy26aaZ6LaK5L6G6LaK5r+D5LqG4oCmIn0sInJ1bGVzIjpbeyJlZ2ciOiJlMSIsIndoZW4iOiJjcmFja2VkIn0seyJl" +
  "Z2ciOiJlMiIsInAiOjAuMDEsIndoZW4iOiJjaGFuY2UifSx7ImRheXMiOjMsImVnZyI6ImUzIiwid2hlbiI6ImdhcEF0TGVh" +
  "c3QifSx7ImVnZyI6ImU0IiwibWluUnVucyI6NSwicmF0ZSI6MC41LCJ3aGVuIjoiZmFpbFJhdGVBYm92ZSJ9LHsiZGF5cyI6" +
  "MjEsImVnZyI6ImU1Iiwid2hlbiI6ImFnZUF0TGVhc3QifSx7ImVnZyI6ImU2IiwibWludXRlcyI6MTIwLCJ3aGVuIjoiYXZn" +
  "U2Vzc2lvbkFib3ZlIn0seyJlZ2ciOiJlNyIsIm1pbnV0ZXMiOjIwLCJ3aGVuIjoiYXZnU2Vzc2lvbkJlbG93In0seyJlZ2ci" +
  "OiJlOCIsIndoZW4iOiJhbHdheXMifV0sInNwcml0ZXMiOnt9fQ=="

let cache: Spoilers | null = null

export function decodeSpoilers(): Spoilers {
  if (cache === null) {
    const bytes = Uint8Array.from(atob(SPOILERS), c => c.charCodeAt(0))
    cache = JSON.parse(new TextDecoder().decode(bytes)) as Spoilers
  }
  return cache
}
