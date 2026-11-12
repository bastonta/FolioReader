/**
 * Identity / Authentication API functions.
 */

import { invoke } from '@tauri-apps/api/core';
import { apiPost, type ApiError } from './client';
import {
  getServerUrl,
  clearTokens,
  whenAuthCookiesCleared,
  getFreshAccessToken,
  refreshAccessToken,
  setAccessToken,
  SessionRejectedError,
} from './tokenManager';
import type {
  LoginResponse,
  Login2faResponse,
  Login2faType,
  RegisterResponse,
  EmailConfirmResponse,
  EmailConfirmResendResponse,
  PasswordForgotResponse,
  PasswordResetValidationResponse,
} from '../types/auth';

interface AuthProxyResponse {
  status: number;
  body: string;
}

function handleProxyResponse<T>(res: AuthProxyResponse): T {
  let data: any = null;
  try {
    data = res.body ? JSON.parse(res.body) : null;
  } catch {
    data = res.body;
  }

  if (res.status < 200 || res.status >= 300) {
    let message = 'Request failed';
    if (typeof data === 'object' && data !== null) {
      if (Array.isArray(data.errors) && data.errors.length > 0 && data.errors[0]?.message) {
        message = data.errors[0].message;
      } else if (data.detail) {
        message = data.detail;
      } else if (data.message) {
        message = data.message;
      }
    } else if (typeof data === 'string' && data) {
      message = data;
    }
    const error: ApiError = {
      status: res.status,
      message,
      data,
    };
    throw error;
  }

  return data as T;
}

export const authApi = {
  login: async (email: string, password: string): Promise<LoginResponse> => {
    const serverUrl = getServerUrl();
    if (!serverUrl) throw new Error('Server URL not configured');

    // A pending `clear_auth_cookies` must not wipe the refresh token this
    // login is about to receive.
    await whenAuthCookiesCleared();
    const res = await invoke<AuthProxyResponse>('auth_login_proxy', {
      serverUrl,
      email,
      password,
    });
    // The access token is stored by the caller (AuthContext) once the local
    // database is known to belong to this account.
    return handleProxyResponse<LoginResponse>(res);
  },

  login2fa: async (
    userId: string,
    token: string,
    code: string,
    type: Login2faType = 'code',
  ): Promise<Login2faResponse> => {
    const serverUrl = getServerUrl();
    if (!serverUrl) throw new Error('Server URL not configured');

    await whenAuthCookiesCleared();
    const res = await invoke<AuthProxyResponse>('auth_login_2fa_proxy', {
      serverUrl,
      userId,
      token,
      code,
      loginType: type,
    });
    return handleProxyResponse<Login2faResponse>(res);
  },

  register: async (
    name: string,
    email: string,
    password: string,
  ): Promise<RegisterResponse> => {
    return apiPost<RegisterResponse>('/identity/register', {
      name,
      email,
      password,
    });
  },

  emailConfirm: async (
    userId: string,
    code: string,
  ): Promise<EmailConfirmResponse> => {
    const serverUrl = getServerUrl();
    if (!serverUrl) throw new Error('Server URL not configured');

    await whenAuthCookiesCleared();
    const res = await invoke<AuthProxyResponse>('auth_email_confirm_proxy', {
      serverUrl,
      userId,
      code,
    });
    return handleProxyResponse<EmailConfirmResponse>(res);
  },

  emailConfirmResend: async (
    userIdOrParams?: string | { userId?: string; email?: string },
    email?: string,
  ): Promise<EmailConfirmResendResponse> => {
    let payload: { userId?: string; email?: string } = {};
    if (typeof userIdOrParams === 'string') {
      payload = { userId: userIdOrParams, email };
    } else if (userIdOrParams && typeof userIdOrParams === 'object') {
      payload = userIdOrParams;
    } else if (email) {
      payload = { email };
    }
    return apiPost<EmailConfirmResendResponse>(
      '/identity/email-confirm-resend',
      payload,
    );
  },

  passwordForgot: async (email: string): Promise<PasswordForgotResponse> => {
    return apiPost<PasswordForgotResponse>('/identity/password-forgot', {
      email,
    });
  },

  passwordResetValidation: async (
    email: string,
    code: string,
  ): Promise<PasswordResetValidationResponse> => {
    return apiPost<PasswordResetValidationResponse>(
      '/identity/password-reset-validation',
      { email, code },
    );
  },

  passwordReset: async (
    email: string,
    token: string,
    password: string,
  ): Promise<void> => {
    await apiPost('/identity/password-reset', { email, token, password });
  },

  /**
   * Changes the password of the signed-in account.
   *
   * The server revokes every token issued before the change and answers like
   * a successful login: a new access token in the body and a new refresh
   * token in a cookie. Only the Rust auth proxy can keep that cookie, so the
   * request goes through it and the session survives the change (older
   * servers return no body; the session then stays as it was).
   */
  changePassword: async (
    oldPassword: string,
    newPassword: string,
  ): Promise<void> => {
    const serverUrl = getServerUrl();
    if (!serverUrl) throw new Error('Server URL not configured');

    const send = (token: string) =>
      invoke<AuthProxyResponse>('auth_password_change_proxy', {
        serverUrl,
        token,
        oldPassword,
        newPassword,
      });

    let token = await getFreshAccessToken();
    if (!token) {
      throw { status: 401, message: 'Session expired' } as ApiError;
    }
    let res = await send(token);
    if (res.status === 401) {
      // The access token was rejected before its own expiry time
      try {
        token = await refreshAccessToken();
      } catch (err) {
        throw {
          status: err instanceof SessionRejectedError ? 401 : 0,
          message:
            err instanceof SessionRejectedError
              ? 'Session expired'
              : 'Network error: session refresh failed',
          data: err,
        } as ApiError;
      }
      res = await send(token);
    }

    const data = handleProxyResponse<{ token?: unknown } | null>(res);
    if (data && typeof data.token === 'string' && data.token) {
      setAccessToken(data.token);
    }
  },

  logout: async (): Promise<void> => {
    const serverUrl = getServerUrl();
    if (serverUrl) {
      try {
        await invoke('auth_revoke_token', { serverUrl });
      } catch {
        // Ignore revoke errors — we clear locally regardless
      }
    }
    // Only the credentials go away. Local reading data stays for the next
    // sign-in of the same account (see `claimLocalDataForUser`).
    clearTokens();
  },
};

