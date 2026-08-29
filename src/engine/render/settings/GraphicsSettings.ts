import { RENDER_STYLE } from './RenderStyle';

export interface GraphicsSettings {
  timeOfDay?: { t: number; paused: boolean; cycleSeconds: number };
}

export interface GraphicsBindings {
  setTime: (t: number) => void;
  setTimePaused: (paused: boolean) => void;
  setCycleSeconds: (sec: number) => void;
}

export function applyGraphicsSettings(settings: GraphicsSettings, bindings: GraphicsBindings): void {
  if (settings.timeOfDay) {
    const { t, paused } = settings.timeOfDay;
    const normalized = ((t % 1) + 1) % 1;
    bindings.setTime(normalized);
    bindings.setTimePaused(!!paused);
    bindings.setCycleSeconds(RENDER_STYLE.dayNightCycleSeconds);
  }
}
