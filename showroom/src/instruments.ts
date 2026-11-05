import * as THREE from 'three'
import { driveSpeedRange } from './story'

// Two local OLED textures. The wheel sheet also carries the faces of its
// four rotary controls, so all five instruments share a single upload.
function panel(width: number, height: number) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { alpha: false })!
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.generateMipmaps = true
  texture.anisotropy = 4
  return { ctx, texture }
}

type Ink = CanvasRenderingContext2D
const paper = '#edf4ec'
const citron = '#ddeb74'
const ice = '#87d9ee'
const muted = '#94a5a5'
const tau = Math.PI * 2

function text(ctx: Ink, value: string, x: number, y: number, size: number, color: string, bold = false) {
  ctx.font = (bold ? '600 ' : '500 ') + size + 'px Arial, sans-serif'
  ctx.fillStyle = color
  ctx.fillText(value, x, y)
}

function line(ctx: Ink, points: number[][], color: string, width = 1) {
  ctx.beginPath()
  ctx.moveTo(points[0][0], points[0][1])
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1])
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.stroke()
}

function panoramic(ctx: Ink, kmh: number, travel: number, time: number, door: number) {
  const driving = kmh > 0.05
  const accent = driving ? citron : ice
  ctx.fillStyle = '#080d10'
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  // Two tapered, backlit scales leave a quiet interval around the speed.
  for (let i = 0; i < 20; i++) {
    const rise = i * 1.75
    const active = i < 2 + 18 * kmh / driveSpeedRange.max
    ctx.fillStyle = active ? accent : '#344348'
    ctx.fillRect(40 + i * 6, 57 - rise, 3, 4 + rise * .45)
    ctx.fillRect(1187 - i * 6, 57 - rise, 3, 4 + rise * .45)
  }
  text(ctx, 'VELOCITY', 195, 17, 13, muted)
  const digits = String(Math.round(kmh)).padStart(2, '0')
  text(ctx, digits, 190, 65, 51, paper, true)
  text(ctx, 'km/h', Math.max(262, 202 + ctx.measureText(digits).width), 62, 19, paper)
  const trip = travel < 1000 ? Math.floor(travel) + ' m' : (travel / 1000).toFixed(2) + ' km'
  text(ctx, 'TRIP', 352, 18, 14, muted)
  text(ctx, trip, 351, 55, 31, accent, true)

  // A moving perspective grid on the panoramic glass, tied to road distance.
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(505, 42)
  ctx.lineTo(556, 7)
  ctx.lineTo(820, 7)
  ctx.lineTo(871, 42)
  ctx.lineTo(816, 74)
  ctx.lineTo(560, 74)
  ctx.closePath()
  ctx.clip()
  const wash = ctx.createRadialGradient(687, 19, 2, 687, 19, 140)
  wash.addColorStop(0, driving ? '#6d7834' : '#28535f')
  wash.addColorStop(1, '#111b20')
  ctx.fillStyle = wash
  ctx.fillRect(503, 5, 370, 72)
  const vanX = 687, vanY = 20
  for (const edge of [-170, -102, -60, 60, 102, 170])
    line(ctx, [[vanX + edge * .08, vanY], [vanX + edge, 76]], '#83938b', 1.3)
  const advance = (travel / 7.5) % 1
  for (let i = 0; i < 9; i++) {
    const depth = ((i + advance) / 9) ** 2
    const y = vanY + depth * 59, half = 14 + depth * 160
    line(ctx, [[vanX - half, y], [vanX + half, y]], '#52615b', 1)
    ctx.fillStyle = paper
    ctx.fillRect(vanX - 1 - depth, y, 2 + depth * 2, .8 + depth * 3)
  }
  if (!driving) {
    const y = 42 + 21 * Math.sin(time * 1.05)
    const scan = ctx.createLinearGradient(0, y - 9, 0, y + 9)
    scan.addColorStop(0, '#87d9ee00')
    scan.addColorStop(.5, '#87d9ee69')
    scan.addColorStop(1, '#87d9ee00')
    ctx.fillStyle = scan
    ctx.fillRect(505, y - 9, 366, 18)
  }
  ctx.restore()
  ctx.beginPath()
  ctx.moveTo(687, 42)
  ctx.lineTo(697, 64)
  ctx.lineTo(687, 60)
  ctx.lineTo(677, 64)
  ctx.closePath()
  ctx.fillStyle = paper
  ctx.fill()
  for (const sign of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const edge = vanX + sign * (164 + i * 6)
      line(ctx, [[edge - sign * 31, 9], [edge, 40], [edge - sign * 31, 71]], '#8c9a92', 1)
    }
  }
  text(ctx, driving ? 'DRIVE' : door > .02 ? 'ACCESS' : 'READY', 917, 48, 24, accent, true)
  text(ctx, 'STUDIO  /  SIM', 916, 66, 12, muted)
  const indicator = .65 + .35 * Math.cos(time * 1.35)
  ctx.globalAlpha = indicator
  ctx.fillStyle = accent
  ctx.fillRect(899, 29, 4, 19)
  ctx.globalAlpha = 1
}

