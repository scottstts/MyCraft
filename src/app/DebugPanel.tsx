/**
 * Debug panel for post-processing controls and graphics settings
 */

import React, { useState, useEffect } from 'react';
import { useUIStore } from '../state/ui';
import type { PostProcessorSettings } from '../engine/render/SimplePostProcessor';
import type { ShadowSettings } from '../engine/render/ShadowSystem';
import type { GraphicsSettings } from '../engine/render/settings/GraphicsSettings';

interface WindowWithEngineGlobals extends Window {
  updatePostProcessingSettings?: (settings: PostProcessorSettings) => void;
  updateShadowSettings?: (settings: ShadowSettings) => void;
  updateGraphicsSettings?: (settings: GraphicsSettings) => void;
}

interface PostProcessingSettings {
  ssaoEnabled: boolean;
  ssaoIntensity: number;
  ssaoRadius: number;
  bloomEnabled: boolean;
  bloomStrength: number;
  bloomThreshold: number;
  exposure: number;
  contrast: number;
  saturation: number;
  shadowEnabled: boolean;
  shadowResolution: number;
  shadowDistance: number;
  shadowSoftness: number;
  shadowIntensity: number;
  shadowBias: number;
  shadowNormalBias: number;
  shadowBlendFraction: number;
  shadowBlendMin: number;
  fogEnabled?: boolean;
  fogBaseDensity?: number;
  fogMaxDistance?: number;
  volumetricsEnabled?: boolean;
  volumetricsIntensity?: number;
  volumetricsSteps?: number;
}

