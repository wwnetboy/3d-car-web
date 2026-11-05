import { createPortal } from 'react-dom'
import { DirectionProvider } from '@/components/foundations/direction/direction'
import { Header, ChapterProgress, StoryControls, ScrollHint } from './navigation'
import { Explorer } from './explorer'
import { WindDashboard } from './wind-dashboard'
import { StudioDialog } from './dialogs'

export function App() {
  return <DirectionProvider locale="zh-CN">
    <Header />
    <ChapterProgress />
    <StoryControls />
    {createPortal(<ScrollHint />, document.getElementById('narrative-ui')!)}
    <WindDashboard />
    <Explorer />
    <StudioDialog />
  </DirectionProvider>
}
