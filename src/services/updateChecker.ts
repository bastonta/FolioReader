import { invoke } from '@tauri-apps/api/core';
import { isMobileDevice } from './systemUi';
import { APP_VERSION } from '../constants/buildInfo';
import { openExternalUrl } from './appOpener';

// Constants
export const GITHUB_REPO_OWNER = 'bastonta';
export const GITHUB_REPO_NAME = 'FolioApp';
export const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases`;
export const GITHUB_RELEASES_PAGE = `https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases`;

const DISMISSED_VERSION_KEY = 'folio_dismissed_update_version';
const LAST_CHECK_KEY = 'folio_last_update_check';

let inMemoryDismissedVersion: string | null = null;
let inMemoryLastCheckTime: string | null = null;

const isTauri = (): boolean => {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
};

// ─── Interfaces ────────────────────────────────────────────────────────────

export interface GitHubAsset {
  id: number;
  name: string;
  size: number;
  browser_download_url: string;
  content_type: string;
}

export interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string;
  body: string;
  draft: boolean;
  prerelease: boolean;
  html_url: string;
  published_at: string;
  assets: GitHubAsset[];
}

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
  isDev: boolean;
  original: string;
}

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  releaseNotes: string;
  htmlUrl: string;
  isPrerelease: boolean;
  publishedAt: string;
  releaseName: string;
  assetUrl?: string;
  assetName?: string;
}

export type UpdateStatus =
  | 'update-available'
  | 'up-to-date'
  | 'dev-build'
  | 'no-releases'
  | 'error';

export interface UpdateCheckResult {
  status: UpdateStatus;
  updateInfo?: UpdateInfo;
  error?: string;
}

export interface CheckOptions {
  auto?: boolean;
  includePrereleases?: boolean;
  timeoutMs?: number;
  currentVersion?: string;
}

// ─── Version Parsing & Comparison ──────────────────────────────────────────

/**
 * Check whether a version string represents a development/debug build.
 * Returns true if version string contains 'dev' (e.g., "0.0.1-dev", "dev", "1.0.0-dev.1").
 */
export function isDevVersion(versionString: string = APP_VERSION): boolean {
  if (typeof versionString !== 'string') return false;
  return /dev/i.test(versionString);
}

/**
 * Parse semantic version string (e.g., "0.1.0-beta", "v1.0.0", "dev", "0.0.1-dev").
 */
export function parseVersion(versionString: string): ParsedVersion | null {
  if (typeof versionString !== 'string') return null;

  const clean = versionString.replace(/^[vV]\.?/, '').trim();
  const containsDev = isDevVersion(clean);

  if (clean.toLowerCase() === 'dev' || clean.toLowerCase().startsWith('dev')) {
    return {
      major: 9999,
      minor: 9999,
      patch: 9999,
      prerelease: 'dev',
      isDev: true,
      original: versionString,
    };
  }

  // Check major.minor.patch[-prerelease]
  const match3 = clean.match(/^(\d+)\.(\d+)\.(\d+)(?:-?(.+))?$/);
  if (match3) {
    const prerelease = match3[4]?.trim() || undefined;
    return {
      major: parseInt(match3[1], 10),
      minor: parseInt(match3[2], 10),
      patch: parseInt(match3[3], 10),
      prerelease,
      isDev: containsDev,
      original: versionString,
    };
  }

  // Check major.minor[-prerelease]
  const match2 = clean.match(/^(\d+)\.(\d+)(?:-?(.+))?$/);
  if (match2) {
    const prerelease = match2[3]?.trim() || undefined;
    return {
      major: parseInt(match2[1], 10),
      minor: parseInt(match2[2], 10),
      patch: 0,
      prerelease,
      isDev: containsDev,
      original: versionString,
    };
  }

  if (containsDev) {
    return {
      major: 9999,
      minor: 9999,
      patch: 9999,
      prerelease: 'dev',
      isDev: true,
      original: versionString,
    };
  }

  return null;
}

/**
 * Compare two semantic versions.
 * Returns:
 *   -1 if v1 < v2
 *    0 if v1 == v2
 *    1 if v1 > v2
 */
export function compareVersions(v1: string, v2: string): number {
  const ver1 = parseVersion(v1);
  const ver2 = parseVersion(v2);

  if (!ver1 || !ver2) {
    if (ver1 && !ver2) return 1;
    if (!ver1 && ver2) return -1;
    return 0;
  }

  // Dev builds are considered newer than releases
  if (ver1.isDev && !ver2.isDev) return 1;
  if (ver2.isDev && !ver1.isDev) return -1;
  if (ver1.isDev && ver2.isDev) return 0;

  // Compare major.minor.patch
  if (ver1.major !== ver2.major) {
    return ver1.major < ver2.major ? -1 : 1;
  }
  if (ver1.minor !== ver2.minor) {
    return ver1.minor < ver2.minor ? -1 : 1;
  }
  if (ver1.patch !== ver2.patch) {
    return ver1.patch < ver2.patch ? -1 : 1;
  }

  // Handle prereleases: release > prerelease (1.0.0 > 1.0.0-beta)
  if (!ver1.prerelease && ver2.prerelease) {
    return 1;
  }
  if (ver1.prerelease && !ver2.prerelease) {
    return -1;
  }
  if (ver1.prerelease && ver2.prerelease) {
    const prereleaseOrder: Record<string, number> = {
      alpha: 1,
      beta: 2,
      rc: 3,
      preview: 3,
      release: 4,
    };
    const pre1Type = ver1.prerelease.match(/^[a-zA-Z]+/)?.[0]?.toLowerCase() || '';
    const pre2Type = ver2.prerelease.match(/^[a-zA-Z]+/)?.[0]?.toLowerCase() || '';
    const order1 = prereleaseOrder[pre1Type] || 0;
    const order2 = prereleaseOrder[pre2Type] || 0;

    if (order1 !== order2) {
      return order1 < order2 ? -1 : 1;
    }

    return ver1.prerelease.localeCompare(ver2.prerelease, undefined, { numeric: true });
  }

  return 0;
}

// ─── Platform Asset Detection ──────────────────────────────────────────────

/**
 * Identify the best matching binary download asset for the current OS/device.
 */
export function getPlatformDownloadAsset(release: GitHubRelease): GitHubAsset | null {
  if (!release.assets || release.assets.length === 0) return null;

  const isMobile = isMobileDevice();

  if (isMobile) {
    const apkAssets = release.assets.filter((a) => a.name.toLowerCase().endsWith('.apk'));
    if (apkAssets.length > 0) {
      // Prioritize universal or arm64 builds
      const universal = apkAssets.find((a) => a.name.toLowerCase().includes('universal'));
      if (universal) return universal;
      const arm64 = apkAssets.find(
        (a) => a.name.toLowerCase().includes('arm64') || a.name.toLowerCase().includes('aarch64')
      );
      if (arm64) return arm64;
      return apkAssets[0];
    }
  } else {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : '';
    if (ua.includes('win')) {
      const exe = release.assets.find(
        (a) =>
          a.name.toLowerCase().endsWith('.exe') ||
          a.name.toLowerCase().endsWith('.msi') ||
          a.name.toLowerCase().includes('setup')
      );
      if (exe) return exe;
    } else if (ua.includes('linux')) {
      const linuxAsset = release.assets.find(
        (a) => a.name.toLowerCase().endsWith('.appimage') || a.name.toLowerCase().endsWith('.deb')
      );
      if (linuxAsset) return linuxAsset;
    } else if (ua.includes('mac')) {
      const macAsset = release.assets.find(
        (a) => a.name.toLowerCase().endsWith('.dmg') || a.name.toLowerCase().endsWith('.tar.gz')
      );
      if (macAsset) return macAsset;
    }
  }

  return null;
}

// ─── Open URL in System Browser ────────────────────────────────────────────

/**
 * Open external URL using AppImage-safe opener with fallback to window.open.
 */
export async function openReleaseUrl(url: string): Promise<void> {
  if (!url) return;
  await openExternalUrl(url);
}

// ─── Storage Helpers ───────────────────────────────────────────────────────

export function isUpdateDismissed(version: string): boolean {
  if (inMemoryDismissedVersion !== null) {
    return inMemoryDismissedVersion === version;
  }
  try {
    const dismissed = localStorage.getItem(DISMISSED_VERSION_KEY);
    return dismissed === version;
  } catch {
    return false;
  }
}

export function dismissUpdate(version: string): void {
  inMemoryDismissedVersion = version;
  if (isTauri()) {
    invoke('db_set_app_kv', { key: DISMISSED_VERSION_KEY, value: version }).catch(console.warn);
  }
  try {
    localStorage.setItem(DISMISSED_VERSION_KEY, version);
  } catch (err) {
    console.error('Failed to save dismissed update version:', err);
  }
}

export function getLastUpdateCheckTime(): string | null {
  if (inMemoryLastCheckTime !== null) {
    return inMemoryLastCheckTime;
  }
  try {
    return localStorage.getItem(LAST_CHECK_KEY);
  } catch {
    return null;
  }
}

export function setLastUpdateCheckTime(time?: string): void {
  const val = time || new Date().toISOString();
  inMemoryLastCheckTime = val;
  if (isTauri()) {
    invoke('db_set_app_kv', { key: LAST_CHECK_KEY, value: val }).catch(console.warn);
  }
  try {
    localStorage.setItem(LAST_CHECK_KEY, val);
  } catch (err) {
    console.error('Failed to save last update check time:', err);
  }
}

export async function initUpdateCheckerKv(): Promise<void> {
  if (!isTauri()) return;
  try {
    const dismissed = await invoke<string | null>('db_get_app_kv', { key: DISMISSED_VERSION_KEY });
    if (dismissed) inMemoryDismissedVersion = dismissed;
    const lastCheck = await invoke<string | null>('db_get_app_kv', { key: LAST_CHECK_KEY });
    if (lastCheck) inMemoryLastCheckTime = lastCheck;
  } catch (err) {
    console.warn('Failed to init update checker KV from SQLite:', err);
  }
}

// ─── GitHub Releases Fetcher ───────────────────────────────────────────────

/**
 * Fetch releases from GitHub API with timeout and error handling.
 */
export async function fetchReleases(timeoutMs = 12000): Promise<GitHubRelease[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  let fetchFn = typeof fetch !== 'undefined' ? fetch : null;

  // Try Tauri plugin-http fetch if available for cross-platform TLS/CORS consistency
  try {
    const tauriHttp = await import('@tauri-apps/plugin-http');
    if (tauriHttp && typeof tauriHttp.fetch === 'function') {
      fetchFn = tauriHttp.fetch;
    }
  } catch {
    // Fallback to global fetch
  }

  if (!fetchFn) {
    throw new Error('No HTTP fetch client available');
  }

  try {
    const res = await fetchFn(GITHUB_API_URL, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'FolioApp',
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      if (res.status === 404) {
        return [];
      }
      throw new Error(`GitHub API returned status ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    if (!Array.isArray(data)) {
      throw new Error('Invalid response format from GitHub API');
    }

    return data as GitHubRelease[];
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── Main Update Check Method ──────────────────────────────────────────────