export const DebugPanel: React.FC = () => {
  const { debugVisible, setDebugVisible, setAudioVisible } = useUIStore();
  const gameStarted = useUIStore(s => s.gameStarted)
  const panelRef = React.useRef<HTMLDivElement | null>(null)
  const [settings, setSettings] = useState<PostProcessingSettings>({
    ssaoEnabled: true,
    ssaoIntensity: 0.35,
    ssaoRadius: 0.02,
    bloomEnabled: true,
    bloomStrength: 0.15,
    bloomThreshold: 0.3,
    exposure: 0.9,
    contrast: 1.05,
    saturation: 1.0,
    shadowEnabled: true, // Enable shadows by default
    shadowResolution: 1024,
    shadowDistance: 600,
    shadowSoftness: 1.0,
    shadowIntensity: 1.0,
    shadowBias: 0.0005,
    shadowNormalBias: 0.02,
    shadowBlendFraction: 0.3,
    shadowBlendMin: 10,
    fogEnabled: true,
    fogBaseDensity: 0.002,
    fogMaxDistance: 600,
    volumetricsEnabled: false,
    volumetricsIntensity: 0.1,
    volumetricsSteps: 32,
  });
  const [cloudsEnabled, setCloudsEnabled] = useState(false);
  const [cloudsCoverage, setCloudsCoverage] = useState(0.45);
  const [cloudsDensity, setCloudsDensity] = useState(0.65);

  // Time-of-day UI local state
  const [timeOfDay, setTimeOfDay] = useState(0.0); // 6am sunrise
  const [timePaused, setTimePaused] = useState(false);
  const [cycleSeconds, setCycleSeconds] = useState(180);

  // Auto-sync time slider with engine time-of-day
  useEffect(() => {
    let raf = 0;
    const step = () => {
      const getFn = (window as WindowWithEngineGlobals & { getGraphicsSettings?: () => { timeOfDay: { t: number; paused: boolean; cycleSeconds: number } } }).getGraphicsSettings;
      if (getFn) {
        const gs = getFn();
        const t = gs.timeOfDay.t;
        if (typeof t === 'number' && !Number.isNaN(t)) {
          setTimeOfDay(prev => (Math.abs(prev - t) > 0.0001 ? t : prev));
        }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Initialize settings on mount
  useEffect(() => {
    // Apply initial settings to the engine with a small delay to ensure engine is ready
    const timer = setTimeout(() => {
      // console.log('[DebugPanel] Initializing settings on mount');
      const updateFn = (window as WindowWithEngineGlobals).updatePostProcessingSettings;
      if (updateFn) {
        updateFn(settings);
        // console.log('[DebugPanel] Applied initial post-processing settings');
      } else {
        // console.warn('[DebugPanel] Post-processing not available during initialization');
      }
      
      const updateShadowFn = (window as WindowWithEngineGlobals).updateShadowSettings;
      if (updateShadowFn) {
        const shadowSettings = {
          enabled: settings.shadowEnabled,
          resolution: settings.shadowResolution,
          cascades: 3,
          shadowDistance: settings.shadowDistance,
          softness: settings.shadowSoftness,
          bias: settings.shadowBias,
          normalBias: settings.shadowNormalBias,
          intensity: settings.shadowIntensity,
          shadowBlendFraction: settings.shadowBlendFraction,
          shadowBlendMin: settings.shadowBlendMin,
        };
        updateShadowFn(shadowSettings);
        // console.log('[DebugPanel] Applied initial shadow settings');
      } else {
        // console.warn('[DebugPanel] Shadow system not available during initialization');
      }
      // Initialize time-of-day controls
      (window as WindowWithEngineGlobals).updateGraphicsSettings?.({
        timeOfDay: { t: timeOfDay, paused: timePaused, cycleSeconds },
        renderer: { exposure: settings.exposure }
      });
    }, 1000);
    
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  // Keep clouds state in sync with engine
  useEffect(() => {
    (window as WindowWithEngineGlobals).updateGraphicsSettings?.({
      timeOfDay: { t: timeOfDay, paused: timePaused, cycleSeconds }, // keep current values
      clouds: { enabled: cloudsEnabled, coverage: cloudsCoverage, density: cloudsDensity }
    })
  }, [cloudsEnabled, cloudsCoverage, cloudsDensity, timeOfDay, timePaused, cycleSeconds])

  // Close on click outside when open
  React.useEffect(() => {
    if (!debugVisible) return
    const onDown = (e: MouseEvent) => {
      const el = panelRef.current
      if (!el) return
      if (!el.contains(e.target as Node)) {
        setDebugVisible(false)
      }
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [debugVisible, setDebugVisible])

  // Ensure only one panel open at a time
  React.useEffect(() => {
    if (debugVisible) setAudioVisible(false)
  }, [debugVisible, setAudioVisible])

  // Hide entire debug UI (including the launcher button) until game starts
  if (!gameStarted) return null

  if (!debugVisible) {
    return (
      <div style={{
        position: 'fixed',
        top: '12px',
        left: '12px',
        zIndex: 1000,
      }}>
        <button
          onClick={() => { setAudioVisible(false); setDebugVisible(true) }}
          style={{
            padding: '8px 12px',
            background: 'linear-gradient(145deg, rgba(32,39,49,0.95), rgba(22,27,35,0.95))',
            color: '#f8f9fa',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '8px',
            cursor: 'pointer',
            fontSize: '12px',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontWeight: 600,
            letterSpacing: 0.3,
            pointerEvents: 'auto',
            backdropFilter: 'blur(10px)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
            transition: 'all 0.2s ease',
            display: 'flex',
            alignItems: 'center',
            minWidth: '140px',
            justifyContent: 'flex-start',
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.transform = 'translateY(-2px)'
            e.currentTarget.style.boxShadow = '0 8px 32px rgba(79,172,254,0.4), 0 4px 16px rgba(0,0,0,0.4)'
            e.currentTarget.style.borderColor = 'rgba(79,172,254,0.4)'
            e.currentTarget.style.background = 'linear-gradient(145deg, rgba(42,49,59,0.98), rgba(32,37,45,0.98))'
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.transform = 'translateY(0)'
            e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.3)'
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'
            e.currentTarget.style.background = 'linear-gradient(145deg, rgba(32,39,49,0.95), rgba(22,27,35,0.95))'
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{ marginRight: '6px', flexShrink: 0 }}>
            <path d="M21 2H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h7l-2 3v1h8v-1l-2-3h7c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 12H3V4h18v10z" fill="currentColor" opacity="0.8"/>
          </svg>
          Graphics Settings
        </button>
      </div>
    );
  }

  const handleSettingChange = (key: keyof PostProcessingSettings, value: number | boolean) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);

    // (`[DebugPanel] Setting ${key} to ${value}`);
    
    // Communicate with engine
    const updateFn = (window as WindowWithEngineGlobals).updatePostProcessingSettings;
    if (updateFn) {
      updateFn(newSettings);
      // console.log(`[DebugPanel] Updated post-processing:`, newSettings);
    } else {
      console.error('[DebugPanel] updatePostProcessingSettings not available!');
    }
    
    const updateShadowFn = (window as WindowWithEngineGlobals).updateShadowSettings;
    if (updateShadowFn) {
      const shadowSettings = {
        enabled: newSettings.shadowEnabled,
        resolution: newSettings.shadowResolution,
        cascades: 3, // Fixed value for now
        shadowDistance: newSettings.shadowDistance,
        softness: newSettings.shadowSoftness,
        bias: newSettings.shadowBias,
        normalBias: newSettings.shadowNormalBias,
        intensity: newSettings.shadowIntensity,
        shadowBlendFraction: newSettings.shadowBlendFraction,
        shadowBlendMin: newSettings.shadowBlendMin,
      };
      updateShadowFn(shadowSettings);
      // console.log(`[DebugPanel] Updated shadow settings:`, shadowSettings);
    } else {
      console.error('[DebugPanel] updateShadowSettings not available!');
    }

    // Handle exposure through updateGraphicsSettings as well
    if (key === 'exposure') {
      const updateGraphicsFn = (window as WindowWithEngineGlobals).updateGraphicsSettings;
      if (updateGraphicsFn) {
        updateGraphicsFn({
          timeOfDay: { t: timeOfDay, paused: timePaused, cycleSeconds },
          renderer: { exposure: newSettings.exposure }
        });
        console.log(`[DebugPanel] Updated graphics settings for exposure`);
      } else {
        console.error('[DebugPanel] updateGraphicsSettings not available!');
      }
    }
  };

  return (
    <div ref={panelRef} style={{
      position: 'fixed',
      top: '52px',
      left: '12px',
      width: '320px',
      background: 'linear-gradient(145deg, rgba(32,39,49,0.98), rgba(22,27,35,0.98))',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: '16px',
      padding: '20px',
      color: '#f8f9fa',
      fontSize: '13px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      zIndex: 2000,
      maxHeight: '80vh',
      overflowY: 'auto',
      backdropFilter: 'blur(20px)',
      boxShadow: '0 20px 60px rgba(0,0,0,0.7), 0 8px 32px rgba(0,0,0,0.4)',
    }}>
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center', 
        marginBottom: '20px',
        paddingBottom: '16px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        position: 'sticky',
        top: 0,
        background: 'linear-gradient(145deg, rgba(32,39,49,0.98), rgba(22,27,35,0.98))',
        zIndex: 1
      }}>
        <h3 style={{ 
          margin: 0, 
          fontSize: '18px', 
          fontWeight: 700,
          background: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text'
        }}>Graphics Settings</h3>
        <button
          onClick={() => setDebugVisible(false)}
          style={{
            background: 'linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05))',
            border: '1px solid rgba(255,255,255,0.1)',
            color: '#f8f9fa',
            cursor: 'pointer',
            padding: '8px 10px',
            borderRadius: '8px',
            fontSize: '14px',
            fontWeight: 600,
            transition: 'all 0.2s ease',
            outline: 'none'
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.background = 'linear-gradient(135deg, rgba(255,255,255,0.15), rgba(255,255,255,0.08))'
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)'
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.background = 'linear-gradient(135deg, rgba(255,255,255,0.1), rgba(255,255,255,0.05))'
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'
          }}
        >
          ✕
        </button>
      </div>

      {/* Day/Night Cycle */}
      <div style={{ marginBottom: '20px' }}>
        <h4 style={{
          margin: '0 0 12px 0',
          fontSize: '14px',
          color: '#e2e8f0',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          paddingBottom: '6px'
        }}>Day/Night Cycle</h4>

        <label style={{ display: 'flex', alignItems: 'center', marginBottom: '10px', cursor: 'pointer', padding: '8px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <input
            type="checkbox"
            checked={timePaused}
            onChange={(e) => {
              const paused = e.target.checked;
              setTimePaused(paused);
              (window as WindowWithEngineGlobals).updateGraphicsSettings?.({ timeOfDay: { t: timeOfDay, paused, cycleSeconds }, renderer: { exposure: settings.exposure } });
            }}
            style={{ marginRight: '10px', transform: 'scale(1.1)' }}
          />
          <span style={{ fontWeight: 500 }}>Pause Cycle</span>
        </label>

        <label style={{ display: 'block', marginBottom: '12px', padding: '8px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.02)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '12px', fontWeight: 500, color: '#94a3b8' }}>
            <span>Time</span>
            <span style={{ color: '#e2e8f0' }}>{timeOfDay.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={timeOfDay}
            onChange={(e) => {
              const t = parseFloat(e.target.value);
              setTimeOfDay(t);
              (window as WindowWithEngineGlobals).updateGraphicsSettings?.({ timeOfDay: { t, paused: timePaused, cycleSeconds }, renderer: { exposure: settings.exposure } });
            }}
            style={{ width: '100%', height: '4px', borderRadius: '2px', background: 'rgba(255,255,255,0.1)', outline: 'none', cursor: 'pointer' }}
          />
        </label>

        <label style={{ display: 'block', marginBottom: '12px', padding: '8px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.02)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '12px', fontWeight: 500, color: '#94a3b8' }}>
            <span>Cycle Length (s)</span>
            <span style={{ color: '#e2e8f0' }}>{cycleSeconds}</span>
          </div>
          <input
            type="range"
            min="30"
            max="600"
            step="10"
            value={cycleSeconds}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              setCycleSeconds(v);
              (window as WindowWithEngineGlobals).updateGraphicsSettings?.({ timeOfDay: { t: timeOfDay, paused: timePaused, cycleSeconds: v }, renderer: { exposure: settings.exposure } });
            }}
            style={{ width: '100%', height: '4px', borderRadius: '2px', background: 'rgba(255,255,255,0.1)', outline: 'none', cursor: 'pointer' }}
          />
        </label>
      </div>

      {/* SSAO Settings */}
      <div style={{ marginBottom: '20px' }}>
        <h4 style={{ 
          margin: '0 0 12px 0', 
          fontSize: '14px', 
          color: '#e2e8f0',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          paddingBottom: '6px'
        }}>Screen Space Ambient Occlusion</h4>
        
        <label style={{ 
          display: 'flex', 
          alignItems: 'center', 
          marginBottom: '10px',
          cursor: 'pointer',
          padding: '8px 12px',
          borderRadius: '8px',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.06)',
          transition: 'all 0.2s ease'
        }}>
          <input
            type="checkbox"
            checked={settings.ssaoEnabled}
            onChange={(e) => handleSettingChange('ssaoEnabled', e.target.checked)}
            style={{ 
              marginRight: '10px',
              transform: 'scale(1.1)' 
            }}
          />
          <span style={{ fontWeight: 500 }}>Enable SSAO</span>
        </label>

        <label style={{ 
          display: 'block', 
          marginBottom: '12px', 
          opacity: settings.ssaoEnabled ? 1 : 0.5,
          padding: '8px 12px',
          borderRadius: '8px',
          background: 'rgba(255,255,255,0.02)'
        }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between',
            marginBottom: '6px',
            fontSize: '12px',
            fontWeight: 500,
            color: '#94a3b8'
          }}>
            <span>Intensity</span>
            <span style={{ color: '#e2e8f0' }}>{settings.ssaoIntensity.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={settings.ssaoIntensity}
            onChange={(e) => handleSettingChange('ssaoIntensity', parseFloat(e.target.value))}
            disabled={!settings.ssaoEnabled}
            style={{ 
              width: '100%', 
              height: '4px',
              borderRadius: '2px',
              background: 'rgba(255,255,255,0.1)',
              outline: 'none',
              cursor: 'pointer'
            }}
          />
        </label>

        <label style={{ 
          display: 'block', 
          marginBottom: '12px', 
          opacity: settings.ssaoEnabled ? 1 : 0.5,
          padding: '8px 12px',
          borderRadius: '8px',
          background: 'rgba(255,255,255,0.02)'
        }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between',
            marginBottom: '6px',
            fontSize: '12px',
            fontWeight: 500,
            color: '#94a3b8'
          }}>
            <span>Radius</span>
            <span style={{ color: '#e2e8f0' }}>{settings.ssaoRadius.toFixed(3)}</span>
          </div>
          <input
            type="range"
            min="0.05"
            max="0.5"
            step="0.01"
            value={settings.ssaoRadius}
            onChange={(e) => handleSettingChange('ssaoRadius', parseFloat(e.target.value))}
            disabled={!settings.ssaoEnabled}
            style={{ 
              width: '100%', 
              height: '4px',
              borderRadius: '2px',
              background: 'rgba(255,255,255,0.1)',
              outline: 'none',
              cursor: 'pointer'
            }}
          />
        </label>
      </div>

      {/* Bloom Settings */}
      <div style={{ marginBottom: '20px' }}>
        <h4 style={{ 
          margin: '0 0 12px 0', 
          fontSize: '14px', 
          color: '#e2e8f0',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          paddingBottom: '6px'
        }}>Bloom Effects</h4>
        
        <label style={{ 
          display: 'flex', 
          alignItems: 'center', 
          marginBottom: '10px',
          cursor: 'pointer',
          padding: '8px 12px',
          borderRadius: '8px',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.06)',
          transition: 'all 0.2s ease'
        }}>
          <input
            type="checkbox"
            checked={settings.bloomEnabled}
            onChange={(e) => handleSettingChange('bloomEnabled', e.target.checked)}
            style={{ 
              marginRight: '10px',
              transform: 'scale(1.1)' 
            }}
          />
          <span style={{ fontWeight: 500 }}>Enable Bloom</span>
        </label>

        <label style={{ 
          display: 'block', 
          marginBottom: '12px', 
          opacity: settings.bloomEnabled ? 1 : 0.5,
          padding: '8px 12px',
          borderRadius: '8px',
          background: 'rgba(255,255,255,0.02)'
        }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between',
            marginBottom: '6px',
            fontSize: '12px',
            fontWeight: 500,
            color: '#94a3b8'
          }}>
            <span>Strength</span>
            <span style={{ color: '#e2e8f0' }}>{settings.bloomStrength.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={settings.bloomStrength}
            onChange={(e) => handleSettingChange('bloomStrength', parseFloat(e.target.value))}
            disabled={!settings.bloomEnabled}
            style={{ 
              width: '100%', 
              height: '4px',
              borderRadius: '2px',
              background: 'rgba(255,255,255,0.1)',
              outline: 'none',
              cursor: 'pointer'
            }}
          />
        </label>

        <label style={{ 
          display: 'block', 
          marginBottom: '12px', 
          opacity: settings.bloomEnabled ? 1 : 0.5,
          padding: '8px 12px',
          borderRadius: '8px',
          background: 'rgba(255,255,255,0.02)'
        }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between',
            marginBottom: '6px',
            fontSize: '12px',
            fontWeight: 500,
            color: '#94a3b8'
          }}>
            <span>Threshold</span>
            <span style={{ color: '#e2e8f0' }}>{settings.bloomThreshold.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min="0"
            max="0.8"
            step="0.05"
            value={settings.bloomThreshold}
            onChange={(e) => handleSettingChange('bloomThreshold', parseFloat(e.target.value))}
            disabled={!settings.bloomEnabled}
            style={{ 
              width: '100%', 
              height: '4px',
              borderRadius: '2px',
              background: 'rgba(255,255,255,0.1)',
              outline: 'none',
              cursor: 'pointer'
            }}
          />
        </label>
      </div>

      {/* Shadow Settings */}
      <div style={{ marginBottom: '20px' }}>
        <h4 style={{ 
          margin: '0 0 12px 0', 
          fontSize: '14px', 
          color: '#e2e8f0',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          paddingBottom: '6px'
        }}>Dynamic Shadows</h4>
        
        <label style={{ 
          display: 'flex', 
          alignItems: 'center', 
          marginBottom: '10px',
          cursor: 'pointer',
          padding: '8px 12px',
          borderRadius: '8px',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.06)',
          transition: 'all 0.2s ease'
        }}>
          <input
            type="checkbox"
            checked={settings.shadowEnabled}
            onChange={(e) => handleSettingChange('shadowEnabled', e.target.checked)}
            style={{ 
              marginRight: '10px',
              transform: 'scale(1.1)' 
            }}
          />
          <span style={{ fontWeight: 500 }}>Enable Shadows</span>
        </label>


        <label style={{ 
          display: 'block', 
          marginBottom: '12px', 
          opacity: settings.shadowEnabled ? 1 : 0.5,
          padding: '8px 12px',
          borderRadius: '8px',
          background: 'rgba(255,255,255,0.02)'
        }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between',
            marginBottom: '6px',
            fontSize: '12px',
            fontWeight: 500,
            color: '#94a3b8'
          }}>
            <span>Distance</span>
            <span style={{ color: '#e2e8f0' }}>{settings.shadowDistance}</span>
          </div>
          <input
            type="range"
            min="50"
            max="2000"
            step="10"
            value={settings.shadowDistance}
            onChange={(e) => handleSettingChange('shadowDistance', parseFloat(e.target.value))}
            disabled={!settings.shadowEnabled}
            style={{ 
              width: '100%', 
              height: '4px',
              borderRadius: '2px',
              background: 'rgba(255,255,255,0.1)',
              outline: 'none',
              cursor: 'pointer'
            }}
          />
        </label>

        

        <label style={{ 
          display: 'block', 
          marginBottom: '12px', 
          opacity: settings.shadowEnabled ? 1 : 0.5,
          padding: '8px 12px',
          borderRadius: '8px',
          background: 'rgba(255,255,255,0.02)'
        }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between',
            marginBottom: '6px',
            fontSize: '12px',
            fontWeight: 500,
            color: '#94a3b8'
          }}>
            <span>Intensity</span>
            <span style={{ color: '#e2e8f0' }}>{settings.shadowIntensity.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={settings.shadowIntensity}
            onChange={(e) => handleSettingChange('shadowIntensity', parseFloat(e.target.value))}
            disabled={!settings.shadowEnabled}
            style={{ 
              width: '100%', 
              height: '4px',
              borderRadius: '2px',
              background: 'rgba(255,255,255,0.1)',
              outline: 'none',
              cursor: 'pointer'
            }}
          />
        </label>

        <label style={{ 
          display: 'block', 
          marginBottom: '12px', 
          opacity: settings.shadowEnabled ? 1 : 0.5,
          padding: '8px 12px',
          borderRadius: '8px',
          background: 'rgba(255,255,255,0.02)'
        }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between',
            marginBottom: '6px',
            fontSize: '12px',
            fontWeight: 500,
            color: '#94a3b8'
          }}>
            <span>Blend Fraction</span>
            <span style={{ color: '#e2e8f0' }}>{settings.shadowBlendFraction.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min="0"
            max="5"
            step="0.05"
            value={settings.shadowBlendFraction}
            onChange={(e) => handleSettingChange('shadowBlendFraction', parseFloat(e.target.value))}
            disabled={!settings.shadowEnabled}
            style={{ 
              width: '100%', 
              height: '4px',
              borderRadius: '2px',
              background: 'rgba(255,255,255,0.1)',
              outline: 'none',
              cursor: 'pointer'
            }}
          />
        </label>

        <label style={{ 
          display: 'block', 
          marginBottom: '12px', 
          opacity: settings.shadowEnabled ? 1 : 0.5,
          padding: '8px 12px',
          borderRadius: '8px',
          background: 'rgba(255,255,255,0.02)'
        }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between',
            marginBottom: '6px',
            fontSize: '12px',
            fontWeight: 500,
            color: '#94a3b8'
          }}>
            <span>Blend Min (units)</span>
            <span style={{ color: '#e2e8f0' }}>{settings.shadowBlendMin.toFixed(1)}</span>
          </div>
          <input
            type="range"
            min="0"
            max="50"
            step="1"
            value={settings.shadowBlendMin}
            onChange={(e) => handleSettingChange('shadowBlendMin', parseFloat(e.target.value))}
            disabled={!settings.shadowEnabled}
            style={{ 
              width: '100%', 
              height: '4px',
              borderRadius: '2px',
              background: 'rgba(255,255,255,0.1)',
              outline: 'none',
              cursor: 'pointer'
            }}
          />
        </label>

        <label style={{ 
          display: 'block', 
          marginBottom: '12px', 
          opacity: settings.shadowEnabled ? 1 : 0.5,
          padding: '8px 12px',
          borderRadius: '8px',
          background: 'rgba(255,255,255,0.02)'
        }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between',
            marginBottom: '6px',
            fontSize: '12px',
            fontWeight: 500,
            color: '#94a3b8'
          }}>
            <span>Bias</span>
            <span style={{ color: '#e2e8f0' }}>{settings.shadowBias.toFixed(5)}</span>
          </div>
          <input
            type="range"
            min="0"
            max="0.002"
            step="0.0001"
            value={settings.shadowBias}
            onChange={(e) => handleSettingChange('shadowBias', parseFloat(e.target.value))}
            disabled={!settings.shadowEnabled}
            style={{ 
              width: '100%', 
              height: '4px',
              borderRadius: '2px',
              background: 'rgba(255,255,255,0.1)',
              outline: 'none',
              cursor: 'pointer'
            }}
          />
        </label>

        <label style={{ 
          display: 'block', 
          marginBottom: '12px', 
          opacity: settings.shadowEnabled ? 1 : 0.5,
          padding: '8px 12px',
          borderRadius: '8px',
          background: 'rgba(255,255,255,0.02)'
        }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between',
            marginBottom: '6px',
            fontSize: '12px',
            fontWeight: 500,
            color: '#94a3b8'
          }}>
            <span>Normal Bias</span>
            <span style={{ color: '#e2e8f0' }}>{settings.shadowNormalBias.toFixed(3)}</span>
          </div>
          <input
            type="range"
            min="0"
            max="0.1"
            step="0.001"
            value={settings.shadowNormalBias}
            onChange={(e) => handleSettingChange('shadowNormalBias', parseFloat(e.target.value))}
            disabled={!settings.shadowEnabled}
            style={{ 
              width: '100%', 
              height: '4px',
              borderRadius: '2px',
              background: 'rgba(255,255,255,0.1)',
              outline: 'none',
              cursor: 'pointer'
            }}
          />
        </label>
      </div>

      {/* Fog */}
      <div style={{ marginBottom: '20px' }}>
        <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#e2e8f0', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '6px' }}>Height Fog</h4>
        <label style={{ display: 'flex', alignItems: 'center', marginBottom: '10px', cursor: 'pointer', padding: '8px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <input type="checkbox" checked={!!settings.fogEnabled} onChange={(e) => handleSettingChange('fogEnabled', e.target.checked)} style={{ marginRight: '10px', transform: 'scale(1.1)' }} />
          <span style={{ fontWeight: 500 }}>Enable Fog</span>
        </label>
        <label style={{ display: 'block', marginBottom: '12px', padding: '8px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.02)', opacity: settings.fogEnabled ? 1 : 0.5 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '12px', fontWeight: 500, color: '#94a3b8' }}>
            <span>Base Density</span>
            <span style={{ color: '#e2e8f0' }}>{(settings.fogBaseDensity ?? 0).toFixed(4)}</span>
          </div>
          <input type="range" min="0" max="0.01" step="0.0005" value={settings.fogBaseDensity ?? 0} onChange={(e) => handleSettingChange('fogBaseDensity', parseFloat(e.target.value))} disabled={!settings.fogEnabled} style={{ width: '100%', height: '4px', borderRadius: '2px', background: 'rgba(255,255,255,0.1)', outline: 'none', cursor: 'pointer' }} />
        </label>
        <label style={{ display: 'block', marginBottom: '12px', padding: '8px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.02)', opacity: settings.fogEnabled ? 1 : 0.5 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '12px', fontWeight: 500, color: '#94a3b8' }}>
            <span>Max Distance</span>
            <span style={{ color: '#e2e8f0' }}>{settings.fogMaxDistance}</span>
          </div>
          <input type="range" min="50" max="2000" step="10" value={settings.fogMaxDistance ?? 600} onChange={(e) => handleSettingChange('fogMaxDistance', parseFloat(e.target.value))} disabled={!settings.fogEnabled} style={{ width: '100%', height: '4px', borderRadius: '2px', background: 'rgba(255,255,255,0.1)', outline: 'none', cursor: 'pointer' }} />
        </label>
      </div>

      {/* Volumetrics */}
      <div>
        <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#e2e8f0', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '6px' }}>Volumetric Lighting</h4>
        <label style={{ display: 'flex', alignItems: 'center', marginBottom: '10px', cursor: 'pointer', padding: '8px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <input type="checkbox" checked={!!settings.volumetricsEnabled} onChange={(e) => handleSettingChange('volumetricsEnabled', e.target.checked)} style={{ marginRight: '10px', transform: 'scale(1.1)' }} />
          <span style={{ fontWeight: 500 }}>Enable Volumetrics</span>
        </label>
        <label style={{ display: 'block', marginBottom: '12px', padding: '8px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.02)', opacity: settings.volumetricsEnabled ? 1 : 0.5 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '12px', fontWeight: 500, color: '#94a3b8' }}>
            <span>Intensity</span>
            <span style={{ color: '#e2e8f0' }}>{(settings.volumetricsIntensity ?? 0).toFixed(2)}</span>
          </div>
          <input type="range" min="0" max="2" step="0.05" value={settings.volumetricsIntensity ?? 0.5} onChange={(e) => handleSettingChange('volumetricsIntensity', parseFloat(e.target.value))} disabled={!settings.volumetricsEnabled} style={{ width: '100%', height: '4px', borderRadius: '2px', background: 'rgba(255,255,255,0.1)', outline: 'none', cursor: 'pointer' }} />
        </label>
        <label style={{ display: 'block', marginBottom: '12px', padding: '8px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.02)', opacity: settings.volumetricsEnabled ? 1 : 0.5 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '12px', fontWeight: 500, color: '#94a3b8' }}>
            <span>Steps</span>
            <span style={{ color: '#e2e8f0' }}>{settings.volumetricsSteps}</span>
          </div>
          <input type="range" min="8" max="64" step="1" value={settings.volumetricsSteps ?? 32} onChange={(e) => handleSettingChange('volumetricsSteps', parseInt(e.target.value, 10))} disabled={!settings.volumetricsEnabled} style={{ width: '100%', height: '4px', borderRadius: '2px', background: 'rgba(255,255,255,0.1)', outline: 'none', cursor: 'pointer' }} />
        </label>
      </div>

      {/* Clouds */}
      <div style={{ marginTop: '20px' }}>
        <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#e2e8f0', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '6px' }}>Clouds</h4>
        <label style={{ display: 'flex', alignItems: 'center', marginBottom: '10px', cursor: 'pointer', padding: '8px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <input type="checkbox" checked={cloudsEnabled} onChange={(e) => setCloudsEnabled(e.target.checked)} style={{ marginRight: '10px', transform: 'scale(1.1)' }} />
          <span style={{ fontWeight: 500 }}>Enable Clouds</span>
        </label>
        <label style={{ display: 'block', marginBottom: '12px', padding: '8px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.02)', opacity: cloudsEnabled ? 1 : 0.5 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '12px', fontWeight: 500, color: '#94a3b8' }}>
            <span>Coverage</span>
            <span style={{ color: '#e2e8f0' }}>{cloudsCoverage.toFixed(2)}</span>
          </div>
          <input type="range" min="0" max="1" step="0.01" value={cloudsCoverage} onChange={(e) => {
            const v = parseFloat(e.target.value); setCloudsCoverage(v);
          }} disabled={!cloudsEnabled} style={{ width: '100%', height: '4px', borderRadius: '2px', background: 'rgba(255,255,255,0.1)', outline: 'none', cursor: 'pointer' }} />
        </label>
        <label style={{ display: 'block', padding: '8px 12px', borderRadius: '8px', background: 'rgba(255,255,255,0.02)', opacity: cloudsEnabled ? 1 : 0.5 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '12px', fontWeight: 500, color: '#94a3b8' }}>
            <span>Density</span>
            <span style={{ color: '#e2e8f0' }}>{cloudsDensity.toFixed(2)}</span>
          </div>
          <input type="range" min="0" max="1" step="0.01" value={cloudsDensity} onChange={(e) => {
            const v = parseFloat(e.target.value); setCloudsDensity(v);
          }} disabled={!cloudsEnabled} style={{ width: '100%', height: '4px', borderRadius: '2px', background: 'rgba(255,255,255,0.1)', outline: 'none', cursor: 'pointer' }} />
        </label>
      </div>

      {/* Color Settings */}
      <div style={{ marginTop: '20px' }}>
        <h4 style={{ 
          margin: '0 0 12px 0', 
          fontSize: '14px', 
          color: '#e2e8f0',
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          paddingBottom: '6px'
        }}>Color Grading</h4>
        
        <label style={{ 
          display: 'block', 
          marginBottom: '12px',
          padding: '8px 12px',
          borderRadius: '8px',
          background: 'rgba(255,255,255,0.02)'
        }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between',
            marginBottom: '6px',
            fontSize: '12px',
            fontWeight: 500,
            color: '#94a3b8'
          }}>
            <span>Exposure</span>
            <span style={{ color: '#e2e8f0' }}>{settings.exposure.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.05"
            value={settings.exposure}
            onChange={(e) => handleSettingChange('exposure', parseFloat(e.target.value))}
            style={{ 
              width: '100%', 
              height: '4px',
              borderRadius: '2px',
              background: 'rgba(255,255,255,0.1)',
              outline: 'none',
              cursor: 'pointer'
            }}
          />
        </label>

        <label style={{ 
          display: 'block', 
          marginBottom: '12px',
          padding: '8px 12px',
          borderRadius: '8px',
          background: 'rgba(255,255,255,0.02)'
        }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between',
            marginBottom: '6px',
            fontSize: '12px',
            fontWeight: 500,
            color: '#94a3b8'
          }}>
            <span>Contrast</span>
            <span style={{ color: '#e2e8f0' }}>{settings.contrast.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.05"
            value={settings.contrast}
            onChange={(e) => handleSettingChange('contrast', parseFloat(e.target.value))}
            style={{ 
              width: '100%', 
              height: '4px',
              borderRadius: '2px',
              background: 'rgba(255,255,255,0.1)',
              outline: 'none',
              cursor: 'pointer'
            }}
          />
        </label>

        <label style={{ 
          display: 'block', 
          marginBottom: '12px',
          padding: '8px 12px',
          borderRadius: '8px',
          background: 'rgba(255,255,255,0.02)'
        }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between',
            marginBottom: '6px',
            fontSize: '12px',
            fontWeight: 500,
            color: '#94a3b8'
          }}>
            <span>Saturation</span>
            <span style={{ color: '#e2e8f0' }}>{settings.saturation.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.05"
            value={settings.saturation}
            onChange={(e) => handleSettingChange('saturation', parseFloat(e.target.value))}
            style={{ 
              width: '100%', 
              height: '4px',
              borderRadius: '2px',
              background: 'rgba(255,255,255,0.1)',
              outline: 'none',
              cursor: 'pointer'
            }}
          />
        </label>
      </div>
    </div>
  );
};
