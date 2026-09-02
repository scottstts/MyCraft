type Track = { url: string; name: string }
const MUSIC_FILES = [
  'Away.mp3',
  'By the Sea.mp3',
  'Evening Glow.mp3',
  'Golden Hour.mp3',
  'Ocean Breeze.mp3',
  'Sand Castle.mp3',
  'Serenade.mp3',
  'Silhouette.mp3',
  'Static_Dream.mp3',
  'Wind Whisper.mp3',
]

const ALL_TRACKS: Track[] = MUSIC_FILES.map((file) => {
  const base = file
  const name = (base.replace(/\.[^.]+$/, '') || 'Track')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
  return { url: `/music/${encodeURIComponent(file)}`, name }
})

let audio: HTMLAudioElement | null = null
let playlist: Track[] = []
let currentIndex = 0
let allowedToPlay = false // gated by game state via setDesiredPlaying()

function shuffle<T>(arr: T[]): T[] {
  const copy = arr.slice()
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

function setSourceFromIndex() {
  if (!audio || playlist.length === 0) return
  const track = playlist[currentIndex % playlist.length]
  if (audio.src !== track.url) {
    audio.src = track.url
    audio.currentTime = 0
  }
}

function ensureInit(): HTMLAudioElement {
  if (!audio) {
    // Initialize playlist and audio element lazily
    playlist = shuffle(ALL_TRACKS)
    currentIndex = 0
    audio = new Audio()
    audio.loop = false
    audio.volume = 0.2
    audio.preload = 'auto'
    setSourceFromIndex()

    audio.addEventListener('ended', () => {
      // Advance to next track; keep playing only if allowed by game state
      if (playlist.length === 0) return
      currentIndex = (currentIndex + 1) % playlist.length
      setSourceFromIndex()
      if (allowedToPlay) {
        void audio!.play().catch(() => { /* ignored: may require gesture */ })
      }
    })
  }
  return audio
}

// Called by MusicController with game gating
export function setDesiredPlaying(shouldPlay: boolean): void {
  const a = ensureInit()
  allowedToPlay = shouldPlay
  if (shouldPlay) {
    // Attempt to play; if blocked by autoplay policy, a user gesture will call tryPlayOnUserGesture()
    void a.play().catch(() => { /* ignored: will retry on user gesture */ })
  } else {
    a.pause()
  }
}

// Prime the media element during the launch gesture without leaving music
// running while the world is still loading. A later play() after readiness can
// then reuse the browser's user-activation grant where the browser permits it.
export function primeForGameStart(): void {
  const a = ensureInit()
  if (!a.paused) return
  const startTime = a.currentTime
  const wasMuted = a.muted
  // Resolve autoplay permission without allowing the launch click to produce
  // audible music before the world is ready. Pause immediately and restore
  // the element's previous mute state when the browser settles the promise.
  a.muted = true
  const playback = a.play()
  a.pause()
  try { a.currentTime = startTime } catch { /* media may not be seekable yet */ }
  void playback
    .then(() => {
      if (allowedToPlay) {
        a.muted = wasMuted
        if (a.paused) void a.play().catch(() => { /* retry on a later gesture */ })
        return
      }
      a.pause()
      a.muted = wasMuted
      try { a.currentTime = startTime } catch { /* media may not be seekable yet */ }
    })
    .catch(() => {
      a.muted = wasMuted
      /* autoplay may still be blocked; retry after entry */
    })
}

// Call this from a user gesture (e.g., canvas click) to satisfy autoplay policies
// Respects game gating via allowedToPlay
export function tryPlayOnUserGesture(): void {
  const a = ensureInit()
  if (!allowedToPlay) return
  if (!a.paused) return
  void a.play().catch(() => { /* if still blocked, keep waiting for another gesture */ })
}

export function pauseNow(): void {
  const a = ensureInit()
  a.pause()
}

// Restart invoked on game restart. Re-shuffle order and reset to first track, paused.
export function restartMusic(): void {
  const a = ensureInit()
  if (ALL_TRACKS.length > 0) {
    playlist = shuffle(ALL_TRACKS)
    currentIndex = 0
    setSourceFromIndex()
  }
  a.currentTime = 0
  a.pause()
}

export function nextTrack(): void {
  ensureInit()
  if (playlist.length === 0) return
  currentIndex = (currentIndex + 1) % playlist.length
  setSourceFromIndex()
  if (allowedToPlay) {
    void audio!.play().catch(() => { /* gesture may be required */ })
  }
}

export function prevTrack(): void {
  ensureInit()
  if (playlist.length === 0) return
  currentIndex = (currentIndex - 1 + playlist.length) % playlist.length
  setSourceFromIndex()
  if (allowedToPlay) {
    void audio!.play().catch(() => { /* gesture may be required */ })
  }
}

export function isPlaying(): boolean {
  const a = ensureInit()
  return !a.paused
}

export function getCurrentTime(): number {
  const a = ensureInit()
  return a.currentTime || 0
}

export function getDuration(): number {
  const a = ensureInit()
  return Number.isFinite(a.duration) ? a.duration : 0
}

export function setCurrentTime(seconds: number): void {
  const a = ensureInit()
  if (Number.isFinite(seconds)) {
    a.currentTime = Math.max(0, Math.min(getDuration() || Number.MAX_SAFE_INTEGER, seconds))
  }
}

export function getCurrentTrackName(): string {
  ensureInit()
  if (playlist.length === 0) return ''
  return playlist[currentIndex % playlist.length].name
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
