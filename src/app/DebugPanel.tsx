/**
 * Debug panel for post-processing controls and graphics settings
 */

import React, { useState, useEffect } from 'react';
import { useUIStore } from '../state/ui';
import type { PostProcessorSettings } from '../engine/render/SimplePostProcessor';
import type { ShadowSettings } from '../engine/render/ShadowSystem';

interface WindowWithEngineGlobals extends Window {
  updatePostProcessingSettings?: (settings: PostProcessorSettings) => void;
  updateShadowSettings?: (settings: ShadowSettings) => void;
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
}

export const DebugPanel: React.FC = () => {
  const { debugVisible, setDebugVisible } = useUIStore();
  const [settings, setSettings] = useState<PostProcessingSettings>({
    ssaoEnabled: true,
    ssaoIntensity: 0.3,
    ssaoRadius: 0.01,
    bloomEnabled: true,
    bloomStrength: 0.4,
    bloomThreshold: 0.3,
    exposure: 0.9,
    contrast: 1.05,
    saturation: 1.0,
    shadowEnabled: true, // Enable shadows by default
    shadowResolution: 1024,
    shadowDistance: 1000,
    shadowSoftness: 2.5,
    shadowIntensity: 0.6,
  });

  // Initialize settings on mount
  useEffect(() => {
    // Apply initial settings to the engine with a small delay to ensure engine is ready
    const timer = setTimeout(() => {
      console.log('[DebugPanel] Initializing settings on mount');
      const updateFn = (window as WindowWithEngineGlobals).updatePostProcessingSettings;
      if (updateFn) {
        updateFn(settings);
        console.log('[DebugPanel] Applied initial post-processing settings');
      } else {
        console.warn('[DebugPanel] Post-processing not available during initialization');
      }
      
      const updateShadowFn = (window as WindowWithEngineGlobals).updateShadowSettings;
      if (updateShadowFn) {
        const shadowSettings = {
          enabled: settings.shadowEnabled,
          resolution: settings.shadowResolution,
          cascades: 3,
          shadowDistance: settings.shadowDistance,
          softness: settings.shadowSoftness,
          bias: -0.0005,
          normalBias: 0.02,
          intensity: settings.shadowIntensity,
        };
        updateShadowFn(shadowSettings);
        console.log('[DebugPanel] Applied initial shadow settings');
      } else {
        console.warn('[DebugPanel] Shadow system not available during initialization');
      }
    }, 1000);
    
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run once on mount

  if (!debugVisible) {
    return (
      <div style={{
        position: 'fixed',
        top: '52px',
        left: '12px',
        zIndex: 1000,
      }}>
        <button
          onClick={() => setDebugVisible(true)}
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
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.transform = 'translateY(-1px)'
            e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.4)'
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)'
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.transform = 'translateY(0)'
            e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.3)'
            e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'
          }}
        >
          Graphics Settings
        </button>
      </div>
    );
  }

  const handleSettingChange = (key: keyof PostProcessingSettings, value: number | boolean) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);

    console.log(`[DebugPanel] Setting ${key} to ${value}`);
    
    // Communicate with engine
    const updateFn = (window as WindowWithEngineGlobals).updatePostProcessingSettings;
    if (updateFn) {
      updateFn(newSettings);
      console.log(`[DebugPanel] Updated post-processing:`, newSettings);
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
        bias: -0.0005, // Fixed value for now
        normalBias: 0.02, // Fixed value for now
        intensity: newSettings.shadowIntensity,
      };
      updateShadowFn(shadowSettings);
      console.log(`[DebugPanel] Updated shadow settings:`, shadowSettings);
    } else {
      console.error('[DebugPanel] updateShadowSettings not available!');
    }
  };

  return (
    <div style={{
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
      zIndex: 1000,
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
        borderBottom: '1px solid rgba(255,255,255,0.06)'
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
      </div>

      {/* Color Settings */}
      <div>
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