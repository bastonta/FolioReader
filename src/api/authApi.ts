/**
 * Identity / Authentication API functions.
 */

import { invoke } from '@tauri-apps/api/core';
import { apiPost, type ApiError } from './client';
import { getServerUrl, setAccessToken } from './tokenManager';
import { clearAllUserData } from '../services/storage';
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

    const res = await invoke<AuthProxyResponse>('auth_login_proxy', {
      serverUrl,
      email,
      password,
    });
    const data = handleProxyResponse<LoginResponse>(res);
    if (!data.need2fa && data.token) {
      setAccessToken(data.token);
    }
    return data;
  },

  login2fa: async (
    userId: string,
    token: string,
    code: string,
    type: Login2faType = 'code',
  ): Promise<Login2faResponse> => {
    const serverUrl = getServerUrl();
    if (!serverUrl) throw new Error('Server URL not configured');

    const res = await invoke<AuthProxyResponse>('auth_login_2fa_proxy', {
      serverUrl,
      userId,
      token,
      code,
      loginType: type,
    });
    const data = handleProxyResponse<Login2faResponse>(res);
    if (data.token) {
      setAccessToken(data.token);
    }
    return data;
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

    const res = await invoke<AuthProxyResponse>('auth_email_confirm_proxy', {
      serverUrl,
      userId,
      code,
    });
    const data = handleProxyResponse<EmailConfirmResponse>(res);
    if (data.token) {
      setAccessToken(data.token);
    }
    return data;
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

  logout: async (): Promise<void> => {
    const serverUrl = getServerUrl();
    if (serverUrl) {
      try {
        await invoke('auth_revoke_token', { serverUrl });
      } catch {
        // Ignore revoke errors — we clear locally regardless
      }
    }
    await clearAllUserData({ preserveServerUrl: true });
  },
};

