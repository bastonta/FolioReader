import { invoke } from '@tauri-apps/api/core';

const isTauri = (): boolean => {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
};

/**
 * Robustly opens an external URL in the system's default browser.
 * Safe for Linux AppImage environments, macOS, Windows, and mobile devices.
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (!url || typeof url !== 'string') return;
  const cleanUrl = url.trim();
  if (!cleanUrl) return;

  // 1. Try our AppImage-safe Rust backend command first
  if (isTauri()) {
    try {
      await invoke('open_external_url', { url: cleanUrl });
      return;
    } catch (err) {
      console.warn('Tauri open_external_url failed, trying plugin-opener:', err);
    }
  }

  // 2. Try Tauri plugin-opener guest binding
  try {
    const opener = await import('@tauri-apps/plugin-opener');
    if (opener && typeof opener.openUrl === 'function') {
      await opener.openUrl(cleanUrl);
      return;
    }
  } catch (err) {
    console.warn('Tauri plugin-opener openUrl failed:', err);
  }

  // 3. Web / Browser fallback
  if (typeof window !== 'undefined') {
    try {
      const newWin = window.open(cleanUrl, '_blank', 'noopener,noreferrer');
      if (!newWin && typeof location !== 'undefined') {
        console.warn('window.open was blocked or unavailable');
      }
    } catch (err) {
      console.error('window.open failed:', err);
    }
  }
}

/**
 * Robustly opens a folder or file in the native system file explorer.
 */
export async function openExternalPath(path: string): Promise<void> {
  if (!path || typeof path !== 'string') return;
  const cleanPath = path.trim();
  if (!cleanPath) return;

  if (isTauri()) {
    try {
      await invoke('open_external_path', { path: cleanPath });
      return;
    } catch (err) {
      console.warn('Tauri open_external_path failed, trying plugin-opener:', err);
    }
  }

  try {
    const opener = await import('@tauri-apps/plugin-opener');
    if (opener && typeof opener.openPath === 'function') {
      await opener.openPath(cleanPath);
      return;
    }
  } catch (err) {
    console.error('Failed to open path:', err);
  }
}
