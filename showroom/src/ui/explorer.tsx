import { vehicleById } from '../vehicles'
import { RiArrowLeftLine, RiCameraLine, RiCarLine, RiRefreshLine, RiSteering2Line } from '@remixicon/react'
import { Button } from '@/components/base/buttons/button'
import { Chip } from '@/components/base/badges/chip'
import { SegmentedControl, SegmentedControlItem } from '@/components/base/segmented-control/segmented-control'
import { actions } from '../controller'
import { DockPopover, PaintPicker, SoundButton, VehiclePicker, useStudio } from './controls'
import { LoadingStatus } from './dialogs'
import { VehicleControls, vehiclePhaseLabel } from './vehicle-controls'

export function Explorer() {
  const state = useStudio()
  if (!state.exploring) return null
  const { mode, vehicle, phase, reduced } = state
  const selected = vehicleById(state.vehicleId)
  const live = mode === 'ready'
  const phaseLabel = vehiclePhaseLabel(mode, phase, vehicle.driving, vehicle.doors)
  const hint = !selected.articulated && !live ? mode === 'loading' ? '正在载入所选车型' : '摄影定帧 · 可重试 3D 或切换车辆' : !live ? mode === 'static' && vehicle.driving ? '行驶定帧 · 启用 3D 后可调节车速' : '摄影定帧 · 可切换机位、车门与行驶状态'
    : reduced && vehicle.driving ? '已减少动态效果 · 手动车轮演示，背景静止'
    : vehicle.cockpit ? '拖动或使用方向键转头 · 展厅模拟仪表' : '拖动车身环绕 · 滚轮或双指缩放'
  return (
    <section id="explorer" className="studio-explorer" role="dialog" aria-modal="true" aria-label="车辆交互展厅" aria-describedby="viewer-hint" aria-owns="car">
      <header className="explorer-header">
        <div className="header-main">
          <div className="flex items-center gap-3">
            <Button id="close-explorer" variant="secondary" className="site-nav-link text-headline-medium" leadingIcon={RiArrowLeftLine} onClick={actions.closeViewer}>返回叙事</Button>
            <span className="studio-wordmark text-headline-medium text-text-secondary">MOTION STUDIO</span>
          </div>
        </div>
      </header>
      <aside className="action-dock studio-panel" aria-label="展厅操作">
        <VehiclePicker />
        <PaintPicker />
        <SoundButton />
        <span className="dock-divider" aria-hidden />
        <DockPopover id="camera-settings" icon={RiCameraLine} label="视角" title="观察视角">
          <div className="view-controls">
            <SegmentedControl className="view-switch" aria-label="切换观察位置" selectedKeys={[vehicle.cockpit ? 'view-seat' : 'view-outside']}
              onSelectionChange={keys => actions.setCockpit(keys.has('view-seat'))}>
              <SegmentedControlItem id="view-outside"><RiCarLine aria-hidden className="me-2 size-4" />360° 外观</SegmentedControlItem>
              <SegmentedControlItem isDisabled={!selected.articulated} id="view-seat" aria-label="第一人称 · 驾驶席"><RiSteering2Line aria-hidden className="me-2 size-4" />驾驶席</SegmentedControlItem>
            </SegmentedControl>
            <div className="camera-controls">
              {!vehicle.cockpit && <div id="presets"><SegmentedControl aria-label="预设视角" selectedKeys={state.selectedPreset < 0 ? [] : [String(state.selectedPreset)]}
                onSelectionChange={keys => { const id = [...keys][0]; if (id !== undefined) actions.usePreset(Number(id)) }}>
                {['前侧', '侧面', '后侧'].map((label, i) => <SegmentedControlItem id={String(i)} key={i} data-preset={i}>{label}</SegmentedControlItem>)}
              </SegmentedControl></div>}
              <Button id="reset-view" size="small" variant="secondary" leadingIcon={RiRefreshLine} onClick={actions.resetView}>重置视角</Button>
            </div>
          </div>
        </DockPopover>
        <VehicleControls />
      </aside>
      <LoadingStatus />
      <div className="explorer-heading">
        <p className="text-body-medium text-text-secondary">{selected.make} · INTERACTIVE STUDIO</p>
        <h2>{selected.model} <span>{vehicle.cockpit ? '/ DRIVER' : '/ 360°'}</span></h2>
      </div>
      <div className="explorer-details">
        <div className="flex items-center gap-2">
          <Chip variant="subtle" color="cyan">{live ? '实时展厅' : mode === 'loading' ? '准备 3D' : '影像展厅'}</Chip>
          <span id="vehicle-phase" className="text-body-medium text-text-secondary" aria-live="polite">{phaseLabel}</span>
        </div>
        <p id="viewer-hint" className="text-body-regular lg:text-headline-regular text-text-secondary">{hint}</p>
      </div>
    </section>
  )
}
