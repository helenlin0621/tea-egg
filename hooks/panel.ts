import type { Save } from '../types'
import type { LocalTime } from './clock'
import { compose, rasterCells, svgSource, SIZE, type Layer } from './pixels'
import { decodeSpoilers } from './spoilers'
import { FACE_BOX, PALETTE, SPRITES } from './sprites'
import { SPRITES_HD } from './sprites-hd'
import { FACE_TEXT, STAGE_NAME, bar, faceOf, hintOf, stageOf, strWidth } from './view'

// 像素圖放越大越顯得粗，3 倍（144px）看起來最精緻
const SVG_SCALE = 3
export const SVG_PX = SIZE * SVG_SCALE
// 深褐底色卡：白色蒸氣在淺色主題下才看得見
const SVG_BACKGROUND = '#3b2f2a'

export const ASCII_EGG: readonly string[][] = [
  ['  .-""-.  ', ' /      \\ ', '|  FACE  |', ' \\      / ', "  '-..-'  "],
  ['  .-""-.  ', ' / ╱    \\ ', '|  FACE  |', ' \\    ╲ / ', "  '-..-'  "],
  ['  .-""-.  ', ' /▓╱▓▓▓▓\\ ', '|▓ FACE ▓|', ' \\▓▓▓╲▓▓/ ', "  '-..-'  "],
  ['  .-""-.  ', ' /█╱████\\ ', '|█ FACE █|', ' \\███╲██/ ', "  '-..-'  "],
]

export type Art = { kind: 'raster'; cells: string } | { kind: 'svg'; source: string } | { kind: 'ascii'; lines: string[] }

// 階段圖本身就是笑臉：開心／普通用階段圖，其餘表情用 face_<表情> 整張圖。
// 不做臉部疊圖（FACE_BOX 為 null）；仍回傳圖層陣列，之後的成長提示圖層加在最後即可
function eggSpriteKey(s: Save, t: LocalTime, now: number): string {
  const face = faceOf(s, t, now)
  return face === 'happy' || face === 'normal' ? `stage${stageOf(s.egg.progress)}` : `face_${face}`
}

export function eggLayers(s: Save, t: LocalTime, now: number): Layer[] {
  const key = eggSpriteKey(s, t, now)
  const base = SPRITES[key]
  const layers: Layer[] = []
  // FACE_BOX 分支目前用不到，保留給之後的疊圖圖層
  if (base) layers.push(FACE_BOX && key.startsWith('face_') ? { pixels: base, box: FACE_BOX } : { pixels: base })
  return layers
}

function artOf(pixels: string, surface: string): Art {
  return surface === 'terminal'
    ? { kind: 'raster', cells: rasterCells(pixels, PALETTE) }
    : { kind: 'svg', source: svgSource(pixels, PALETTE, SVG_SCALE, SVG_BACKGROUND) }
}

// 桌面版：有原圖高解析 PNG 就嵌進 SVG（深褐底卡 + <image>），否則退回像素 SVG
function hdArt(b64: string | undefined): Art | null {
  if (!b64) return null
  const href = `data:image/png;base64,${b64}`
  const px = SVG_PX
  return {
    kind: 'svg',
    source:
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${px} ${px}" width="${px}" height="${px}">` +
      `<rect width="${px}" height="${px}" rx="9" fill="${SVG_BACKGROUND}"/>` +
      `<image width="${px}" height="${px}" href="${href}" xlink:href="${href}"/></svg>`,
  }
}

const FACE_COLS = 4

// 依顯示寬度截斷再補空白（全形字佔 2 格、組合字元佔 0 格）
function fitWidth(text: string, cols: number): string {
  let out = ''
  for (const ch of text) {
    if (strWidth(out + ch) > cols) break
    out += ch
  }
  return out + ' '.repeat(cols - strWidth(out))
}

export function eggArt(s: Save, t: LocalTime, now: number, surface: string, columns: number): Art {
  const layers = eggLayers(s, t, now)
  const tooNarrow = surface === 'terminal' && columns < SIZE
  if (layers.length === 0 || tooNarrow) {
    const stage = stageOf(s.egg.progress)
    // 外框裡只放 4 格寬的臉（去掉括號），維持對齊
    const face = fitWidth(FACE_TEXT[faceOf(s, t, now)].replace(/[()]/g, ''), FACE_COLS)
    return { kind: 'ascii', lines: [...ASCII_EGG[stage]!.map(l => l.replace('FACE', face)), `   ${STAGE_NAME[stage]}`] }
  }
  if (surface !== 'terminal') {
    const hd = hdArt(SPRITES_HD[eggSpriteKey(s, t, now)])
    if (hd) return hd
  }
  return artOf(compose(layers), surface)
}

// 圖鑑圖（C/D 組素材）還沒做：取不到就回 null，圖鑑只顯示文字
export function dexArt(id: string, owned: boolean, surface: string): Art | null {
  const pixels = owned ? decodeSpoilers().sprites[id] : SPRITES.locked
  if (!pixels) return null
  if (surface !== 'terminal') {
    const hd = hdArt(owned ? decodeSpoilers().spritesHd?.[id] : SPRITES_HD.locked)
    if (hd) return hd
  }
  return artOf(pixels, surface)
}

export function panelLines(s: Save, t: LocalTime, now: number): string[] {
  const hint = hintOf(s, now)
  return [
    `${s.egg.name} #${s.egg.no}  ${FACE_TEXT[faceOf(s, t, now)]}`,
    `入味 ${bar(s.egg.progress, 10)} ${Math.floor(s.egg.progress)}%`,
    `滷汁 ${bar(s.egg.broth, 10)} ${Math.round(s.egg.broth)}`,
    `心情 ${bar(s.egg.mood, 10)} ${Math.round(s.egg.mood)}`,
    ...(hint ? [hint] : []),
  ]
}
