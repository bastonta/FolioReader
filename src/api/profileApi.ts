import { apiGet, apiPost, apiPut } from './client';
import type {
  User,
  EmailChangeResponse,
  TfaEnableResponse,
  TfaConfirmResponse,
  RecoveryCodesResponse,
} from '../types/auth';

export const profileApi = {
  getProfile: async (): Promise<User> => {
    return apiGet<User>('/profile/info');
  },

  updateProfile: async (name: string): Promise<void> => {
    await apiPut('/profile/info', { name });
  },

  changePassword: async (
    oldPassword: string,
    newPassword: string,
  ): Promise<void> => {
    await apiPost('/profile/password-change', { oldPassword, newPassword });
  },

  emailChange: async (
    newEmail: string,
    password: string,
  ): Promise<EmailChangeResponse> => {
    return apiPost<EmailChangeResponse>('/profile/email-change', {
      newEmail,
      password,
    });
  },

  emailChangeConfirm: async (
    newEmail: string,
    code: string,
  ): Promise<void> => {
    await apiPost('/profile/email-change-confirm', { newEmail, code });
  },

  enable2fa: async (): Promise<TfaEnableResponse> => {
    return apiPost<TfaEnableResponse>('/profile/2fa-enable');
  },

  confirm2fa: async (code: string): Promise<TfaConfirmResponse> => {
    return apiPost<TfaConfirmResponse>('/profile/2fa-confirm', { code });
  },

  disable2fa: async (password: string): Promise<void> => {
    await apiPost('/profile/2fa-disable', { password });
  },

  getRecoveryCodes: async (code: string): Promise<RecoveryCodesResponse> => {
    return apiPost<RecoveryCodesResponse>('/profile/recovery-codes', { code });
  },
};
