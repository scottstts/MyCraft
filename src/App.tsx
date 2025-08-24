import CanvasHost from './app/CanvasHost'
import { Hotbar, Crosshair, FpsOverlay, PauseMenu, PauseHint } from './app/Hotbar'
import { DebugPanel } from './app/DebugPanel'

export default function App() {
  return (
    <>
      <CanvasHost />
      <Hotbar />
      <Crosshair />
      <FpsOverlay />
      <PauseHint />
      <PauseMenu />
      <DebugPanel />
    </>
  )
}


