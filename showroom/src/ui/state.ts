import { vehicleById, type VehicleId } from '../vehicles'
import { driveSpeedRange, parked } from '../story'
import type { VehiclePhase } from '../vehicle'

// Swatches are model/material data, not interface theme colors.
export const paints = [
  { id: 'original', name: '模型原色', color: '#95E7DF', srgb: null },
  { id: 'titanium', name: '钛银', color: '#C3C6C8', srgb: '#C3C6C8' },
  { id: 'cobalt', name: '钴蓝', color: '#5279B3', srgb: '#5279B3' },
  { id: 'carmine', name: '绯红', color: '#BC454D', srgb: '#BC454D' },
] as const

export type PaintId = typeof paints[number]['id']
export type Sheet = 'menu' | 'about' | 'method' | null
export interface StudioState {
  vehicleId: VehicleId
  mode: 'loading' | 'ready' | 'static'
  shotIndex: number
  exploring: boolean
  vehicle: typeof parked
  phase: VehiclePhase
  paint: PaintId
  selectedPreset: number
  smokeOn: boolean
  windKmh: number
  driveKmh: number
  soundOn: boolean
  soundAvailable: boolean
  reduced: boolean
  sheet: Sheet
  loadVisible: boolean
  loadText: string
  loadProgress: number | null
  loadAction: 'retry' | 'skip' | null
}

let snapshot: StudioState = {
  vehicleId: 'vision-gt', mode: 'loading', shotIndex: 0, exploring: false,
  vehicle: { ...parked }, phase: 'parked', paint: 'original', selectedPreset: 0,
  smokeOn: true, windKmh: driveSpeedRange.initial, driveKmh: driveSpeedRange.initial,
  soundOn: false, soundAvailable: 'AudioContext' in window,
  reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
  sheet: null, loadVisible: true, loadText: '正在准备展厅', loadProgress: null, loadAction: null,
}
const listeners = new Set<() => void>()
export const studioStore = {
  getSnapshot: () => snapshot,
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
}
export function updateUI(patch: Partial<StudioState>) {
  if (Object.entries(patch).every(([key, value]) => Object.is(snapshot[key as keyof StudioState], value))) return
  snapshot = { ...snapshot, ...patch }
  listeners.forEach(listener => listener())
}

export function doorsAvailable(state: StudioState) {
  return vehicleById(state.vehicleId).articulated && !state.vehicle.driving && (state.mode !== 'ready' || !['braking', 'starting', 'running'].includes(state.phase))
}
