/**
 * Debug panel for post-processing controls and graphics settings
 */

import React, { useState, useEffect } from 'react';
import { useUIStore } from '../state/ui';

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
    ssaoRadius: 0.12,
    bloomEnabled: true,
    bloomStrength: 0.15,
    bloomThreshold: 1.0,
    exposure: 0.9,
    contrast: 1.05,
    saturation: 1.0,
    shadowEnabled: false, // Start disabled to avoid WebGL issues
    shadowResolution: 1024,
    shadowDistance: 100,
    shadowSoftness: 2.5,
    shadowIntensity: 0.6,
  });

  // Initialize settings on mount
  useEffect(() => {
    // Apply initial settings to the engine
    (window as any).updatePostProcessingSettings?.(settings);
    (window as any).updateShadowSettings?.({
      enabled: settings.shadowEnabled,
      resolution: settings.shadowResolution,
      shadowDistance: settings.shadowDistance,
      softness: settings.shadowSoftness,
      intensity: settings.shadowIntensity,
    });
  }, []); // Only run once on mount

  if (!debugVisible) {
    return (
      <div style={{
        position: 'fixed',
        top: '52px', // Position under the "Press P to pause" banner
        left: '12px', // Align with the pause banner
        zIndex: 1000,
      }}>
        <button
          onClick={() => setDebugVisible(true)}
          style={{
            padding: '6px 8px',
            backgroundColor: 'rgba(0, 0, 0, 0.35)',
            color: '#cfe9ef',
            border: 'none',
            borderRadius: '6px',
            cursor: 'pointer',
            fontSize: '12px',
            fontFamily: 'monospace',
            pointerEvents: 'auto',
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

    // Communicate with engine (this will be improved with proper state management)
    (window as any).updatePostProcessingSettings?.(newSettings);
    (window as any).updateShadowSettings?.({
      enabled: newSettings.shadowEnabled,
      resolution: newSettings.shadowResolution,
      shadowDistance: newSettings.shadowDistance,
      softness: newSettings.shadowSoftness,
      intensity: newSettings.shadowIntensity,
    });
  };

  return (
    <div style={{
      position: 'fixed',
      top: '52px',
      left: '12px',
      width: '280px',
      backgroundColor: 'rgba(0, 0, 0, 0.9)',
      border: '1px solid #666',
      borderRadius: '8px',
      padding: '12px',
      color: 'white',
      fontSize: '12px',
      fontFamily: 'monospace',
      zIndex: 1000,
      maxHeight: '80vh',
      overflowY: 'auto',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <h3 style={{ margin: 0, fontSize: '14px' }}>Graphics Settings</h3>
        <button
          onClick={() => setDebugVisible(false)}
          style={{
            background: 'none',
            border: '1px solid #666',
            color: 'white',
            cursor: 'pointer',
            padding: '4px 8px',
            borderRadius: '3px',
          }}
        >
          ×
        </button>
      </div>

      {/* SSAO Settings */}
      <div style={{ marginBottom: '16px' }}>
        <h4 style={{ margin: '0 0 8px 0', fontSize: '12px', color: '#ccc' }}>Screen Space Ambient Occlusion</h4>
        
        <label style={{ display: 'flex', alignItems: 'center', marginBottom: '6px' }}>
          <input
            type="checkbox"
            checked={settings.ssaoEnabled}
            onChange={(e) => handleSettingChange('ssaoEnabled', e.target.checked)}
            style={{ marginRight: '8px' }}
          />
          Enable SSAO
        </label>

        <label style={{ display: 'block', marginBottom: '6px' }}>
          Intensity: {settings.ssaoIntensity.toFixed(2)}
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={settings.ssaoIntensity}
            onChange={(e) => handleSettingChange('ssaoIntensity', parseFloat(e.target.value))}
            style={{ width: '100%', marginTop: '4px' }}
          />
        </label>

        <label style={{ display: 'block', marginBottom: '6px' }}>
          Radius: {settings.ssaoRadius.toFixed(3)}
          <input
            type="range"
            min="0.05"
            max="0.5"
            step="0.01"
            value={settings.ssaoRadius}
            onChange={(e) => handleSettingChange('ssaoRadius', parseFloat(e.target.value))}
            style={{ width: '100%', marginTop: '4px' }}
          />
        </label>
      </div>

      {/* Bloom Settings */}
      <div style={{ marginBottom: '16px' }}>
        <h4 style={{ margin: '0 0 8px 0', fontSize: '12px', color: '#ccc' }}>Bloom Effects</h4>
        
        <label style={{ display: 'flex', alignItems: 'center', marginBottom: '6px' }}>
          <input
            type="checkbox"
            checked={settings.bloomEnabled}
            onChange={(e) => handleSettingChange('bloomEnabled', e.target.checked)}
            style={{ marginRight: '8px' }}
          />
          Enable Bloom
        </label>

        <label style={{ display: 'block', marginBottom: '6px' }}>
          Strength: {settings.bloomStrength.toFixed(2)}
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={settings.bloomStrength}
            onChange={(e) => handleSettingChange('bloomStrength', parseFloat(e.target.value))}
            style={{ width: '100%', marginTop: '4px' }}
          />
        </label>

        <label style={{ display: 'block', marginBottom: '6px' }}>
          Threshold: {settings.bloomThreshold.toFixed(2)}
          <input
            type="range"
            min="0"
            max="2"
            step="0.05"
            value={settings.bloomThreshold}
            onChange={(e) => handleSettingChange('bloomThreshold', parseFloat(e.target.value))}
            style={{ width: '100%', marginTop: '4px' }}
          />
        </label>
      </div>

      {/* Shadow Settings */}
      <div style={{ marginBottom: '16px' }}>
        <h4 style={{ margin: '0 0 8px 0', fontSize: '12px', color: '#ccc' }}>Dynamic Shadows</h4>
        
        <label style={{ display: 'flex', alignItems: 'center', marginBottom: '6px' }}>
          <input
            type="checkbox"
            checked={settings.shadowEnabled}
            onChange={(e) => handleSettingChange('shadowEnabled', e.target.checked)}
            style={{ marginRight: '8px' }}
          />
          Enable Shadows
        </label>

        <label style={{ display: 'block', marginBottom: '6px' }}>
          Resolution: {settings.shadowResolution}
          <select
            value={settings.shadowResolution}
            onChange={(e) => handleSettingChange('shadowResolution', parseInt(e.target.value))}
            style={{ width: '100%', marginTop: '4px', padding: '2px' }}
          >
            <option value={512}>512 (Fast)</option>
            <option value={1024}>1024 (Balanced)</option>
            <option value={2048}>2048 (High)</option>
            <option value={4096}>4096 (Ultra)</option>
          </select>
        </label>

        <label style={{ display: 'block', marginBottom: '6px' }}>
          Distance: {settings.shadowDistance}
          <input
            type="range"
            min="50"
            max="200"
            step="10"
            value={settings.shadowDistance}
            onChange={(e) => handleSettingChange('shadowDistance', parseFloat(e.target.value))}
            style={{ width: '100%', marginTop: '4px' }}
          />
        </label>

        <label style={{ display: 'block', marginBottom: '6px' }}>
          Softness: {settings.shadowSoftness.toFixed(1)}
          <input
            type="range"
            min="0.5"
            max="5"
            step="0.1"
            value={settings.shadowSoftness}
            onChange={(e) => handleSettingChange('shadowSoftness', parseFloat(e.target.value))}
            style={{ width: '100%', marginTop: '4px' }}
          />
        </label>

        <label style={{ display: 'block', marginBottom: '6px' }}>
          Intensity: {settings.shadowIntensity.toFixed(2)}
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={settings.shadowIntensity}
            onChange={(e) => handleSettingChange('shadowIntensity', parseFloat(e.target.value))}
            style={{ width: '100%', marginTop: '4px' }}
          />
        </label>
      </div>

      {/* Color Settings */}
      <div>
        <h4 style={{ margin: '0 0 8px 0', fontSize: '12px', color: '#ccc' }}>Color Grading</h4>
        
        <label style={{ display: 'block', marginBottom: '6px' }}>
          Exposure: {settings.exposure.toFixed(2)}
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.05"
            value={settings.exposure}
            onChange={(e) => handleSettingChange('exposure', parseFloat(e.target.value))}
            style={{ width: '100%', marginTop: '4px' }}
          />
        </label>

        <label style={{ display: 'block', marginBottom: '6px' }}>
          Contrast: {settings.contrast.toFixed(2)}
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.05"
            value={settings.contrast}
            onChange={(e) => handleSettingChange('contrast', parseFloat(e.target.value))}
            style={{ width: '100%', marginTop: '4px' }}
          />
        </label>

        <label style={{ display: 'block', marginBottom: '6px' }}>
          Saturation: {settings.saturation.toFixed(2)}
          <input
            type="range"
            min="0.5"
            max="2"
            step="0.05"
            value={settings.saturation}
            onChange={(e) => handleSettingChange('saturation', parseFloat(e.target.value))}
            style={{ width: '100%', marginTop: '4px' }}
          />
        </label>
      </div>
    </div>
  );
};