function vehicleOutline(ctx: Ink, door: number) {
  ctx.save()
  ctx.translate(128, 128)
  ctx.beginPath()
  ctx.moveTo(0, -43)
  ctx.bezierCurveTo(13, -43, 19, -39, 20, -27)
  ctx.bezierCurveTo(23, -15, 20, -9, 19, -3)
  ctx.lineTo(21, 23)
  ctx.quadraticCurveTo(22, 40, 14, 42)
  ctx.quadraticCurveTo(0, 46, -14, 42)
  ctx.quadraticCurveTo(-22, 40, -21, 23)
  ctx.lineTo(-19, -3)
  ctx.bezierCurveTo(-20, -9, -23, -15, -20, -27)
  ctx.bezierCurveTo(-19, -39, -13, -43, 0, -43)
  ctx.closePath()
  ctx.fillStyle = '#253435'
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = paper
  ctx.stroke()
  line(ctx, [[-12, -17], [-9, -26], [9, -26], [12, -17], [10, 15], [0, 28], [-10, 15], [-12, -17]], '#b9ceca', 1.6)
  for (const side of [-1, 1]) {
    line(ctx, [[side * 11, -34], [side * 17, -29], [side * 18, -22]], ice, 2)
    line(ctx, [[side * 16, -8], [side * (17 + door * 16), 6], [side * (16 + door * 13), 14]],
      door > .03 ? citron : muted, 2)
    line(ctx, [[side * 6, -35], [side * 11, -29], [side * 13, -22]], '#879e9f')
    line(ctx, [[side * 11, 14], [side * 16, 22], [side * 14, 33], [side * 6, 36]], '#8fa6a6')
    for (const y of [-24, 20]) line(ctx, [[side * 21, y - 5], [side * 21, y + 5]], paper, 2.5)
  }
  line(ctx, [[0, -23], [0, 21]], '#4c6266')
  line(ctx, [[-13, 35], [0, 37], [13, 35]], muted)
  ctx.restore()
}

function wheel(ctx: Ink, kmh: number, travel: number, time: number, door: number) {
  const driving = kmh > .05, accent = driving ? citron : ice
  ctx.fillStyle = '#090e12'
  ctx.fillRect(0, 0, 384, 256)
  ctx.textAlign = 'center'
  for (let i = 0; i < 4; i++) {
    const selected = i === (driving ? 3 : 0)
    text(ctx, 'PRND'[i], 86 + i * 28, 43, 18, selected ? paper : '#637373', selected)
    if (selected) {
      ctx.fillStyle = accent
      ctx.fillRect(80 + i * 28, 48, 12, 2)
    }
  }
  // Etched fans and a moving edge of light frame the plan view of the car.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 12; i++) {
      const radius = 38 + i * 4.75
      const center = side === 1 ? 0 : Math.PI
      const pulse = .5 + .5 * Math.cos(i * .48 - time * 1.6 - travel * .09)
      ctx.strokeStyle = pulse > .86 ? accent : '#617879'
      ctx.lineWidth = pulse > .86 ? 1.8 : 1
      for (const gap of [-1, 1]) {
        ctx.beginPath()
        ctx.arc(128, 128, radius, center + gap * .39 - .28, center + gap * .39 + .28)
        ctx.stroke()
      }
    }
  }
  vehicleOutline(ctx, door)
  text(ctx, driving ? 'R O A D' : door > .03 ? 'E N T R Y' : 'R E A D Y', 128, 205, 14, accent, true)
  const readings = [String(Math.round(kmh)), driving ? 'D' : 'P', door > .03 ? 'OP' : 'CL', 'GT']
  const levels = [kmh / driveSpeedRange.max, driving ? .86 : .17, door, .46 + .18 * Math.sin(time * 1.1)]
  for (let i = 0; i < 4; i++) {
    const cx = 288 + (i % 2) * 64, cy = 64 + Math.floor(i / 2) * 112
    ctx.fillStyle = '#101719'
    ctx.beginPath()
    ctx.arc(cx, cy, 30, 0, tau)
    ctx.fill()
    ctx.strokeStyle = '#54676c'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(cx, cy, 24, -.9 * Math.PI, .69 * Math.PI)
    ctx.stroke()
    ctx.strokeStyle = accent
    ctx.lineWidth = 3
    ctx.beginPath()
    ctx.arc(cx, cy, 24, -.9 * Math.PI, (-.73 + levels[i] * 1.35) * Math.PI)
    ctx.stroke()
    text(ctx, readings[i], cx, cy + 5, 20, paper, true)
  }
  ctx.textAlign = 'left'
}

export function cockpitInstruments() {
  const dash = panel(1280, 80), controls = panel(384, 256)
  return {
    dash: dash.texture,
    wheel: controls.texture,
    draw(kmh: number, travel: number, time: number, door: number) {
      panoramic(dash.ctx, kmh, travel, time, door)
      wheel(controls.ctx, kmh, travel, time, door)
      dash.texture.needsUpdate = controls.texture.needsUpdate = true
    },
    dispose() {
      dash.texture.dispose()
      controls.texture.dispose()
    },
  }
}
