import CanvasHost from './app/CanvasHost'
import { Hotbar, Crosshair, FpsOverlay, PauseMenu, PauseHint, ClockOverlay } from './app/Hotbar'
import MusicController from './app/MusicController'
import AudioPanel from './app/AudioPanel'
import { DebugPanel } from './app/DebugPanel'
import { StartPanel } from './app/StartPanel'

export default function App() {
  return (
    <>
      <CanvasHost />
      <StartPanel />
      <Hotbar />
      <Crosshair />
      <FpsOverlay />
      <ClockOverlay />
      <PauseHint />
      <PauseMenu />
      <MusicController />
      <DebugPanel />
      <AudioPanel />
    </>
  )
}
