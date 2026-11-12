/**
 * Singleton Token Manager
 *
 * Stores access token in a module-level variable so every import shares the
 * same value. Prevents refresh-token races by queuing concurrent 401
 * retries behind a single in-flight refresh request.
 *
 * All refresh token requests and rotation are handled via Rust proxy commands.
 */

import { invoke } from '@tauri-apps/api/core';
import type { User } from '../types/auth';

// ─── Module-level state (shared across all imports) ──────────────────────

let accessToken: string | null = null;
let isRefreshing = false;
let refreshQueue: Array<{
  resolve: (token: string) => void;
  reject: (err: unknown) => void;
}> = [];

// ─── localStorage keys ──────────────────────────────────────────────────

const ACCESS_TOKEN_KEY = 'folio_access_token';
const SERVER_URL_KEY = 'folio_server_url';
const CACHED_USER_KEY = 'folio_cached_user';

// ─── Helpers ─────────────────────────────────────────────────────────────

export function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return true;
  }
  if (typeof err === 'string') {
    const lower = err.toLowerCase();
    return (
      lower.includes('network error') ||
      lower.includes('failed to fetch') ||
      lower.includes('connection refused') ||
      lower.includes('timeout') ||
      lower.includes('dns') ||
      lower.includes('host unreachable')
    );
  }
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = String((err as any).message).toLowerCase();
    return (
      msg.includes('network error') ||
      msg.includes('failed to fetch') ||
      msg.includes('connection refused') ||
      msg.includes('timeout') ||
      msg.includes('dns') ||
      msg.includes('host unreachable')
    );
  }
  return false;
}

function processQueue(error: unknown, token: string | null = null) {
  const queue = refreshQueue;
  refreshQueue = [];
  queue.forEach(({ resolve, reject }) => {
    if (error) {
      reject(error);
    } else {
      resolve(token!);
    }
  });
}

// ─── Public API ──────────────────────────────────────────────────────────

/** Return the current access token (from memory, falling back to storage). */
export function getAccessToken(): string | null {
  if (!accessToken) {
    accessToken = localStorage.getItem(ACCESS_TOKEN_KEY);
  }
  return accessToken;
}

/** Persist a new access token (or clear it with `null`). */
export function setAccessToken(token: string | null) {
  accessToken = token;
  if (token) {
    localStorage.setItem(ACCESS_TOKEN_KEY, token);
  } else {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
  }
}

/** Return the cached user profile. */
export function getCachedUser(): User | null {
  try {
    const raw = localStorage.getItem(CACHED_USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

/** Persist or clear the cached user profile. */
export function setCachedUser(user: User | null) {
  if (user) {
    localStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(CACHED_USER_KEY);
  }
}

/** Return the saved server URL, e.g. `https://folio.example.com`. */
export function getServerUrl(): string | null {
  return localStorage.getItem(SERVER_URL_KEY);
}

/** Persist server URL (with trailing slash stripped). */
export function setServerUrl(url: string | null) {
  if (url) {
    // Normalise: remove trailing slash
    const normalised = url.replace(/\/+$/, '');
    localStorage.setItem(SERVER_URL_KEY, normalised);
  } else {
    localStorage.removeItem(SERVER_URL_KEY);
  }
}

// Clearing the refresh cookie is an asynchronous Rust command. Tauri gives no
// ordering guarantee between two commands, so a login sent right after it
// could have its brand-new refresh token wiped. Callers that start a new
// session wait for this promise first.
let pendingCookieClear: Promise<void> = Promise.resolve();

/** Clear all tokens (used on logout / session expiry). */
export function clearTokens() {
  accessToken = null;
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(CACHED_USER_KEY);
  const previous = pendingCookieClear;
  pendingCookieClear = previous
    .then(() => invoke<void>('clear_auth_cookies'))
    .catch(() => {});
}

/** Resolves once every `clear_auth_cookies` call issued so far has finished. */
export function whenAuthCookiesCleared(): Promise<void> {
  return pendingCookieClear;
}

// ─── Session end ─────────────────────────────────────────────────────────

/**
 * Thrown by `refreshAccessToken` when the server definitively rejected the
 * refresh token (400/401) or there is no refresh token at all. This is the
 * ONLY condition that ends a session; network errors, timeouts and 5xx
 * responses leave the stored tokens untouched.
 */
export class SessionRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionRejectedError';
  }
}

function errorText(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return '';
}

/** True when a `refresh_access_token` failure means the session is over. */
function isRefreshRejected(err: unknown): boolean {
  const text = errorText(err);
  return (
    /^Refresh failed with status (400|401)\b/.test(text) ||
    text.startsWith('UNAUTHORIZED') ||
    text.startsWith('No refresh token available')
  );
}

/**
 * Drop the credentials of a session the server no longer accepts and tell
 * the app. Local reading data is NOT touched here (see `AuthContext`).
 */
function endRejectedSession() {
  clearTokens();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('folio:session-expired'));
  }
}

/** Prefix of the error a Rust command returns for a rejected access token. */
const UNAUTHORIZED_PREFIX = 'UNAUTHORIZED';

