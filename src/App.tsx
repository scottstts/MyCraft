import CanvasHost from './app/CanvasHost'
import { Hotbar, Crosshair, FpsOverlay, PauseMenu, PauseHint } from './app/Hotbar'
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
      <PauseHint />
      <PauseMenu />
      <DebugPanel />
    </>
  )
}

