import { vehicleById } from '../vehicles'
import { RiDoorOpenLine, RiSteering2Line, RiStopCircleLine } from '@remixicon/react'
import { Button } from '@/components/base/buttons/button'
import { SegmentedControl, SegmentedControlItem } from '@/components/base/segmented-control/segmented-control'
import { actions } from '../controller'
import type { VehiclePhase } from '../vehicle'
import { doorsAvailable } from './state'
import { DockPopover, SpeedControl, useStudio } from './controls'

const phaseLabels: Record<VehiclePhase, string> = { parked: '驻车', opening: '开门中', open: '双门已开', closing: '关门中', starting: '起步', running: '行驶中', braking: '减速中' }

export function vehiclePhaseLabel(mode: string, phase: VehiclePhase, driving: boolean, doors: boolean) {
  return mode === 'ready' ? phaseLabels[phase] : driving ? '行驶定帧' : doors ? '双门开启 · 定帧' : '驻车定帧'
}

export function VehicleControls() {
  const state = useStudio()
  const { mode, vehicle, phase, reduced, exploring } = state
  const articulated = vehicleById(state.vehicleId).articulated
  const live = mode === 'ready'
  const stationary = doorsAvailable(state)
  const securing = vehicle.driving && ['open', 'opening', 'closing'].includes(phase)
  const doorLabel = stationary ? vehicle.doors ? '关闭双门' : '打开双门' : securing ? '关门中' : '车门已锁'
  const driveLabel = !live && !articulated ? '启用 3D 后行驶' : vehicle.driving ? '停车' : live ? reduced ? '播放车轮' : '开始行驶' : '查看行驶定帧'
  return <DockPopover id="vehicle-settings" icon={vehicle.driving ? RiStopCircleLine : RiSteering2Line} label="驾驶" title="车辆控制">
    <div className="vehicle-controls">
      <p id="drive-phase" className="text-body-medium text-text-secondary" role="status">{vehiclePhaseLabel(mode, phase, vehicle.driving, vehicle.doors)}</p>
      {!exploring && articulated && <SegmentedControl className="view-switch" aria-label="切换观察位置" selectedKeys={[vehicle.cockpit ? 'drive-seat' : 'drive-outside']}
        onSelectionChange={keys => actions.setCockpit(keys.has('drive-seat'))}>
        <SegmentedControlItem id="drive-outside">车外</SegmentedControlItem>
        <SegmentedControlItem id="drive-seat">驾驶席</SegmentedControlItem>
      </SegmentedControl>}
      <div className="vehicle-actions" role="group" aria-label="车辆状态">
        {articulated && <Button id="door-toggle" size="small" variant={vehicle.doors ? 'ghost' : 'secondary'} disabled={!stationary} aria-pressed={vehicle.doors} leadingIcon={RiDoorOpenLine} onClick={actions.toggleDoors}>{doorLabel}</Button>}
        <Button id="drive-toggle" disabled={!live && !articulated} size="small" aria-pressed={vehicle.driving} leadingIcon={vehicle.driving ? RiStopCircleLine : RiSteering2Line} onClick={actions.toggleDrive}>{driveLabel}</Button>
      </div>
      <SpeedControl kind="drive" />
      {!live && <p className="text-body-regular text-text-secondary">摄影定帧 · 启用 3D 后可调节车速</p>}
    </div>
  </DockPopover>
}
