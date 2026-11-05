export class StudioSound {
  private context?: AudioContext
  private volume?: GainNode
  private filter?: BiquadFilterNode
  private windActive = false
  enabled = false

  private updateVolume() {
    if (!this.context || !this.volume) return
    const now = this.context.currentTime
    const gain = this.volume.gain
    gain.cancelScheduledValues(now)
    gain.setValueAtTime(gain.value, now)
    gain.linearRampToValueAtTime(this.enabled && this.windActive ? 0.24 : 0, now + 0.14)
  }

  async toggle() {
    if (!this.context) {
      const ctx = new AudioContext()
      this.context = ctx
      const buffer = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate)
      const samples = buffer.getChannelData(0)
      let last = 0
      for (let i = 0; i < samples.length; i++) {
        last = (last + (Math.random() * 2 - 1) * 0.025) / 1.025
        samples[i] = last * 3.2
      }
      const source = ctx.createBufferSource()
      source.buffer = buffer
      source.loop = true
      this.filter = ctx.createBiquadFilter()
      this.filter.type = 'lowpass'
      this.filter.frequency.value = this.windActive ? 1250 : 520
      this.volume = ctx.createGain()
      this.volume.gain.value = 0
      source.connect(this.filter).connect(this.volume).connect(ctx.destination)
      source.start()
    }
    this.enabled = !this.enabled
    try {
      if (this.enabled) await this.context.resume()
    } catch {
      this.enabled = false
    }
    this.updateVolume()
    return this.enabled
  }

  wind(open: boolean) {
    this.windActive = open
    if (this.context && this.filter)
      this.filter.frequency.setTargetAtTime(open ? 1250 : 520, this.context.currentTime, 0.6)
    this.updateVolume()
  }

  async visible(value: boolean) {
    if (!this.context || !this.enabled) return
    if (value) await this.context.resume()
    else await this.context.suspend()
  }
}
