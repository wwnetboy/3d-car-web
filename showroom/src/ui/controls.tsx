import { vehicleById, vehicles, type VehicleId } from '../vehicles'
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { RiCarLine, RiVolumeMuteLine, RiVolumeUpLine } from '@remixicon/react'
import { Button, type ButtonProps } from '@/components/base/buttons/button'
import { Popover, PopoverHeader, PopoverTrigger } from '@/components/base/popover/popover'
import { RadioGroup } from '@/components/base/radio/radio'
import { RadioCard } from '@/components/base/radio/radio-card'
import { Slider } from '@/components/base/slider/slider'
import { cx } from '@/utils/cx'
import { actions } from '../controller'
import { driveSpeedRange } from '../story'
import { paints, studioStore, type PaintId } from './state'

export const useStudio = () => useSyncExternalStore(studioStore.subscribe, studioStore.getSnapshot)

export function DockButton({ className, variant = 'secondary', ...props }: ButtonProps) {
  return <Button variant={variant} className={cx('dock-button text-body-medium', variant !== 'primary' && 'border-transparent bg-transparent shadow-none', className)} {...props} />
}

export function DockPopover({ id, icon, label, title, children }: {
  id: string; icon: ButtonProps['leadingIcon']; label: string; title: string; children: ReactNode
}) {
  const { shotIndex, sheet } = useStudio()
  const [open, setOpen] = useState(false)
  useEffect(() => { setOpen(false) }, [shotIndex, sheet])
  return <PopoverTrigger isOpen={open} onOpenChange={setOpen}>
    <DockButton id={id} leadingIcon={icon} aria-label={title}>{label}</DockButton>
    <Popover placement="top end" className="studio-popover" containerPadding={12}>
      <PopoverHeader title={title} />
      {children}
    </Popover>
  </PopoverTrigger>
}

export function PaintPicker() {
  const { paint, shotIndex, sheet, vehicleId, mode } = useStudio()
  const definition = vehicleById(vehicleId)
  const [open, setOpen] = useState(false)
  const selected = paints.find(item => item.id === paint)!
  const swatch = paint === 'original' ? definition.swatch : selected.color
  useEffect(() => { setOpen(false) }, [shotIndex, sheet])
  return (
    <PopoverTrigger isOpen={open} onOpenChange={setOpen}>
      <DockButton disabled={!definition.articulated && mode !== 'ready'} id="paint-summary" className="paint-trigger" aria-label={'车身配色，当前为' + selected.name}>
        <span className="paint-trigger-content"><span aria-hidden className="paint-swatch" style={{ backgroundColor: swatch }} /><span>配色</span></span>
      </DockButton>
      <Popover placement="top end" className="studio-popover paint-popover" containerPadding={12}>
        <div id="paint-picker" data-studio-popover>
          <PopoverHeader title="车身配色" description="四种涂装，从每个角度探索。" />
          <RadioGroup aria-label="车身配色" name="body-paint" value={paint} onChange={id => actions.setPaint(id as PaintId)} className="my-4">
            {paints.map(item => (
              <RadioCard key={item.id} value={item.id} aria-label={item.name}
                title={<span className="flex items-center gap-3"><span aria-hidden className="paint-swatch large" style={{ backgroundColor: item.id === 'original' ? definition.swatch : item.color }} />{item.name}</span>}
              />
            ))}
          </RadioGroup>
          <p id="paint-caption" className="text-body-regular text-text-secondary" aria-live="polite">
            {selected.srgb ? selected.name + ' · 概念配色预览' : definition.articulated ? '青绿为模型原色，其余为概念配色预览。' : '保留模型原始材质，其余为概念配色预览。'}
          </p>
        </div>
      </Popover>
    </PopoverTrigger>
  )
}

export function SoundButton() {
  const { soundOn, soundAvailable } = useStudio()
  if (!soundAvailable) return null
  return <DockButton id="sound" leadingIcon={soundOn ? RiVolumeUpLine : RiVolumeMuteLine}
    aria-label={soundOn ? '关闭环境音' : '开启环境音'} aria-pressed={soundOn}
    title={soundOn ? '关闭环境音' : '开启环境音'} onClick={() => void actions.toggleSound()}>声音</DockButton>
}

export function SpeedControl({ kind }: { kind: 'wind' | 'drive' }) {
  const state = useStudio()
  const wind = kind === 'wind'
  const label = wind ? '风洞风速' : '目标车速'
  const value = wind ? state.windKmh : state.driveKmh
  return (
    <div id={wind ? 'wind-speed-control' : 'drive-speed-control'} className="speed-control">
      <div className="flex items-center justify-between gap-3 text-body-medium">
        <span className="text-text-secondary">{label}</span>
        <span className="text-text-primary tabular-nums"><strong id={wind ? 'wind-speed-number' : 'drive-speed-number'}>{value}</strong><span className="ms-1 text-text-tertiary">km/h</span></span>
      </div>
      <Slider id={wind ? 'wind-speed' : 'drive-speed'} aria-label={label} thumbLabel={label + '，公里每小时'}
        minValue={driveSpeedRange.min} maxValue={driveSpeedRange.max} step={1} value={value}
        onChange={wind ? actions.setWindSpeed : actions.setDriveSpeed}
        isDisabled={state.mode !== 'ready'} showTooltip={false}
        formatOptions={{ style: 'unit', unit: 'kilometer-per-hour' }} />
    </div>
  )
}

export function VehiclePicker() {
  const { vehicleId } = useStudio()
  const [open, setOpen] = useState(false)
  const selected = vehicleById(vehicleId)
  return <PopoverTrigger isOpen={open} onOpenChange={setOpen}>
    <DockButton id="vehicle-picker" leadingIcon={RiCarLine} aria-label={'切换车辆，当前为' + selected.name}>车型</DockButton>
    <Popover placement="top end" className="studio-popover" containerPadding={12}>
      <PopoverHeader title="切换车辆" description="选择车型，在同一座展厅中探索。" />
      <RadioGroup aria-label="选择车辆" name="vehicle-model" value={vehicleId} className="my-4"
        onChange={id => { actions.selectVehicle(id as VehicleId); setOpen(false) }}>
        {vehicles.map(item => <RadioCard key={item.id} value={item.id} title={item.name} />)}
      </RadioGroup>
      <p className="text-body-regular text-text-secondary">三款车型均支持行驶演示、配色预览与风洞烟流。</p>
    </Popover>
  </PopoverTrigger>
}
