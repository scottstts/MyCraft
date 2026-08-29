/**
 * Local-only diagnostics shell.
 * The canvas is still mounted by the same CanvasHost/Engine path as the game;
 * this component only selects a deterministic camera pose and hides gameplay
 * menus so captures contain the render output rather than the HUD.
 */

import CanvasHost from '../app/CanvasHost';
import type { DiagnosticCameraId } from './cameras';

export interface DiagnosticsAppProps {
  view: DiagnosticCameraId;
  time?: number;
}

export function DiagnosticsApp({ view, time }: DiagnosticsAppProps) {
  // Do not add a HUD or a second scene layer: captures should contain exactly
  // the player canvas output, with `view` affecting only its camera pose.
  return <CanvasHost diagnosticView={view} diagnosticTime={time} />;
}

export default DiagnosticsApp;