/**
 * Check for updates against GitHub Releases.
 */
export async function checkForUpdates(options: CheckOptions = {}): Promise<UpdateCheckResult> {
  const {
    auto = false,
    includePrereleases = false,
    timeoutMs = auto ? 8000 : 15000,
    currentVersion = APP_VERSION,
  } = options;

  // Development/debug builds containing 'dev' should not check for updates
  if (isDevVersion(currentVersion)) {
    return {
      status: 'dev-build',
    };
  }

  try {
    const releases = await fetchReleases(timeoutMs);
    setLastUpdateCheckTime();

    if (!releases || releases.length === 0) {
      return { status: 'no-releases' };
    }

    let latestRelease: GitHubRelease | null = null;
    let latestVersionStr: string | null = null;

    for (const release of releases) {
      if (release.draft) continue;
      if (!includePrereleases && release.prerelease) continue;

      const rawTag = release.tag_name || '';
      const cleanVer = rawTag.replace(/^[vV]\.?/, '').trim();
      if (!cleanVer || !parseVersion(cleanVer)) continue;

      if (!latestRelease || !latestVersionStr) {
        latestRelease = release;
        latestVersionStr = cleanVer;
      } else {
        if (compareVersions(cleanVer, latestVersionStr) > 0) {
          latestRelease = release;
          latestVersionStr = cleanVer;
        }
      }
    }

    if (!latestRelease || !latestVersionStr) {
      return { status: 'no-releases' };
    }

    const comparison = compareVersions(currentVersion, latestVersionStr);

    if (comparison < 0) {
      const asset = getPlatformDownloadAsset(latestRelease);

      const updateInfo: UpdateInfo = {
        currentVersion,
        latestVersion: latestVersionStr,
        releaseNotes: latestRelease.body || '',
        htmlUrl: latestRelease.html_url || GITHUB_RELEASES_PAGE,
        isPrerelease: latestRelease.prerelease || false,
        publishedAt: latestRelease.published_at || new Date().toISOString(),
        releaseName: latestRelease.name || `Folio v${latestVersionStr}`,
        assetUrl: asset?.browser_download_url,
        assetName: asset?.name,
      };

      return {
        status: 'update-available',
        updateInfo,
      };
    } else if (comparison === 0) {
      return {
        status: 'up-to-date',
      };
    } else {
      return {
        status: 'dev-build',
      };
    }
  } catch (err: any) {
    const errorMsg =
      err?.name === 'AbortError'
        ? 'Request timed out'
        : err?.message || 'Failed to check for updates';

    console.warn('Update check failed:', errorMsg);

    return {
      status: 'error',
      error: errorMsg,
    };
  }
}
