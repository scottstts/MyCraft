import CanvasHost from './app/CanvasHost'
import { Hotbar, Crosshair, TopRightWidget, PauseMenu } from './app/Hotbar'
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
      <TopRightWidget />
      <PauseMenu />
      <MusicController />
      <DebugPanel />
      <AudioPanel />
    </>
  )
}
