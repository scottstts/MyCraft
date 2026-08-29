import { describe, expect, it } from 'vitest';
import { applyGraphicsSettings } from '../src/engine/render/settings/GraphicsSettings';

describe('baked graphics settings contract', () => {
  it('only applies time controls and callers cannot change the cycle duration', () => {
    const calls: string[] = [];
    let cycle = 1200;
    applyGraphicsSettings({ timeOfDay: { t: 1.25, paused: true, cycleSeconds: 42 } }, {
      setTime: (value) => calls.push(`time:${value}`),
      setTimePaused: (value) => calls.push(`paused:${value}`),
      setCycleSeconds: (value) => { cycle = value; calls.push(`cycle:${value}`); },
    });
    expect(calls).toEqual(['time:0.25', 'paused:true', 'cycle:1200']);
    expect(cycle).toBe(1200);
  });
});
