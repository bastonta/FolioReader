import {
    AlertCircle,
    ArrowLeft,
    Calendar,
    CheckCircle2,
    Copy, Download,
    Info,
    KeyRound,
    LogOut,
    Mail,
    Pencil,
    Server,
    ShieldAlert,
    ShieldCheck,
    X,
    RefreshCw,
    Sparkles,
} from 'lucide-react';
import QRCode from 'qrcode';
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { profileApi } from '../api/profileApi';
import { APP_VERSION, BUILD_TIME, formatBuildTime } from '../constants/buildInfo';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../i18n';
import {
  checkForUpdates,
  UpdateInfo,
  UpdateCheckResult,
} from '../services/updateChecker';
import { UpdateModal } from '../components/common/UpdateModal';
import { openExternalUrl } from '../services/appOpener';

export const ProfilePage: React.FC = () => {
  const { t } = useTranslation();
  const { user, serverUrl, clearServer, logout, refreshUser } = useAuth();
  const navigate = useNavigate();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Name editing
  const [isEditingName, setIsEditingName] = useState(false);
  const [newName, setNewName] = useState(user?.name || '');

  // Password change
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [passwordData, setPasswordData] = useState({ oldPassword: '', newPassword: '', confirmPassword: '' });

  // Email change
  const [showEmailChange, setShowEmailChange] = useState(false);
  const [emailData, setEmailData] = useState({ newEmail: '', currentPassword: '', code: '' });
  const [emailChangeStep, setEmailChangeStep] = useState<1 | 2>(1);

  // 2FA Modals
  const [showEnable2FA, setShowEnable2FA] = useState(false);
  const [twoFaSetupData, setTwoFaSetupData] = useState<{ secret: string, qrCodeUrl: string } | null>(null);
  const [twoFaCode, setTwoFaCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  
  const [showDisable2FA, setShowDisable2FA] = useState(false);
  const [disable2FAPassword, setDisable2FAPassword] = useState('');

  const [showViewRecoveryCodes, setShowViewRecoveryCodes] = useState(false);
  const [viewCodesTotp, setViewCodesTotp] = useState('');

  // Update check states
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [activeUpdateInfo, setActiveUpdateInfo] = useState<UpdateInfo | null>(null);

  const handleCheckUpdates = async () => {
    setIsCheckingUpdate(true);
    setUpdateResult(null);
    try {
      const result = await checkForUpdates({ auto: false });
      setUpdateResult(result);
      if (result.status === 'update-available' && result.updateInfo) {
        setActiveUpdateInfo(result.updateInfo);
      }
    } catch (err: any) {
      setUpdateResult({
        status: 'error',
        error: err?.message || 'Failed to check for updates',
      });
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  useEffect(() => {
    if (user) {
      setNewName(user.name);
    }
  }, [user]);

  const clearMessages = () => {
    setError(null);
    setSuccessMsg(null);
  };

  const handleUpdateName = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || newName === user?.name) {
      setIsEditingName(false);
      return;
    }
    clearMessages();
    setIsLoading(true);
    try {
      await profileApi.updateProfile(newName);
      await refreshUser();
      setSuccessMsg(t('profile.profileUpdated'));
      setIsEditingName(false);
    } catch (err) {
      setError((err as any)?.message || 'Failed to update profile');
    } finally {
      setIsLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMessages();
    if (passwordData.newPassword !== passwordData.confirmPassword) {
      setError(t('auth.passwordsDoNotMatch'));
      return;
    }
    setIsLoading(true);
    try {
      await profileApi.changePassword(
        passwordData.oldPassword,
        passwordData.newPassword
      );
      setSuccessMsg(t('profile.passwordChanged'));
      setShowPasswordChange(false);
      setPasswordData({ oldPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err) {
      setError((err as any)?.message || 'Failed to change password');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRequestEmailChange = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMessages();
    setIsLoading(true);
    try {
      await profileApi.emailChange(
        emailData.newEmail,
        emailData.currentPassword
      );
      setEmailChangeStep(2);
      setSuccessMsg(t('profile.verificationCodeSent'));
    } catch (err) {
      setError((err as any)?.message || 'Failed to request email change');
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmEmailChange = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMessages();
    setIsLoading(true);
    try {
      await profileApi.emailChangeConfirm(
        emailData.newEmail,
        emailData.code
      );
      await refreshUser();
      setSuccessMsg(t('profile.emailChanged'));
      setShowEmailChange(false);
      setEmailChangeStep(1);
      setEmailData({ newEmail: '', currentPassword: '', code: '' });
    } catch (err) {
      setError((err as any)?.message || 'Failed to verify email change');
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartEnable2FA = async () => {
    clearMessages();
    setIsLoading(true);
    try {
      const { secret, url } = await profileApi.enable2fa();
      const qrCodeUrl = await QRCode.toDataURL(url);
      setTwoFaSetupData({ secret, qrCodeUrl });
      setShowEnable2FA(true);
      setTwoFaCode('');
    } catch (err) {
      setError((err as any)?.message || 'Failed to initialize 2FA');
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmEnable2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMessages();
    setIsLoading(true);
    try {
      const { recoveryCodes } = await profileApi.confirm2fa(twoFaCode);
      await refreshUser();
      setRecoveryCodes(recoveryCodes);
      setSuccessMsg(t('profile.twoFactorEnabledSuccess'));
      setTwoFaSetupData(null);
    } catch (err) {
      setError((err as any)?.message || t('auth.invalidCode'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleDisable2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMessages();
    setIsLoading(true);
    try {
      await profileApi.disable2fa(disable2FAPassword);
      await refreshUser();
      setSuccessMsg(t('profile.twoFactorDisabledSuccess'));
      setShowDisable2FA(false);
      setDisable2FAPassword('');
    } catch (err) {
      setError((err as any)?.message || 'Failed to disable 2FA');
    } finally {
      setIsLoading(false);
    }
  };

  const handleViewRecoveryCodes = async (e: React.FormEvent) => {
    e.preventDefault();
    clearMessages();
    setIsLoading(true);
    try {
      const { recoveryCodes } = await profileApi.getRecoveryCodes(viewCodesTotp);
      setRecoveryCodes(recoveryCodes);
    } catch (err) {
      setError((err as any)?.message || t('auth.invalidCode'));
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setSuccessMsg(t('profile.copiedToClipboard'));
    setTimeout(() => setSuccessMsg(null), 3000);
  };

  const downloadRecoveryCodes = () => {
    if (!recoveryCodes) return;
    const text = `Folio Recovery Codes\nSave these in a secure place.\n\n${recoveryCodes.join('\n')}`;
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'folio-recovery-codes.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const getInitial = (name: string) => name ? name.charAt(0).toUpperCase() : '?';

  return (
    <div className="profile-page library-view-container" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden' }}>
      <header className="library-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
          <button
            type="button"
            className="header-pill-btn"
            onClick={() => navigate(-1)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}
          >
            <ArrowLeft size={16} />
            <span>{t('common.back')}</span>
          </button>
          <div className="library-brand" style={{ minWidth: 0 }}>
            <div>
              <h1 className="library-title" style={{ fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {t('profile.accountAndProfile')}
              </h1>
              <p className="library-subtitle">{t('profile.userSettingsAndSecurity')}</p>
            </div>
          </div>
        </div>
      </header>

      <main className="profile-content" style={{ flex: '1 1 0%', minHeight: 0, overflowY: 'auto' }}>
        
        {error && (
          <div className="auth-error">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}
        
        {successMsg && (
          <div className="auth-success">
            <CheckCircle2 size={18} />
            <span>{successMsg}</span>
          </div>
        )}

        {/* User Information */}
        <div className="profile-card">
          <div className="profile-card-title">{t('profile.userInformation')}</div>
          <div className="profile-user-header">
            <div className="profile-avatar">
              {getInitial(user?.name || '')}
            </div>
            <div className="profile-user-info">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {!isEditingName ? (
                  <>
                    <div className="profile-user-name">{user?.name}</div>
                    <button className="profile-btn profile-btn-secondary" style={{ padding: 6 }} onClick={() => setIsEditingName(true)} title={t('profile.editName')}>
                      <Pencil size={14} />
                    </button>
                  </>
                ) : (
                  <form onSubmit={handleUpdateName} className="profile-inline-form" style={{ maxWidth: 400 }}>
                    <input 
                      id="name"
                      name="name"
                      type="text" 
                      className="auth-input" 
                      value={newName} 
                      onChange={e => setNewName(e.target.value)}
                      disabled={isLoading}
                      autoComplete="name"
                      autoFocus
                    />
                    <button type="submit" className="auth-btn-primary" style={{ width: 'auto', padding: '0 16px' }} disabled={isLoading || !newName.trim()}>{t('common.save')}</button>
                    <button type="button" className="auth-btn-secondary" style={{ width: 'auto', padding: '0 16px' }} onClick={() => { setIsEditingName(false); setNewName(user?.name || ''); }}>{t('common.cancel')}</button>
                  </form>
                )}
              </div>
              <div className="profile-user-email">{user?.email}</div>
            </div>
          </div>
          <div className="profile-field-row" style={{ paddingTop: 8, borderBottom: 'none' }}>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <span className={`profile-badge ${user?.twoFactorEnabled ? 'success' : 'warning'}`}>
                {user?.twoFactorEnabled ? <ShieldCheck size={14} /> : <ShieldAlert size={14} />}
                {user?.twoFactorEnabled ? t('profile.twoFactorEnabled') : t('profile.twoFactorDisabled')}
              </span>
              <span className={`profile-badge ${user?.emailConfirmed ? 'success' : 'neutral'}`}>
                <CheckCircle2 size={14} />
                {user?.emailConfirmed ? t('profile.emailConfirmed') : t('profile.emailUnconfirmed')}
              </span>
            </div>
          </div>
        </div>

        {/* Change Password */}
        <div className="profile-card">
          <div className="profile-card-title">
            <KeyRound size={18} />
            <span>{t('profile.changePassword')}</span>
          </div>
          <div>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13.5, margin: '0 0 16px 0', lineHeight: 1.4 }}>
              {t('profile.changePasswordSubtitle')}
            </p>
            <button className="auth-btn-primary" onClick={() => { clearMessages(); setShowPasswordChange(true); }} disabled={isLoading}>
              {t('profile.changePassword')}
            </button>
          </div>
        </div>

        {/* Change Email */}
        <div className="profile-card">
          <div className="profile-card-title">
            <Mail size={18} />
            <span>{t('profile.changeEmail')}</span>
          </div>
          <div>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13.5, margin: '0 0 16px 0', lineHeight: 1.4 }}>
              {t('profile.changeEmailSubtitle')}
            </p>
            <button className="auth-btn-primary" onClick={() => { clearMessages(); setEmailChangeStep(1); setShowEmailChange(true); }} disabled={isLoading}>
              {t('profile.changeEmail')}
            </button>
          </div>
        </div>

        {/* Two-Factor Authentication */}
        <div className="profile-card">
          <div className="profile-card-title">
            <ShieldCheck size={18} />
            <span>{t('profile.twoFactorTitle')}</span>
          </div>
          <div>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13.5, margin: '0 0 16px 0', lineHeight: 1.4 }}>
              {t('profile.twoFactorSubtitle')}
            </p>
            
            {!user?.twoFactorEnabled ? (
              <button className="auth-btn-primary" onClick={handleStartEnable2FA} disabled={isLoading}>{t('profile.enableTwoFactor')}</button>
            ) : (
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <button className="auth-btn-secondary" style={{ width: 'auto' }} onClick={() => { clearMessages(); setShowViewRecoveryCodes(true); }}>{t('profile.viewRecoveryCodes')}</button>
                <button className="auth-btn-text" style={{ color: 'var(--danger-color)' }} onClick={() => { clearMessages(); setShowDisable2FA(true); }}>{t('profile.disableTwoFactor')}</button>
              </div>
            )}
          </div>
        </div>

        {/* Server & Session */}
        <div className="profile-card">
          <div className="profile-card-title">
            <Server size={18} />
            <span>{t('profile.serverAndSession')}</span>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, padding: '12px 16px', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 10 }}>
              <Server size={16} color="var(--text-muted)" />
              <span style={{ fontSize: 13.5, color: 'var(--text-secondary)' }}>{t('profile.connectedTo')}:</span>
              <strong style={{ fontSize: 13.5, color: 'var(--text-primary)' }}>{serverUrl}</strong>
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button className="auth-btn-secondary" style={{ flex: 1 }} onClick={() => { clearServer(); navigate('/server', { replace: true }); }}>{t('profile.changeServer')}</button>
              <button className="auth-btn-secondary" style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }} onClick={() => { logout(); navigate('/login', { replace: true }); }}>
                <LogOut size={16} /> {t('profile.signOut')}
              </button>
            </div>
          </div>
        </div>

        {/* About & Version Information */}
        <div className="profile-card">
          <div className="profile-card-title">
            <Info size={18} />
            <span>{t('profile.aboutFolio')}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ fontSize: 13.5, color: 'var(--text-secondary)' }}>{t('profile.version')}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, fontFamily: 'monospace', color: 'var(--text-primary)' }}>
                  v{APP_VERSION}
                </span>
                <button
                  type="button"
                  className="settings-action-btn"
                  onClick={handleCheckUpdates}
                  disabled={isCheckingUpdate}
                  title={t('update.checkForUpdates')}
                >
                  <RefreshCw
                    size={12}
                    style={{
                      animation: isCheckingUpdate ? 'spin 1s linear infinite' : 'none',
                    }}
                  />
                  <span>{isCheckingUpdate ? t('update.checking') : t('update.checkForUpdates')}</span>
                </button>
              </div>
            </div>

            {updateResult && (
              <div
                style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  fontSize: 12,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  backgroundColor:
                    updateResult.status === 'update-available'
                      ? 'rgba(59, 130, 246, 0.12)'
                      : updateResult.status === 'error'
                      ? 'rgba(239, 68, 68, 0.12)'
                      : 'var(--bg-secondary)',
                  border: `1px solid ${
                    updateResult.status === 'update-available'
                      ? 'rgba(59, 130, 246, 0.3)'
                      : updateResult.status === 'error'
                      ? 'rgba(239, 68, 68, 0.3)'
                      : 'var(--border-color)'
                  }`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {updateResult.status === 'update-available' && (
                    <Sparkles size={14} style={{ color: 'var(--accent-color)', flexShrink: 0 }} />
                  )}
                  {updateResult.status === 'up-to-date' && (
                    <CheckCircle2 size={14} style={{ color: '#16a34a', flexShrink: 0 }} />
                  )}
                  {updateResult.status === 'dev-build' && (
                    <CheckCircle2 size={14} style={{ color: '#ca8a04', flexShrink: 0 }} />
                  )}
                  {updateResult.status === 'error' && (
                    <AlertCircle size={14} style={{ color: '#ef4444', flexShrink: 0 }} />
                  )}
                  <span>
                    {updateResult.status === 'update-available' &&
                      `${t('update.title')}: v${updateResult.updateInfo?.latestVersion}`}
                    {updateResult.status === 'up-to-date' &&
                      t('update.upToDate', { version: APP_VERSION })}
                    {updateResult.status === 'dev-build' &&
                      t('update.devBuild', { version: APP_VERSION })}
                    {updateResult.status === 'no-releases' && t('update.noReleasesFound')}
                    {updateResult.status === 'error' &&
                      (updateResult.error || t('update.checkFailed'))}
                  </span>
                </div>
                {updateResult.status === 'update-available' && updateResult.updateInfo && (
                  <button
                    type="button"
                    className="settings-action-btn-primary"
                    onClick={() => setActiveUpdateInfo(updateResult.updateInfo!)}
                  >
                    {t('update.viewUpdate')}
                  </button>
                )}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ fontSize: 13.5, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Calendar size={14} />
                <span>{t('profile.buildDate')}</span>
              </span>
              <span style={{ fontSize: 13.5, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                {formatBuildTime(BUILD_TIME)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0' }}>
              <span style={{ fontSize: 13.5, color: 'var(--text-secondary)' }}>{t('profile.source')}</span>
              <a
                href="https://github.com/bastonta/FolioApp"
                target="_blank"
                rel="noreferrer"
                onClick={(e) => {
                  e.preventDefault();
                  openExternalUrl('https://github.com/bastonta/FolioApp');
                }}
                style={{ fontSize: 13.5, color: 'var(--accent-color)', textDecoration: 'none', cursor: 'pointer' }}
              >
                {t('profile.githubRepository')}
              </a>
            </div>
          </div>
        </div>


      </main>

      {/* Change Password Modal */}
      {showPasswordChange && (
        <div className="modal-backdrop" onClick={() => { setShowPasswordChange(false); setPasswordData({ oldPassword: '', newPassword: '', confirmPassword: '' }); }}>
          <div className="modal-container" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{t('profile.changePassword')}</span>
              <button className="modal-close-btn" onClick={() => { setShowPasswordChange(false); setPasswordData({ oldPassword: '', newPassword: '', confirmPassword: '' }); }}><X size={16} /></button>
            </div>
            <form onSubmit={handleChangePassword} autoComplete="off">
              <div className="modal-body">
                {error && (
                  <div className="auth-error" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <AlertCircle size={16} style={{ flexShrink: 0 }} />
                    <span>{error}</span>
                  </div>
                )}
                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--text-muted)' }}>{t('profile.currentPassword')}</label>
                  <input
                    id="oldPassword"
                    name="current-password"
                    type="password"
                    required
                    className="auth-input"
                    style={{ paddingLeft: 12 }}
                    value={passwordData.oldPassword}
                    onChange={e => setPasswordData({ ...passwordData, oldPassword: e.target.value })}
                    disabled={isLoading}
                    autoComplete="current-password"
                    autoFocus
                  />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--text-muted)' }}>{t('profile.newPassword')}</label>
                  <input
                    id="newPassword"
                    name="new-password"
                    type="password"
                    required
                    className="auth-input"
                    style={{ paddingLeft: 12 }}
                    value={passwordData.newPassword}
                    onChange={e => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                    disabled={isLoading}
                    autoComplete="new-password"
                  />
                </div>
                <div style={{ marginBottom: 8 }}>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--text-muted)' }}>{t('profile.confirmNewPassword')}</label>
                  <input
                    id="confirmPassword"
                    name="confirm-password"
                    type="password"
                    required
                    className="auth-input"
                    style={{ paddingLeft: 12 }}
                    value={passwordData.confirmPassword}
                    onChange={e => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                    disabled={isLoading}
                    autoComplete="new-password"
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="auth-btn-text" onClick={() => { setShowPasswordChange(false); setPasswordData({ oldPassword: '', newPassword: '', confirmPassword: '' }); }}>{t('common.cancel')}</button>
                <button type="submit" className="auth-btn-primary" disabled={isLoading || !passwordData.oldPassword || !passwordData.newPassword || !passwordData.confirmPassword}>{t('profile.changePassword')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Change Email Modal */}
      {showEmailChange && (
        <div className="modal-backdrop" onClick={() => { setShowEmailChange(false); setEmailChangeStep(1); setEmailData({ newEmail: '', currentPassword: '', code: '' }); }}>
          <div className="modal-container" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{t('profile.changeEmail')}</span>
              <button className="modal-close-btn" onClick={() => { setShowEmailChange(false); setEmailChangeStep(1); setEmailData({ newEmail: '', currentPassword: '', code: '' }); }}><X size={16} /></button>
            </div>
            {emailChangeStep === 1 ? (
              <form onSubmit={handleRequestEmailChange} autoComplete="off">
                <div className="modal-body">
                  {error && (
                    <div className="auth-error" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <AlertCircle size={16} style={{ flexShrink: 0 }} />
                      <span>{error}</span>
                    </div>
                  )}
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--text-muted)' }}>{t('profile.newEmailAddress')}</label>
                    <input
                      id="newEmail"
                      name="email"
                      type="email"
                      required
                      className="auth-input"
                      style={{ paddingLeft: 12 }}
                      value={emailData.newEmail}
                      onChange={e => setEmailData({ ...emailData, newEmail: e.target.value })}
                      disabled={isLoading}
                      autoComplete="email"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      autoFocus
                    />
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--text-muted)' }}>{t('profile.currentPassword')}</label>
                    <input
                      id="emailChangePassword"
                      name="password"
                      type="password"
                      required
                      className="auth-input"
                      style={{ paddingLeft: 12 }}
                      value={emailData.currentPassword}
                      onChange={e => setEmailData({ ...emailData, currentPassword: e.target.value })}
                      disabled={isLoading}
                      autoComplete="current-password"
                    />
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="auth-btn-text" onClick={() => { setShowEmailChange(false); setEmailChangeStep(1); setEmailData({ newEmail: '', currentPassword: '', code: '' }); }}>{t('common.cancel')}</button>
                  <button type="submit" className="auth-btn-primary" disabled={isLoading || !emailData.newEmail || !emailData.currentPassword}>{t('profile.sendVerificationCode')}</button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleConfirmEmailChange} autoComplete="off">
                <div className="modal-body">
                  {error && (
                    <div className="auth-error" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <AlertCircle size={16} style={{ flexShrink: 0 }} />
                      <span>{error}</span>
                    </div>
                  )}
                  <div className="auth-info" style={{ marginBottom: 16, fontSize: 13 }}>
                    {t('auth.codeSentTo')} <strong>{emailData.newEmail}</strong>.
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--text-muted)' }}>{t('auth.confirmationCodeLabel')}</label>
                    <input
                      id="emailVerificationCode"
                      name="code"
                      type="text"
                      inputMode="numeric"
                      required
                      className="auth-input auth-input-code"
                      style={{ letterSpacing: 4, textAlign: 'center', fontSize: 18 }}
                      value={emailData.code}
                      onChange={e => setEmailData({ ...emailData, code: e.target.value })}
                      disabled={isLoading}
                      autoComplete="one-time-code"
                      maxLength={6}
                      autoFocus
                    />
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="auth-btn-text" onClick={() => setEmailChangeStep(1)}>{t('common.back')}</button>
                  <button type="button" className="auth-btn-text" onClick={() => { setShowEmailChange(false); setEmailChangeStep(1); setEmailData({ newEmail: '', currentPassword: '', code: '' }); }}>{t('common.cancel')}</button>
                  <button type="submit" className="auth-btn-primary" disabled={isLoading || emailData.code.length < 6}>{t('profile.confirmEmailChange')}</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Enable 2FA Modal */}
      {showEnable2FA && twoFaSetupData && !recoveryCodes && (
        <div className="modal-backdrop" onClick={() => setShowEnable2FA(false)}>
          <div className="modal-container" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{t('profile.setUpTwoFactor')}</span>
              <button className="modal-close-btn" onClick={() => setShowEnable2FA(false)}><X size={16} /></button>
            </div>
            <form onSubmit={handleConfirmEnable2FA} autoComplete="off">
              <div className="modal-body">
                {error && (
                  <div className="auth-error" style={{ marginBottom: 16 }}>
                    <AlertCircle size={16} style={{ flexShrink: 0 }} />
                    <span>{error}</span>
                  </div>
                )}
                <ol style={{ paddingLeft: 20, margin: 0, fontSize: 14, color: 'var(--text-primary)' }}>
                  <li style={{ marginBottom: 12 }}>{t('profile.scanQrCode')}</li>
                </ol>
                <div style={{ display: 'flex', justifyContent: 'center', margin: '16px 0', padding: 16, backgroundColor: '#ffffff', borderRadius: 10 }}>
                  <img src={twoFaSetupData.qrCodeUrl} alt="2FA QR Code" width={200} height={200} />
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', marginBottom: 16 }}>
                  {t('profile.orEnterManualCode')}<br/>
                  <code style={{ fontSize: 15, fontWeight: 'bold', display: 'inline-block', marginTop: 8, padding: '6px 12px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 6, letterSpacing: '0.05em' }}>
                    {twoFaSetupData.secret}
                  </code>
                </div>
                <div style={{ marginBottom: 8 }}>
                  <label className="auth-label" style={{ display: 'block', marginBottom: 6 }}>{t('profile.enterAppCode')}</label>
                  <input
                    id="enable2FaCode"
                    name="code"
                    type="text"
                    inputMode="numeric"
                    required
                    className="auth-input auth-input-code"
                    value={twoFaCode}
                    onChange={e => setTwoFaCode(e.target.value)}
                    disabled={isLoading}
                    autoComplete="one-time-code"
                    maxLength={6}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="auth-btn-text" onClick={() => setShowEnable2FA(false)}>{t('common.cancel')}</button>
                <button type="submit" className="auth-btn-primary" disabled={isLoading || twoFaCode.length < 6}>{t('profile.verifyAndEnable')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Recovery Codes Modal (after enable or view) */}
      {recoveryCodes && (
        <div className="modal-backdrop" onClick={() => { setRecoveryCodes(null); setShowViewRecoveryCodes(false); }}>
          <div className="modal-container" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{t('profile.recoveryCodesTitle')}</span>
              <button className="modal-close-btn" onClick={() => { setRecoveryCodes(null); setShowViewRecoveryCodes(false); }}><X size={16} /></button>
            </div>
            <div className="modal-body">
              <div className="auth-error" style={{ backgroundColor: 'var(--warning-bg)', color: 'var(--warning-fg)', borderColor: 'rgba(245, 158, 11, 0.3)', marginBottom: 16, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <AlertCircle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                <span style={{ fontSize: 13 }}>{t('profile.saveRecoveryCodesWarning')}</span>
              </div>
              <div className="recovery-codes-grid" style={{ marginBottom: 16 }}>
                {recoveryCodes.map((code, i) => (
                  <div key={i} className="recovery-code-item">
                    {code}
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                <button className="auth-btn-secondary" style={{ width: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }} onClick={() => copyToClipboard(recoveryCodes.join('\n'))}>
                  <Copy size={14} /> {t('profile.copy')}
                </button>
                <button className="auth-btn-secondary" style={{ width: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }} onClick={downloadRecoveryCodes}>
                  <Download size={14} /> {t('profile.download')}
                </button>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="auth-btn-primary" onClick={() => { setRecoveryCodes(null); setShowViewRecoveryCodes(false); }}>{t('profile.savedThem')}</button>
            </div>
          </div>
        </div>
      )}

      {/* View Recovery Codes Modal (auth requirement) */}
      {showViewRecoveryCodes && !recoveryCodes && (
        <div className="modal-backdrop" onClick={() => setShowViewRecoveryCodes(false)}>
          <div className="modal-container" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{t('profile.viewRecoveryCodes')}</span>
              <button className="modal-close-btn" onClick={() => setShowViewRecoveryCodes(false)}><X size={16} /></button>
            </div>
            <form onSubmit={handleViewRecoveryCodes} autoComplete="off">
              <div className="modal-body">
                {error && (
                  <div className="auth-error" style={{ marginBottom: 16 }}>
                    <AlertCircle size={16} style={{ flexShrink: 0 }} />
                    <span>{error}</span>
                  </div>
                )}
                <p style={{ fontSize: 14, color: 'var(--text-primary)', marginBottom: 16, lineHeight: 1.4 }}>
                  {t('profile.viewRecoveryCodesDesc')}
                </p>
                <div style={{ marginBottom: 8 }}>
                  <label className="auth-label" style={{ display: 'block', marginBottom: 6 }}>{t('profile.authenticatorCodeLabel')}</label>
                  <input
                    id="viewCodesTotp"
                    name="code"
                    type="text"
                    inputMode="numeric"
                    required
                    className="auth-input auth-input-code"
                    value={viewCodesTotp}
                    onChange={e => setViewCodesTotp(e.target.value)}
                    disabled={isLoading}
                    autoComplete="one-time-code"
                    maxLength={6}
                    autoFocus
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="auth-btn-text" onClick={() => setShowViewRecoveryCodes(false)}>{t('common.cancel')}</button>
                <button type="submit" className="auth-btn-primary" disabled={isLoading || viewCodesTotp.length < 6}>{t('profile.verify')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Disable 2FA Modal */}
      {showDisable2FA && (
        <div className="modal-backdrop" onClick={() => setShowDisable2FA(false)}>
          <div className="modal-container" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">{t('profile.disableTwoFactor')}</span>
              <button className="modal-close-btn" onClick={() => setShowDisable2FA(false)}><X size={16} /></button>
            </div>
            <form onSubmit={handleDisable2FA} autoComplete="off">
              <div className="modal-body">
                {error && (
                  <div className="auth-error" style={{ marginBottom: 16 }}>
                    <AlertCircle size={16} style={{ flexShrink: 0 }} />
                    <span>{error}</span>
                  </div>
                )}
                <p style={{ fontSize: 14, color: 'var(--text-primary)', marginBottom: 16, lineHeight: 1.4 }}>
                  {t('profile.disableTwoFactorDesc')}
                </p>
                <div style={{ marginBottom: 8 }}>
                  <label className="auth-label" style={{ display: 'block', marginBottom: 6 }}>{t('profile.enterPasswordToConfirm')}</label>
                  <input
                    id="disable2FAPassword"
                    name="password"
                    type="password"
                    required
                    className="auth-input"
                    style={{ paddingLeft: 12 }}
                    value={disable2FAPassword}
                    onChange={e => setDisable2FAPassword(e.target.value)}
                    disabled={isLoading}
                    autoComplete="current-password"
                    autoFocus
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="auth-btn-text" onClick={() => setShowDisable2FA(false)}>{t('common.cancel')}</button>
                <button type="submit" className="auth-btn-danger" disabled={isLoading || !disable2FAPassword}>{t('profile.disableTwoFactorBtn')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Update Modal */}
      {activeUpdateInfo && (
        <UpdateModal
          isOpen={Boolean(activeUpdateInfo)}
          onClose={() => setActiveUpdateInfo(null)}
          updateInfo={activeUpdateInfo}
        />
      )}

    </div>
  );
};
