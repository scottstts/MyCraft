import CanvasHost from './app/CanvasHost'
import { Hotbar, Crosshair, FpsOverlay, PauseMenu } from './app/Hotbar'

export default function App() {
  return (
    <>
      <CanvasHost />
      <Hotbar />
      <Crosshair />
      <FpsOverlay />
      <PauseMenu />
    </>
  )
}


