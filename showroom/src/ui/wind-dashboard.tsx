import { RiInformationLine } from '@remixicon/react'
import { Button } from '@/components/base/buttons/button'
import { actions } from '../controller'
import { estimateDragCoefficient, referenceCd } from '../aerodynamics'
import { shots } from '../story'
import { vehicleById } from '../vehicles'
import { useStudio } from './controls'

export function WindDashboard() {
  const state = useStudio()
  if (state.exploring || state.vehicle.cockpit || shots[state.shotIndex].id !== 'aero') return null
  const selected = vehicleById(state.vehicleId)
  const calibrated = selected.flowKind === 'cfd'
  const pressure = .5 * 1.225 * (state.windKmh / 3.6) ** 2
  return <aside className="wind-dashboard" aria-label="风洞实时数据">
    <div className="wind-subject text-headline-medium text-text-primary">{selected.name}</div>
    <dl className="wind-metrics">
      <div className="wind-cd">
        <dt className="text-body-medium text-text-secondary">风阻系数 C<sub>d</sub></dt>
        <dd id="drag-coefficient" className="text-title-1-medium md:text-display-1-medium text-text-primary tabular-nums">{calibrated ? estimateDragCoefficient(state.windKmh).toFixed(3) : '—'}</dd>
        <dd id="drag-condition" className="text-body-regular text-text-tertiary">{calibrated ? '展示估算 · 参考 ' + referenceCd.toFixed(2) : '尚未标定'}</dd>
      </div>
      <div>
        <dt className="text-body-medium text-text-secondary">来流速度</dt>
        <dd className="text-title-1-medium text-text-primary tabular-nums">{state.windKmh}<span className="ms-1 text-body-regular text-text-tertiary">km/h</span></dd>
      </div>
      <div>
        <dt className="text-body-medium text-text-secondary">动压</dt>
        <dd className="text-title-1-medium text-text-primary tabular-nums">{(pressure / 1000).toFixed(2)}<span className="ms-1 text-body-regular text-text-tertiary">kPa</span></dd>
      </div>
    </dl>
    <div className="wind-data-footer">
      <span className="text-body-regular text-text-secondary">{state.smokeOn ? '烟源开启' : '烟源暂停'} · {state.windKmh} km/h</span>
      <Button variant="ghost" size="small" leadingIcon={RiInformationLine} onClick={() => actions.setSheet('method')}>数据说明</Button>
    </div>
    <p id="wind-view-hint" className="sr-only">拖动调整视角 · 滚轮或双指放大查看</p>
  </aside>
}
