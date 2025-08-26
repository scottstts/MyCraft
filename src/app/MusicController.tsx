import { useEffect } from 'react'
import { useUIStore } from '../state/ui'
import { setDesiredPlaying } from './BgMusic'

// React controller that syncs background music play/pause with UI state
export function MusicController() {
  const gameStarted = useUIStore(s => s.gameStarted)
  const inGame = useUIStore(s => s.inGame)
  const paused = useUIStore(s => s.paused)

  useEffect(() => {
    const shouldPlay = gameStarted && inGame && !paused
    setDesiredPlaying(shouldPlay)
  }, [gameStarted, inGame, paused])

  return null
}

export default MusicController

