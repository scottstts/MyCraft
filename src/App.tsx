import CanvasHost from './app/CanvasHost'
import { Hotbar, Crosshair, FpsOverlay, PauseMenu, PauseHint } from './app/Hotbar'

export default function App() {
  return (
    <>
      <CanvasHost />
      <Hotbar />
      <Crosshair />
      <FpsOverlay />
      <PauseHint />
      <PauseMenu />
    </>
  )
}


