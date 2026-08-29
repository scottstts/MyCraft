import CanvasHost from './app/CanvasHost'
import { Hotbar, Crosshair, TopRightWidget, PauseMenu } from './app/Hotbar'
import AudioPanel from './app/AudioPanel'
import { DebugPanel } from './app/DebugPanel'
import { StartPanel } from './app/StartPanel'
import { LoadingOverlay } from './app/LoadingOverlay'
import { ClickToEnterOverlay } from './app/ClickToEnterOverlay'
import DiagnosticsApp from './diagnostics/DiagnosticsApp'
import { getDiagnosticsRequest } from './diagnostics/cameras'

export default function App() {
  // Diagnostics are deliberately resolved before rendering the game shell.
  // The parser rejects every non-local host, so a deployed build cannot enter
  // this route merely by adding query parameters.
  const diagnostics = getDiagnosticsRequest(window.location)
  if (diagnostics) return <DiagnosticsApp view={diagnostics.view} />

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
