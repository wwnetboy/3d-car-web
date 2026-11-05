// Azimuth is measured from the car's left flank (-Z) towards its nose (+X).
// Span is the width of the film gate in model space at the subject.
export interface Shot {
  id: string
  chapter: number
  label: string
  az: number
  el: number
  distance: number
  span: number
  target: [number, number, number]
  frame: [number, number]
  mobile: [number, number, number] // azimuth, elevation, horizontal span
  mobileY: number
  daylight: number
}

export const shots: Shot[] = [
  {
    id: 'reveal',
    chapter: 0,
    label: '揭幕',
    az: 37.5,
    el: 10,
    distance: 9.7,
    span: 7.23,
    target: [0.1, 0.53, 0],
    frame: [0.568, 0.582],
    mobile: [47, 14, 5.52],
    mobileY: 0.552,
    daylight: 0,
  },
  {
    id: 'design',
    chapter: 1,
    label: '形态与设计',
    az: 3,
    el: 4,
    distance: 11.4,
    span: 7.2,
    target: [0.02, 0.53, 0],
    frame: [0.55, 0.602],
    mobile: [5, 6.5, 6.05],
    mobileY: 0.59,
    daylight: 0.9,
  },
  {
    id: 'canopy',
    chapter: 1,
    label: '水滴座舱',
    az: 16,
    el: 25,
    distance: 8.0,
    span: 6.5,
    target: [0.08, 0.63, 0],
    frame: [0.575, 0.606],
    mobile: [21, 28, 6.0],
    mobileY: 0.58,
    daylight: 0.97,
  },
  {
    id: 'aero',
    chapter: 2,
    label: '风洞',
    az: 25,
    el: 9,
    distance: 10.1,
    span: 8.45,
    target: [0.12, 0.56, 0],
    frame: [0.55, 0.628],
    mobile: [29, 15, 7.55],
    mobileY: 0.595,
    daylight: 0,
  },
  {
    id: 'wheel',
    chapter: 3,
    label: '涡流轮罩',
    az: 14,
    el: 7,
    distance: 3.25,
    span: 2.68,
    target: [1.59, 0.457, -0.99],
    frame: [0.63, 0.55],
    mobile: [12, 8, 1.95],
    mobileY: 0.59,
    daylight: 0.19,
  },
  {
    id: 'lamp',
    chapter: 3,
    label: '十字前灯',
    az: 57,
    el: 12,
    distance: 3.45,
    span: 2.95,
    target: [2.19, 0.48, -0.67],
    frame: [0.66, 0.55],
    mobile: [58, 14, 2.26],
    mobileY: 0.59,
    daylight: 0.06,
  },
  {
    id: 'tail',
    chapter: 3,
    label: '环形尾灯',
    az: -72,
    el: 8.5,
    distance: 4.8,
    span: 4.0,
    target: [-1.98, 0.48, -0.09],
    frame: [0.61, 0.56],
    mobile: [-74, 11, 3.55],
    mobileY: 0.59,
    daylight: 0.04,
  },
  {
    id: 'explore',
    chapter: 4,
    label: '自由探索',
    az: -31,
    el: 11,
    distance: 9.85,
    span: 7.15,
    target: [-0.06, 0.53, 0],
    frame: [0.56, 0.59],
    mobile: [-46, 14, 5.85],
    mobileY: 0.57,
    daylight: 0.04,
  },
]

export const chapters = [
  ['揭幕', 'REVEAL', 'reveal'],
  ['设计', 'FORM', 'design'],
  ['风洞', 'WIND TUNNEL', 'aero'],
  ['细节', 'DETAIL', 'wheel'],
  ['探索', 'EXPLORE', 'explore'],
] as const

export const presets = [
  { name: '前侧', az: 35, el: 11 },
  { name: '侧面', az: 0, el: 5 },
  { name: '后侧', az: -39, el: 12 },
] as const

export interface VehicleSettings {
  cockpit: boolean
  doors: boolean
  driving: boolean
  targetKmh: number
}
// Both controls use km/h, including the wind tunnel's free-stream velocity.
export const driveSpeedRange = { min: 1, max: 300, initial: 120 }
export const parked: VehicleSettings = {
  cockpit: false, doors: false, driving: false, targetKmh: driveSpeedRange.initial,
}

export const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x))
export const mix = (a: number, b: number, t: number) => a + (b - a) * t
export const smooth = (x: number) => x * x * (3 - 2 * x)

// The middle third of each shot is a reading hold. Only the intervening
// portion of the scroll moves the camera, in either direction.
export function segment(position: number, reduced = false) {
  const index = Math.floor(clamp(position, 0, shots.length - 1))
  const next = Math.min(index + 1, shots.length - 1)
  const fraction = position - index
  const t = reduced ? Number(fraction >= 0.5) : smooth(clamp((fraction - 0.24) / 0.52))
  return { a: shots[index], b: shots[next], t, index: fraction < 0.5 ? index : next }
}
