import { vehicleById } from '../vehicles'
import { useEffect, useState } from 'react'
import { RiArrowRightUpLine, RiBox3Line, RiCheckLine, RiFileCopyLine, RiSkipForwardLine } from '@remixicon/react'
import { Button, ButtonLink } from '@/components/base/buttons/button'
import { Modal, ModalBody, ModalFooter, ModalHeader } from '@/components/base/modal/modal'
import { ProgressBar } from '@/components/base/progress/progress'
import { actions } from '../controller'
import { chapters } from '../story'
import { useStudio } from './controls'

export function StudioDialog() {
  const { sheet, vehicleId } = useStudio()
  const selected = vehicleById(vehicleId)
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  useEffect(() => { setCopied(false); setCopyFailed(false) }, [sheet])
  async function copyWechat() {
    try { await navigator.clipboard.writeText('wwnetboy'); setCopied(true) }
    catch { setCopyFailed(true) }
  }
  const title = sheet === 'menu' ? '章节目录' : sheet === 'method' ? '模拟说明' : '关于本展览'
  return <Modal isOpen={sheet !== null} onOpenChange={open => { if (!open) actions.setSheet(null) }} size="md">
    <ModalHeader title={title} description={sheet === 'menu' ? '跟随光影，探索汽车设计。' : sheet === 'method' ? '风洞可视化与风阻估算的适用范围。' : '3D汽车网站'} closeLabel="关闭" />
    <ModalBody>
      {sheet === 'menu' ? <nav className="flex flex-col gap-2" aria-label="移动端章节">
        {chapters.map(([name, , id], i) => <ButtonLink key={id} href={'#' + id} variant="secondary" className="h-12 justify-start" trailingIcon={RiArrowRightUpLine}><span className="me-4 text-text-tertiary">0{i + 1}</span>{name}</ButtonLink>)}
      </nav> : sheet === 'method' ? <div className="flex flex-col gap-4 text-body-regular text-text-secondary">
        {selected.flowKind === 'cfd' ? <><p>烟流基于 120 km/h 的整车平均流场与车尾局部瞬态计算，其他风速按流动时间缩放。细小烟纹及贴面、风道烟层为视觉增强，尚未经过实车风洞校准。</p>
        <p>Cd 按雷诺数修正表面摩擦，以 120 km/h 对齐官方参考值 0.29。标定车速与面积比为展示假设，非实测或 CFD 阻力预测。</p></> : <><p>{selected.name} 的烟流按自身车身几何生成，模拟气流在车顶、侧面与底盘的分流。风速改变烟流的播放速度。</p><p>当前为不可压缩无黏绕流的定性展示，未计算黏性阻力和真实瞬态尾流，不显示工程风阻系数。</p></>}
        <p>关闭喷烟只停止烟源，已有烟雾会逐渐离开。风速与当前观察角度继续保持。驻车时轮速跟随风速，行驶时跟随驾驶车速。</p>
      </div> : <div className="flex flex-col gap-5">
        <p className="text-body-regular text-text-secondary">3D汽车网站，通过光影、形态与运动，探索不同车型的设计。</p>
        <div className="rounded-2xl border border-border-button-default bg-background-secondary-default p-4">
          <span className="text-body-medium text-text-tertiary">CREATED BY / 作者</span>
          <h3 className="mt-2 text-title-2-medium text-text-primary">北海千川</h3>
          <p className="mt-1 text-body-regular text-text-secondary">独立交互设计作品</p>
        </div>
        <div className="flex flex-col gap-2 text-body-regular text-text-secondary">
          <p>模型署名与许可</p>
          <a href="https://sketchfab.com/3d-models/xiaomi-vision-gt-a464599492e94e508b999b4775141727" target="_blank" rel="noopener noreferrer">Xiaomi Vision GT · hartwelkisaka · CC BY 4.0 ↗</a>
          <a href="https://sketchfab.com/3d-models/2025-xiaomi-su7-ultra-production-version-9d0a0a9285cb4ca59ccb9322ddf58d24" target="_blank" rel="noopener noreferrer">SU7 Ultra · Ddiaz Design · CC BY-NC-SA 4.0 ↗</a>
          <a href="https://sketchfab.com/3d-models/mclaren-ultimate-vision-gt-ffaaeb3b72ac4f12a35a4753bd9cc51b" target="_blank" rel="noopener noreferrer">McLaren Ultimate Vision GT · VTX · CC BY-NC-SA 4.0 ↗</a>
        </div>
        <dl className="contact-list text-body-regular">
          <div><dt>微信</dt><dd><span id="wechat-value">wwnetboy</span><Button id="copy-wechat" variant="secondary" size="small" leadingIcon={copied ? RiCheckLine : RiFileCopyLine} onClick={() => void copyWechat()} aria-label="复制微信号 wwnetboy">{copied ? '已复制' : '复制'}</Button></dd></div>
          <div><dt>邮箱</dt><dd><a href="mailto:admin@isww.cn">admin@isww.cn ↗</a></dd></div>
          <div><dt>个人网站</dt><dd><a href="https://www.isww.cn" target="_blank" rel="noopener noreferrer">www.isww.cn ↗</a></dd></div>
        </dl>
        <p role="status" className="text-body-regular text-text-secondary">{copyFailed ? '复制未成功，请长按或选中微信号手动复制。' : copied ? '微信号已复制' : ''}</p>
      </div>}
    </ModalBody>
    <ModalFooter>
      {sheet === 'menu' && <Button variant="secondary" onClick={() => actions.setSheet('about')}>关于本展览</Button>}
      <Button onClick={() => actions.setSheet(null)}>返回展览</Button>
    </ModalFooter>
  </Modal>
}

export function LoadingStatus() {
  const { loadVisible, loadText, loadProgress, loadAction, mode, vehicleId } = useStudio()
  if (!loadVisible) return null
  const loading = mode === 'loading'
  const label = loadAction === 'retry' ? '启用 3D' : '跳过揭幕'
  return <div className={loading ? 'loading-curtain' : 'status-notice'}>
    <div id="load-state" className={loading ? 'loading-focus' : 'status-notice-content'} aria-label="展厅加载状态" aria-busy={loading}>
      {loading ? <>
        <p className="text-body-medium text-text-tertiary">MOTION STUDIO</p>
        <h2 className="text-title-2-medium text-text-primary">{vehicleById(vehicleId).name}</h2>
        <ProgressBar aria-label="模型下载" value={loadProgress ?? undefined} isIndeterminate={loadProgress === null} size="sm" showValueLabel={false} />
        <p role="status" className="text-body-regular text-text-secondary">{loadText}</p>
      </> : <>
        {loadText && <p role="status" className="text-body-regular text-text-secondary">{loadText}</p>}
        <Button id="load-action" variant="secondary" size="small" leadingIcon={loadAction === 'retry' ? RiBox3Line : RiSkipForwardLine}
          aria-label={label} onClick={actions.loadAction}>{label}</Button>
      </>}
    </div>
  </div>
}
