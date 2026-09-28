/**
 * Build information injected at bundle time by Vite
 */

export const APP_VERSION: string = __APP_VERSION__;
export const BUILD_TIME: string = __BUILD_TIME__;
export const IS_DEBUG: boolean = Boolean(import.meta.env.DEV);
export const DISPLAY_VERSION: string = IS_DEBUG ? `${APP_VERSION} (Debug)` : APP_VERSION;

/**
 * Format ISO build time into a human-readable localized date and time string
 */
export function formatBuildTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) {
      return isoString;
    }
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
}
