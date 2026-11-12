/**
 * Fetch-based HTTP client for the Folio API.
 *
 * All requests flow through `apiFetch` which:
 *   - Resolves the base URL from the token manager's `getServerUrl()`
 *   - Attaches the `Authorization: Bearer` header
 *   - On 401 (non-identity endpoints): triggers a single token refresh then
 *     retries the original request once. The session ends only when the
 *     refresh endpoint itself rejects the session, never because of the
 *     status of the retried request
 *   - Sends `credentials: 'include'` so the WebView passes cookies
 */

import { fetch } from '@tauri-apps/plugin-http';
import {
  getAccessToken,
  getServerUrl,
  refreshAccessToken,
  SessionRejectedError,
} from './tokenManager';

// ─── Types ───────────────────────────────────────────────────────────────

export interface ApiError {
  status: number;
  message: string;
  data?: unknown;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function apiBase(): string {
  const url = getServerUrl();
  if (!url) throw new Error('Server URL not configured');
  return `${url}/api`;
}

function isAuthPath(path: string): boolean {
  return path.startsWith('/identity/');
}

async function parseErrorBody(res: Response): Promise<ApiError> {
  let message = res.statusText || 'Request failed';
  let data: unknown;
  try {
    data = await res.json();
    if (typeof data === 'object' && data !== null && 'message' in data) {
      message = (data as { message: string }).message;
    }
  } catch {
    // response body wasn't JSON
  }
  return { status: res.status, message, data };
}

// ─── Connection status state ───────────────────────────────────────────────

let isConnectionLost = typeof navigator !== 'undefined' ? !navigator.onLine : false;

if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => {
    if (!isConnectionLost) {
      isConnectionLost = true;
      window.dispatchEvent(new CustomEvent('folio:connection-lost'));
    }
  });
}

function notifyConnectionRestored() {
  if (isConnectionLost) {
    isConnectionLost = false;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('folio:connection-restored'));
    }
  }
}

function notifyConnectionLost() {
  if (!isConnectionLost) {
    isConnectionLost = true;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('folio:connection-lost'));
    }
  }
}

// ─── Core fetch wrapper ──────────────────────────────────────────────────

/**
 * Make an authenticated API request.
 *
 * @param path   Relative path (e.g. `/identity/login` or `/profile/info`)
 * @param init   Standard RequestInit overrides
 * @param _retry Internal flag to prevent infinite retry loops
 */
export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
  _retry = false,
): Promise<T> {
  const base = apiBase();
  const url = `${base}${path}`;

  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const token = getAccessToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  let res: Response;
  const controller = !init.signal ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), 10000) : null;
  try {
    res = await fetch(url, {
      ...init,
      headers,
      credentials: 'include',
      signal: init.signal || controller?.signal,
    });
    notifyConnectionRestored();
  } catch (netErr: any) {
    notifyConnectionLost();
    throw {
      status: 0,
      message: netErr?.message || 'Network error: server unreachable',
      data: netErr,
    } as ApiError;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  // ── Handle 401 with automatic token refresh ────────────────────────
  if (res.status === 401 && !_retry && !isAuthPath(path)) {
    // Only the refresh itself is guarded here. The session ends solely when
    // the refresh endpoint rejects it (`SessionRejectedError`; the token
    // manager has then already cleared the tokens and announced it). The
    // retried request below is an ordinary request: whatever it answers
    // (404, 409, 5xx, even 401) is reported to the caller and nothing else.
    let newToken: string;
    try {
      newToken = await refreshAccessToken();
    } catch (refreshErr: unknown) {
      if (refreshErr instanceof SessionRejectedError) {
        throw { status: 401, message: 'Session expired' } as ApiError;
      }
      throw {
        status: 0,
        message: 'Network error: session refresh failed, will retry later',
        data: refreshErr,
      } as ApiError;
    }

    headers.set('Authorization', `Bearer ${newToken}`);
    return apiFetch<T>(path, { ...init, headers }, true);
  }

  if (!res.ok) {
    throw await parseErrorBody(res);
  }

  // Handle empty body
  const ct = res.headers.get('content-type');
  if (res.status === 204 || !ct?.includes('application/json')) {
    return undefined as T;
  }

  // Tokens are never stored implicitly here: sign-in goes through the Rust
  // auth proxy (which also keeps the refresh cookie), and other identity
  // responses carry tokens that are not access tokens (e.g. the password
  // reset token), which must not replace the session token.
  const data = await res.json();

  return data as T;
}

// ─── Convenience methods ─────────────────────────────────────────────────

export function apiGet<T = unknown>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: 'GET' });
}

export function apiPost<T = unknown>(
  path: string,
  body?: unknown,
): Promise<T> {
  return apiFetch<T>(path, {
    method: 'POST',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export function apiPut<T = unknown>(
  path: string,
  body?: unknown,
): Promise<T> {
  return apiFetch<T>(path, {
    method: 'PUT',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export function apiDelete<T = unknown>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: 'DELETE' });
}
