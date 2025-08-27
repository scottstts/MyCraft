import { useEffect } from 'react'
import { useUIStore } from '../state/ui'
import { setDesiredPlaying, restartMusic } from './BgMusic'

// React controller that syncs background music play/pause with UI state
export function MusicController() {
  const gameStarted = useUIStore(s => s.gameStarted)
  const inGame = useUIStore(s => s.inGame)
  const paused = useUIStore(s => s.paused)
  const restartToken = useUIStore(s => s.restartToken)

  useEffect(() => {
    const shouldPlay = gameStarted && inGame && !paused
    setDesiredPlaying(shouldPlay)
  }, [gameStarted, inGame, paused])

  useEffect(() => {
    if (restartToken > 0) {
      restartMusic()
    }
  }, [restartToken])

  return null
}

export default MusicController

