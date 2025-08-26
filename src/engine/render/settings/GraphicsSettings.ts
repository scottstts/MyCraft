import * as THREE from 'three';

export interface GraphicsSettings {
  timeOfDay: { t: number; paused: boolean; cycleSeconds: number };
  renderer?: { exposure?: number };
  clouds?: { enabled?: boolean; coverage?: number; density?: number; windDirection?: number; windSpeed?: number };
}

export interface GraphicsBindings {
  setTime: (t: number) => void;
  setTimePaused: (paused: boolean) => void;
  setCycleSeconds: (sec: number) => void;
  setRendererExposure: (exp: number) => void;
  setClouds?: (p: { enabled?: boolean; coverage?: number; density?: number; windDirection?: number; windSpeed?: number }) => void;
}

export function applyGraphicsSettings(settings: GraphicsSettings, bindings: GraphicsBindings): void {
  if (settings.renderer?.exposure !== undefined) {
    bindings.setRendererExposure(settings.renderer.exposure);
  }
  if (settings.timeOfDay) {
    const { t, paused, cycleSeconds } = settings.timeOfDay;
    bindings.setTime(THREE.MathUtils.clamp(t, 0, 1));
    bindings.setTimePaused(!!paused);
    bindings.setCycleSeconds(Math.max(1, Math.floor(cycleSeconds)));
  }
  if (settings.clouds && bindings.setClouds) {
    bindings.setClouds(settings.clouds)
  }
}
