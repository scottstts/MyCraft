import blessedUrl from '../assets/sounds/music/Blessed.mp3'

let audio: HTMLAudioElement | null = null

function ensureInit(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio(blessedUrl)
    audio.loop = true
    audio.volume = 0.2
    audio.preload = 'auto'
  }
  return audio
}

export function setDesiredPlaying(shouldPlay: boolean): void {
  const a = ensureInit()
  if (shouldPlay) {
    // Attempt to play; if blocked by autoplay policy, a user gesture will call tryPlayOnUserGesture()
    void a.play().catch(() => { /* ignored: will retry on user gesture */ })
  } else {
    a.pause()
  }
}

// Call this from a user gesture (e.g., canvas click) to satisfy autoplay policies
export function tryPlayOnUserGesture(): void {
  const a = ensureInit()
  if (!a.paused) return
  void a.play().catch(() => { /* if still blocked, keep waiting for another gesture */ })
}

export function pauseNow(): void {
  const a = ensureInit()
  a.pause()
}

export function setVolume(v: number): void {
  const a = ensureInit()
  const vol = Math.max(0, Math.min(1, v))
  a.volume = vol
}

export function getVolume(): number {
  const a = ensureInit()
  return a.volume
}

export function disposeBgMusic(): void {
  if (audio) {
    audio.pause()
    // Clear source to release memory
    audio.src = ''
    audio = null
  }
}
