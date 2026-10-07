// 產生假的拼圖素材到 art-build/test-source/，用來驗證 build-sprites.ts（不依賴正式素材）。
// 用法：npm run test-sheet
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pngjs from 'pngjs'

const { PNG } = pngjs
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'art-build', 'test-source')

type Sheet = { file: string; cells: string[] }

// n 顆蛋排成一列，蛋之間與四周是洋紅色分隔
function sheet(n: number, color: [number, number, number]): Buffer {
  const png = new PNG({ width: n * 70 + 10, height: 80 })
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const i = (y * png.width + x) * 4
      const k = Math.floor((x - 10) / 70)
      const cx = 10 + k * 70 + 30
      const inEgg = k >= 0 && k < n && ((x - cx) / 25) ** 2 + ((y - 40) / 30) ** 2 <= 1
      const inEye = inEgg && (x - (cx - 7)) ** 2 + (y - 38) ** 2 <= 9
      const rgb = inEye ? [0, 0, 0] : inEgg ? color : [255, 0, 255]
      png.data.set([rgb[0]!, rgb[1]!, rgb[2]!, 255], i)
    }
  }
  return PNG.sync.write(png)
}

const manifest = JSON.parse(readFileSync(join(ROOT, 'art-source', 'manifest.json'), 'utf8')) as { sheets: Sheet[] }
mkdirSync(OUT, { recursive: true })
manifest.sheets.forEach((s, i) => {
  writeFileSync(join(OUT, s.file), sheet(s.cells.length, [240 - i * 30, 220 - i * 25, 200 - i * 20]))
})
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest), 'utf8')
console.log(`已產生 ${manifest.sheets.length} 張測試拼圖到 art-build/test-source`)
