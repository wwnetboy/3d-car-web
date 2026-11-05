import { useLayoutEffect, useRef } from 'react'
import { RiArrowDownSLine, RiCameraLensLine, RiInformationLine, RiMenuLine, RiRefreshLine, RiSteering2Line, RiWindyLine } from '@remixicon/react'
import { Button, ButtonLink } from '@/components/base/buttons/button'
import { IconButton } from '@/components/base/buttons/icon-button'
import { ProgressBar } from '@/components/base/progress/progress'
import { SegmentedControl, SegmentedControlItem } from '@/components/base/segmented-control/segmented-control'
import { actions } from '../controller'
import { chapters, shots } from '../story'
import { DockButton, DockPopover, PaintPicker, SoundButton, SpeedControl, VehiclePicker, useStudio } from './controls'
import { LoadingStatus } from './dialogs'
import { VehicleControls } from './vehicle-controls'

function ChapterTools() {
  const state = useStudio()
  const shot = shots[state.shotIndex]
  if (shot.chapter === 2) return (
    <DockPopover id="wind-settings" icon={RiWindyLine} label="风洞" title="风洞控制">
    <div className="chapter-tools wind-toolbar" role="group" aria-label="风洞控制">
      <SpeedControl kind="wind" />
      <div id="wind-controls" className="context-actions">
        <Button id="smoke-toggle" variant={state.smokeOn ? 'ghost' : 'secondary'} size="small" aria-pressed={state.smokeOn} leadingIcon={RiWindyLine} onClick={actions.toggleSmoke}>{state.smokeOn ? '关闭喷烟' : '开启喷烟'}</Button>
        <Button id="wind-view-reset" size="small" variant="secondary" leadingIcon={RiRefreshLine} disabled={state.mode !== 'ready'} onClick={actions.resetWind} aria-label="复位风洞视角"><span className="reset-label">复位视角</span></Button>
        <IconButton size="small" icon={RiInformationLine} aria-label="模拟说明" title="模拟说明" onClick={() => actions.setSheet('method')} />
      </div>
    </div>
    </DockPopover>
  )
  if (shot.chapter === 3) return (
    <DockPopover id="detail-settings" icon={RiCameraLensLine} label="细节" title="细节镜头">
    <nav className="chapter-tools detail-toolbar" aria-label="细节镜头">
      <SegmentedControl aria-label="选择细节" selectedKeys={[shot.id]}
        onSelectionChange={keys => { const id = [...keys][0]; if (id) actions.go(shots.findIndex(item => item.id === id)) }}>
        {shots.filter(item => item.chapter === 3).map(item => <SegmentedControlItem id={item.id} key={item.id}>{item.label}</SegmentedControlItem>)}
      </SegmentedControl>
    </nav>
    </DockPopover>
  )
  return null
}

export function Header() {
  const { shotIndex, exploring } = useStudio()
  const headerRef = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const header = headerRef.current
    if (!header) return
    const measure = () => document.documentElement.style.setProperty('--story-top', header.getBoundingClientRect().bottom + 24 + 'px')
    const observer = new ResizeObserver(measure)
    observer.observe(header)
    window.addEventListener('resize', measure)
    measure()
    return () => { observer.disconnect(); window.removeEventListener('resize', measure) }
  }, [exploring])
  if (exploring) return null
  const chapter = shots[shotIndex].chapter
  return (
    <header id="header" ref={headerRef} className="studio-header">
      <div className="header-main">
        <a className="brand" href="#reveal" aria-label="3D汽车网站，返回揭幕">
          <span className="text-headline-medium text-text-primary">3D汽车网站</span>
        </a>
        <nav className="desktop-nav" aria-label="主导航">
          {chapters.map(([name, , id], i) => <ButtonLink key={id} href={'#' + id} variant="secondary" className="site-nav-link text-headline-medium"
            aria-current={chapter === i ? 'page' : undefined}>{name}</ButtonLink>)}
        </nav>
        <div className="header-content-links">
          <Button id="about" variant="secondary" className="site-nav-link desktop-about text-headline-medium" aria-label="关于本展览" onClick={() => actions.setSheet('about')}>关于展览</Button>
          <IconButton id="menu" className="mobile-menu border-transparent bg-transparent shadow-none" icon={RiMenuLine} aria-label="打开章节目录" onClick={() => actions.setSheet('menu')} />
        </div>
      </div>
    </header>
  )
}

export function StoryControls() {
  const { exploring, mode } = useStudio()
  if (exploring) return null
  return <><aside className="action-dock studio-panel" aria-label="展览操作">
    <VehiclePicker />
    <PaintPicker />
    <SoundButton />
    <ChapterTools />
    <VehicleControls />
    <span className="dock-divider" aria-hidden />
    <DockButton id="open-explorer" leadingIcon={RiSteering2Line}
      aria-label={mode === 'static' ? '进入影像展厅' : '进入交互展厅'} onClick={actions.openViewer}>展厅</DockButton>
  </aside><LoadingStatus /></>
}

export function ChapterProgress() {
  const { shotIndex, exploring } = useStudio()
  if (exploring) return null
  const chapter = shots[shotIndex].chapter
  return <aside className="chapter-progress" aria-label="章节位置">
    <ProgressBar className="chapter-progress-bar" size="sm" showValueLabel={false}
      aria-label="展览章节进度" minValue={0} maxValue={chapters.length - 1} value={chapter}
      aria-valuetext={chapters[chapter][0] + '，第 ' + (chapter + 1) + ' 章，共 ' + chapters.length + ' 章'} />
    <ol className="chapter-progress-points" aria-hidden>
      {chapters.map(([name, , id], i) => <li key={id} data-current={i === chapter || undefined} data-complete={i < chapter || undefined}>
        <span className="chapter-progress-point" />
        <span className="chapter-progress-label text-body-medium">{name}</span>
      </li>)}
    </ol>
  </aside>
}

export function WindViewControls() {
  const { mode, exploring, shotIndex } = useStudio()
  if (mode !== 'ready' || exploring || shots[shotIndex].id !== 'aero') return null
  return <p id="wind-view-hint" className="wind-view-hint text-body-regular">拖动调整视角 · 滚轮或双指放大查看</p>
}

// A gesture hint, not another navigation control. Navigation remains in the header.
export function ScrollHint() {
  const { shotIndex, exploring } = useStudio()
  if (exploring || shots[shotIndex].id === 'aero' || shotIndex === shots.length - 1) return null
  return <div className="scroll-hint">
    <span className="scroll-track" aria-hidden><span /></span>
    <span className="scroll-hint-label text-body-medium">向下滑动探索</span>
    <RiArrowDownSLine className="scroll-chevron size-4" aria-hidden />
  </div>
}
