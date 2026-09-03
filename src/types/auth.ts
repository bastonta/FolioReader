// Identity & Auth types

export interface User {
  userId: string;
  name: string;
  email: string;
  twoFactorEnabled: boolean;
  emailConfirmed: boolean;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  userId: string;
  token: string;
  need2fa: boolean;
}

export interface Login2faRequest {
  userId: string;
  token: string;
  code: string;
  type: Login2faType;
}

export interface Login2faResponse {
  userId: string;
  token: string;
}

export type Login2faType = 'code' | 'recovery';

export interface RegisterRequest {
  name: string;
  email: string;
  password: string;
}

export interface RegisterResponse {
  userId: string;
  resendAfter: number;
}

export interface EmailConfirmRequest {
  userId: string;
  code: string;
}

export interface EmailConfirmResponse {
  token: string;
}

export interface EmailConfirmResendRequest {
  email?: string | null;
  userId?: string | null;
}

export interface EmailConfirmResendResponse {
  userId: string;
  resendAfter: number;
}

export interface PasswordForgotRequest {
  email: string;
}

export interface PasswordForgotResponse {
  email: string;
  resendAfter: number;
}

export interface PasswordResetValidationRequest {
  email: string;
  code: string;
}

export interface PasswordResetValidationResponse {
  email: string;
  token: string;
}

export interface PasswordResetRequest {
  email: string;
  token: string;
  password: string;
}

export interface TokenRefreshResponse {
  token: string;
}

// Profile types

export interface InfoUpdateRequest {
  name: string;
}

export interface PasswordChangeRequest {
  oldPassword: string;
  newPassword: string;
}

export interface EmailChangeRequest {
  newEmail: string;
  password: string;
}

export interface EmailChangeConfirmRequest {
  code: string;
  newEmail: string;
}

export interface EmailChangeResponse {
  resendAfter: number;
}

export interface TfaEnableResponse {
  secret: string;
  url: string;
}

export interface TfaConfirmRequest {
  code: string;
}

export interface TfaConfirmResponse {
  recoveryCodes: string[];
}

export interface TfaDisableRequest {
  password: string;
}

export interface RecoveryCodesRequest {
  code: string;
}

export interface RecoveryCodesResponse {
  recoveryCodes: string[];
}

// Navigation state types (for react-router)

export interface ConfirmEmailState {
  userId: string;
  email: string;
  resendAfter: number;
}


