/**
 * Player-facing settings. Rendering style is deliberately baked into the
 * engine; only audio and the day/night clock remain user-tunable here.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useUIStore } from '../state/ui';
import type { GraphicsSettings } from '../engine/render/settings/GraphicsSettings';
import { RENDER_STYLE } from '../engine/render/settings/RenderStyle';
import SaveWorldButton from './SaveWorldButton';

interface WindowWithGameControls extends Window {
  updateGraphicsSettings?: (settings: GraphicsSettings) => void;
  getGraphicsSettings?: () => GraphicsSettings;
  __getSfxVolume?: () => number;
  __setSfxVolume?: (value: number) => void;
}

const PANEL_STYLE: React.CSSProperties = {
  position: 'fixed',
  top: '52px',
  left: '12px',
  width: '320px',
  background: 'rgba(15, 23, 32, 0.98)',
  border: '1px solid rgba(148,163,184,0.16)',
  borderRadius: '16px',
  padding: '20px',
  color: '#f8f9fa',
  fontSize: '13px',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  zIndex: 2000,
  maxHeight: '80vh',
  overflowY: 'auto',
  backdropFilter: 'blur(20px)',
  boxShadow: '0 24px 60px rgba(0,0,0,0.48)',
};

const SECTION_STYLE: React.CSSProperties = {
  marginBottom: '20px',
};

const HEADING_STYLE: React.CSSProperties = {
  margin: '0 0 12px 0',
  fontSize: '14px',
  color: '#e2e8f0',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  borderBottom: '1px solid rgba(255,255,255,0.06)',
  paddingBottom: '6px',
};

const CONTROL_STYLE: React.CSSProperties = {
  display: 'block',
  padding: '8px 12px',
  borderRadius: '8px',
  background: 'rgba(255,255,255,0.025)',
};

export const DebugPanel: React.FC = () => {
  const { debugVisible, setDebugVisible, setAudioVisible } = useUIStore();
  const gameStarted = useUIStore(s => s.gameStarted);
  const loading = useUIStore(s => s.loading);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [sfxVol, setSfxVol] = useState(0.7);
  const [timeOfDay, setTimeOfDay] = useState(0);
  const [timePaused, setTimePaused] = useState(false);

  useEffect(() => {
    const controls = window as WindowWithGameControls;
    const value = controls.__getSfxVolume?.();
    if (typeof value === 'number' && Number.isFinite(value)) setSfxVol(value);
  }, []);

  useEffect(() => {
    let raf = 0;
    const step = () => {
      const state = (window as WindowWithGameControls).getGraphicsSettings?.();
      if (state?.timeOfDay) {
        const t = state.timeOfDay.t;
        if (Number.isFinite(t)) setTimeOfDay(previous => Math.abs(previous - t) > 0.0001 ? t : previous);
        setTimePaused(state.timeOfDay.paused);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (!debugVisible) return;
    const onDown = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) setDebugVisible(false);
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [debugVisible, setDebugVisible]);

  useEffect(() => {
    if (debugVisible) setAudioVisible(false);
  }, [debugVisible, setAudioVisible]);

  if (!gameStarted || loading) return null;

  if (!debugVisible) {
    return (
      <div style={{ position: 'fixed', top: '12px', left: '12px', zIndex: 1000, display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <button
          onClick={() => { setAudioVisible(false); setDebugVisible(true); }}
          style={{ padding: '8px 12px', background: 'rgba(15, 23, 32, 0.94)', color: '#f8f9fa', border: '1px solid rgba(148,163,184,0.16)', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', lineHeight: '16px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', fontWeight: 600, letterSpacing: 0.3, pointerEvents: 'auto', backdropFilter: 'blur(10px)', boxShadow: '0 8px 20px rgba(0,0,0,0.28)', display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" style={{ width: 14, height: 14, display: 'block', flexShrink: 0 }}>
            <path d="M19.43 12.98c.04-.32.07-.65.07-.98s-.02-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.37-.31-.6-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98L14.5 1.42C14.47 1.18 14.25 1 14 1h-4c-.25 0-.46.18-.5.42L9.12 4.07c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.08-.48 0-.6.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.08.65-.08.98s.03.66.08.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.37.31.6.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.38-2.65c.61-.25 1.17-.58 1.69-.98l2.49 1c.23.08.48 0 .6-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5z" />
          </svg>
          <span>Settings</span>
        </button>
        <SaveWorldButton />
      </div>
    );
  }

  const updateTime = (t: number, paused = timePaused) => {
    setTimeOfDay(t);
    (window as WindowWithGameControls).updateGraphicsSettings?.({
      timeOfDay: { t, paused, cycleSeconds: RENDER_STYLE.dayNightCycleSeconds },
    });
  };

  return (
    <div ref={panelRef} style={PANEL_STYLE}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid rgba(255,255,255,0.06)', position: 'sticky', top: 0, background: 'rgba(15, 23, 32, 0.98)', zIndex: 1 }}>
        <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#f8fafc' }}>Settings</h3>
        <button onClick={() => setDebugVisible(false)} aria-label="Close settings" style={{ background: 'rgba(148,163,184,0.10)', border: '1px solid rgba(148,163,184,0.16)', color: '#f8f9fa', cursor: 'pointer', padding: '8px 10px', borderRadius: '8px', fontSize: '14px', fontWeight: 600 }}>✕</button>
      </div>

      <section style={SECTION_STYLE}>
        <h4 style={HEADING_STYLE}>Sound Effects</h4>
        <label style={CONTROL_STYLE}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '12px', fontWeight: 500, color: '#94a3b8' }}>
            <span>Sound Effects Volume</span>
            <span style={{ color: '#e2e8f0' }}>{Math.round(sfxVol * 100)}%</span>
          </div>
          <input
            aria-label="Sound Effects Volume"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={sfxVol}
            onChange={event => {
              const value = Number.parseFloat(event.target.value);
              setSfxVol(value);
              (window as WindowWithGameControls).__setSfxVolume?.(value);
            }}
            style={{ width: '100%', height: '4px', borderRadius: '2px', background: 'rgba(255,255,255,0.1)', outline: 'none', cursor: 'pointer' }}
          />
        </label>
      </section>

      <section style={{ marginBottom: 0 }}>
        <h4 style={HEADING_STYLE}>Day/Night Cycle</h4>
        <label style={{ display: 'flex', alignItems: 'center', marginBottom: '10px', cursor: 'pointer', padding: '8px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <input
            type="checkbox"
            checked={timePaused}
            onChange={event => {
              const paused = event.target.checked;
              setTimePaused(paused);
              updateTime(timeOfDay, paused);
            }}
            style={{ marginRight: '10px', transform: 'scale(1.1)' }}
          />
          <span style={{ fontWeight: 500 }}>Pause Cycle</span>
        </label>
        <label style={CONTROL_STYLE}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '12px', fontWeight: 500, color: '#94a3b8' }}>
            <span>Time</span>
            <span style={{ color: '#e2e8f0' }}>{timeOfDay.toFixed(2)}</span>
          </div>
          <input
            aria-label="Time"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={timeOfDay}
            onChange={event => updateTime(Number.parseFloat(event.target.value))}
            style={{ width: '100%', height: '4px', borderRadius: '2px', background: 'rgba(255,255,255,0.1)', outline: 'none', cursor: 'pointer' }}
          />
          <div style={{ marginTop: '8px', color: '#64748b', fontSize: '11px' }}>10 min day · 10 min night</div>
        </label>
      </section>
    </div>
  );
};
