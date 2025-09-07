import CanvasHost from './app/CanvasHost'
import { Hotbar, Crosshair, TopRightWidget, PauseMenu } from './app/Hotbar'
import AudioPanel from './app/AudioPanel'
import { DebugPanel } from './app/DebugPanel'
import { StartPanel } from './app/StartPanel'
import { LoadingOverlay } from './app/LoadingOverlay'
import { ClickToEnterOverlay } from './app/ClickToEnterOverlay'

export default function App() {
  return (
    <>
      <CanvasHost />
      <StartPanel />
      <ClickToEnterOverlay />
      <Hotbar />
      <Crosshair />
      <TopRightWidget />
      <PauseMenu />
      <DebugPanel />
      <AudioPanel />
      <LoadingOverlay />
    </>
  )
}
