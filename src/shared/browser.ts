/**
 * Simple browser/device detection helpers for gating heavy features.
 * Keep logic conservative: only block when reasonably certain.
 */

export function isMobileDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = (navigator.userAgent || '').toLowerCase();
  // Common mobile indicators
  if (/android|iphone|ipad|ipod|iemobile|mobile|blackberry|bb10|silk|kindle/.test(ua)) return true;
  // iPadOS 13+ reports as Mac but has touch points
  const isIpadOs = navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1;
  return !!isIpadOs;
}

export function isSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  // Safari if UA contains Safari but not Chrome/Chromium/Edge/Opera or iOS Chrome/Firefox tokens
  const hasSafari = /Safari/i.test(ua);
  const hasOther = /Chrome|CriOS|Chromium|Edg|OPR|FxiOS/i.test(ua);
  return hasSafari && !hasOther;
}

export function isSafariDesktop(): boolean {
  return isSafari() && !isMobileDevice();
}