// The token of the latest refresh and when it arrived (see `getFreshAccessToken`)
let lastRefreshedToken: string | null = null;
let lastRefreshAt = 0;
const JUST_REFRESHED_MS = 30_000;

/** Seconds since the epoch at which a JWT expires, or null if unknown. */
function tokenExpiry(token: string): number | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const payload: unknown = JSON.parse(atob(padded));
    if (payload && typeof payload === 'object' && 'exp' in payload) {
      const exp = Number((payload as { exp: unknown }).exp);
      return Number.isFinite(exp) ? exp : null;
    }
  } catch {
    // not a JWT we can read — treat the expiry as unknown
  }
  return null;
}

/**
 * Refresh the access token via Rust proxy.
 *
 * If a refresh is already in flight, callers are queued and resolved once
 * the single refresh request completes — preventing concurrent refresh
 * races.
 *
 * Rejects with `SessionRejectedError` (after clearing the tokens and
 * dispatching `folio:session-expired`) only when the refresh endpoint itself
 * turned the session down. Any other failure (offline, timeout, 5xx,
 * unparsable response) is rethrown as is and keeps the session.
 */
export async function refreshAccessToken(): Promise<string> {
  // If another caller is already refreshing, queue this one
  if (isRefreshing) {
    return new Promise<string>((resolve, reject) => {
      refreshQueue.push({ resolve, reject });
    });
  }

  isRefreshing = true;
  const tokenBefore = getAccessToken();

  try {
    const serverUrl = getServerUrl();
    if (!serverUrl) throw new Error('Server URL not configured');

    const newToken = await invoke<string>('refresh_access_token', {
      serverUrl,
    });

    if (!newToken) {
      throw new Error('Token refresh failed');
    }

    setAccessToken(newToken);
    lastRefreshedToken = newToken;
    lastRefreshAt = Date.now();
    processQueue(null, newToken);
    return newToken;
  } catch (err) {
    let failure: unknown = err;
    if (isRefreshRejected(err)) {
      failure = new SessionRejectedError(errorText(err) || 'Session expired');
      // A login that completed while the refresh was in flight has already
      // stored a new token: that session is not the one that was rejected.
      if (getAccessToken() === tokenBefore) {
        endRejectedSession();
      }
    }
    processQueue(failure);
    throw failure;
  } finally {
    isRefreshing = false;
  }
}

/**
 * Access token that is valid for at least `minValiditySeconds` more seconds.
 *
 * Returns the stored token, refreshing it first (single-flight, shared with
 * the 401 handling of the HTTP client) when it is missing or about to
 * expire. Returns `null` when there is no session or the refresh failed.
 * Use it for every token handed to a Rust command: those commands cannot
 * refresh the token themselves.
 */
export async function getFreshAccessToken(
  minValiditySeconds = 60,
): Promise<string | null> {
  const token = getAccessToken();
  if (token) {
    const exp = tokenExpiry(token);
    // Unknown expiry: nothing to compare against, hand the token out as is.
    if (exp === null || exp - Date.now() / 1000 > minValiditySeconds) {
      return token;
    }
    // A token the server issued a moment ago is fresh whatever the device
    // clock says: a clock that runs ahead must not cause a refresh per call.
    if (
      token === lastRefreshedToken &&
      Date.now() - lastRefreshAt < JUST_REFRESHED_MS
    ) {
      return token;
    }
  } else if (!getCachedUser()) {
    return null; // signed out
  }
  if (!getServerUrl()) return null;

  try {
    return await refreshAccessToken();
  } catch {
    return null;
  }
}

/** True for the error of a Rust command whose access token the server rejected. */
export function isUnauthorizedError(err: unknown): boolean {
  return errorText(err).startsWith(UNAUTHORIZED_PREFIX);
}

/**
 * Runs a Rust command that sends the access token to the server.
 *
 * `run` receives a token from `getFreshAccessToken`. Rust commands cannot
 * refresh it themselves and report a rejected token as an error starting
 * with `UNAUTHORIZED`; the token is then refreshed and `run` repeated (the
 * token can be rejected before its own expiry time, e.g. when the clocks
 * disagree). `maxRenewals` is how many times that may happen: one for an
 * ordinary request, more for a command that outlives a token (building a
 * large book from chapters) and continues where it stopped when repeated.
 * Without a usable token the server is not asked at all and the call fails
 * with an `UNAUTHORIZED` error.
 */
export async function withFreshAccessToken<T>(
  run: (token: string) => Promise<T>,
  maxRenewals = 1,
): Promise<T> {
  let token = await getFreshAccessToken();
  if (!token) {
    throw new Error(`${UNAUTHORIZED_PREFIX}: no valid session`);
  }
  for (let renewals = 0; ; renewals++) {
    try {
      return await run(token);
    } catch (err) {
      if (!isUnauthorizedError(err) || renewals >= maxRenewals) throw err;
      try {
        token = await refreshAccessToken();
      } catch {
        throw err;
      }
    }
  }
}
