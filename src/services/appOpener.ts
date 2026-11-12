import { invoke } from '@tauri-apps/api/core';

const isTauri = (): boolean => {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
};

/** True for absolute links that belong in the system browser / mail client. */
export function isExternalLinkUrl(url: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(url.trim());
}

/**
 * Keeps the application window on the application.
 *
 * A plain `<a href>` inside injected HTML (book description, footnote, ...)
 * would navigate the whole WebView away from the app with no way back. This
 * safety net cancels the default action of every link activation that would
 * leave the current document. It opens nothing itself: components decide
 * what a link does (see `openExternalUrl`), this only guarantees that a link
 * nobody handled cannot replace the app.
 */
export function installExternalLinkGuard(): void {
  if (typeof document === 'undefined') return;

  const handler = (ev: MouseEvent) => {
    const target = ev.target as Element | null;
    const anchor = target?.closest?.('a[href], area[href]');
    if (!anchor) return;

    const rawHref = (anchor.getAttribute('href') || '').trim();
    // Hash routes of the app itself
    if (rawHref.startsWith('#')) return;
    // Saving a locally generated file (image viewer)
    if (anchor.hasAttribute('download') && /^(blob:|data:)/i.test(rawHref)) return;

    try {
      const resolved = new URL(rawHref, document.baseURI);
      const here = window.location;
      if (
        resolved.origin === here.origin &&
        resolved.pathname === here.pathname &&
        resolved.search === here.search
      ) {
        return; // same document, only the hash differs
      }
    } catch {
      // unparsable href: cancel it as well
    }

    ev.preventDefault();
  };

  document.addEventListener('click', handler, true);
  document.addEventListener('auxclick', handler, true);
}

/**
 * Robustly opens an external URL in the system's default browser.
 * Safe for Linux AppImage environments, macOS, Windows, and mobile devices.
 */
export async function openExternalUrl(url: string): Promise<void> {
  if (!url || typeof url !== 'string') return;
  const cleanUrl = url.trim();
  if (!cleanUrl) return;
  // URLs come from book content and server-provided HTML: only hand web and
  // mail links to the operating system, never `file:`, custom schemes, etc.
  if (!isExternalLinkUrl(cleanUrl)) {
    console.warn('Refusing to open a non-web URL externally:', cleanUrl);
    return;
  }

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
