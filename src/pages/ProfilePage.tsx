import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { profileApi } from '../api/profileApi';
import QRCode from 'qrcode';
import {
  ArrowLeft, ShieldCheck, ShieldAlert, Copy, Download,
  KeyRound, AlertCircle, CheckCircle2, X, Mail, Server,
  LogOut, Pencil, Info, Calendar
} from 'lucide-react';
import { APP_VERSION, BUILD_TIME, formatBuildTime } from '../constants/buildInfo';


export const ProfilePage: React.FC = () => {
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
      setSuccessMsg('Profile updated successfully');
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
      setError('New passwords do not match');
      return;
    }
    setIsLoading(true);
    try {
      await profileApi.changePassword(
        passwordData.oldPassword,
        passwordData.newPassword
      );
      setSuccessMsg('Password changed successfully');
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
      setSuccessMsg('Verification code sent to new email');
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
      setSuccessMsg('Email changed successfully');
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
      setSuccessMsg('Two-factor authentication enabled successfully');
      setTwoFaSetupData(null);
    } catch (err) {
      setError((err as any)?.message || 'Invalid code');
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
      setSuccessMsg('Two-factor authentication disabled');
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
      setError((err as any)?.message || 'Invalid code');
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setSuccessMsg('Copied to clipboard');
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
            <span>Back</span>
          </button>
          <div className="library-brand" style={{ minWidth: 0 }}>
            <div>
              <h1 className="library-title" style={{ fontSize: 16, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Account & Profile
              </h1>
              <p className="library-subtitle">User Settings & Security</p>
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
          <div className="profile-card-title">User Information</div>
          <div className="profile-user-header">
            <div className="profile-avatar">
              {getInitial(user?.name || '')}
            </div>
            <div className="profile-user-info">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {!isEditingName ? (
                  <>
                    <div className="profile-user-name">{user?.name}</div>
                    <button className="profile-btn profile-btn-secondary" style={{ padding: 6 }} onClick={() => setIsEditingName(true)} title="Edit Name">
                      <Pencil size={14} />
                    </button>
                  </>
                ) : (
                  <form onSubmit={handleUpdateName} className="profile-inline-form" style={{ maxWidth: 400 }}>
                    <input 
                      type="text" 
                      className="auth-input" 
                      value={newName} 
                      onChange={e => setNewName(e.target.value)}
                      disabled={isLoading}
                      autoFocus
                    />
                    <button type="submit" className="auth-btn-primary" style={{ width: 'auto', padding: '0 16px' }} disabled={isLoading || !newName.trim()}>Save</button>
                    <button type="button" className="auth-btn-secondary" style={{ width: 'auto', padding: '0 16px' }} onClick={() => { setIsEditingName(false); setNewName(user?.name || ''); }}>Cancel</button>
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
                2FA {user?.twoFactorEnabled ? 'Enabled' : 'Disabled'}
              </span>
              <span className={`profile-badge ${user?.emailConfirmed ? 'success' : 'neutral'}`}>
                <CheckCircle2 size={14} />
                Email {user?.emailConfirmed ? 'Confirmed' : 'Unconfirmed'}
              </span>
            </div>
          </div>
        </div>

        {/* Change Password */}
        <div className="profile-card">
          <div className="profile-card-title">
            <KeyRound size={18} />
            <span>Change Password</span>
          </div>
          <div>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13.5, margin: '0 0 16px 0', lineHeight: 1.4 }}>
              Ensure your account is using a long, random password to stay secure.
            </p>
            <button className="auth-btn-primary" style={{ maxWidth: 200 }} onClick={() => { clearMessages(); setShowPasswordChange(true); }} disabled={isLoading}>
              Change Password
            </button>
          </div>
        </div>

        {/* Change Email */}
        <div className="profile-card">
          <div className="profile-card-title">
            <Mail size={18} />
            <span>Change Email</span>
          </div>
          <div>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13.5, margin: '0 0 16px 0', lineHeight: 1.4 }}>
              Update the email address associated with your account. A verification code will be sent to confirm.
            </p>
            <button className="auth-btn-primary" style={{ maxWidth: 200 }} onClick={() => { clearMessages(); setEmailChangeStep(1); setShowEmailChange(true); }} disabled={isLoading}>
              Change Email
            </button>
          </div>
        </div>

        {/* Two-Factor Authentication */}
        <div className="profile-card">
          <div className="profile-card-title">
            <ShieldCheck size={18} />
            <span>Two-Factor Authentication (2FA)</span>
          </div>
          <div>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13.5, margin: '0 0 16px 0', lineHeight: 1.4 }}>
              Add an extra layer of security to your account by requiring a code from your authenticator app when you sign in.
            </p>
            
            {!user?.twoFactorEnabled ? (
              <button className="auth-btn-primary" style={{ maxWidth: 200 }} onClick={handleStartEnable2FA} disabled={isLoading}>Enable 2FA</button>
            ) : (
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <button className="auth-btn-secondary" style={{ width: 'auto' }} onClick={() => { clearMessages(); setShowViewRecoveryCodes(true); }}>View Recovery Codes</button>
                <button className="auth-btn-text" style={{ color: 'var(--danger-color)' }} onClick={() => { clearMessages(); setShowDisable2FA(true); }}>Disable 2FA</button>
              </div>
            )}
          </div>
        </div>

        {/* Server & Session */}
        <div className="profile-card">
          <div className="profile-card-title">
            <Server size={18} />
            <span>Server & Session</span>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, padding: '12px 16px', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 10 }}>
              <Server size={16} color="var(--text-muted)" />
              <span style={{ fontSize: 13.5, color: 'var(--text-secondary)' }}>Connected to:</span>
              <strong style={{ fontSize: 13.5, color: 'var(--text-primary)' }}>{serverUrl}</strong>
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button className="auth-btn-secondary" style={{ width: 'auto' }} onClick={() => { clearServer(); navigate('/server', { replace: true }); }}>Change Server</button>
              <button className="auth-btn-secondary" style={{ width: 'auto', display: 'flex', alignItems: 'center', gap: 8 }} onClick={() => { logout(); navigate('/login', { replace: true }); }}>
                <LogOut size={16} /> Sign Out
              </button>
            </div>
          </div>
        </div>

        {/* About & Version Information */}
        <div className="profile-card">
          <div className="profile-card-title">
            <Info size={18} />
            <span>About Folio</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ fontSize: 13.5, color: 'var(--text-secondary)' }}>Version</span>
              <span style={{ fontSize: 13.5, fontWeight: 600, fontFamily: 'monospace', color: 'var(--text-primary)' }}>
                v{APP_VERSION}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
              <span style={{ fontSize: 13.5, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Calendar size={14} />
                <span>Build Date</span>
              </span>
              <span style={{ fontSize: 13.5, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
                {formatBuildTime(BUILD_TIME)}
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0' }}>
              <span style={{ fontSize: 13.5, color: 'var(--text-secondary)' }}>Source</span>
              <a
                href="https://github.com/bastonta/FolioApp"
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: 13.5, color: 'var(--accent-color)', textDecoration: 'none' }}
              >
                GitHub Repository
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
              <span className="modal-title">Change Password</span>
              <button className="modal-close-btn" onClick={() => { setShowPasswordChange(false); setPasswordData({ oldPassword: '', newPassword: '', confirmPassword: '' }); }}><X size={16} /></button>
            </div>
            <form onSubmit={handleChangePassword}>
              <div className="modal-body">
                {error && (
                  <div className="auth-error" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <AlertCircle size={16} style={{ flexShrink: 0 }} />
                    <span>{error}</span>
                  </div>
                )}
                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--text-muted)' }}>Current Password</label>
                  <input
                    type="password"
                    required
                    className="auth-input"
                    style={{ paddingLeft: 12 }}
                    value={passwordData.oldPassword}
                    onChange={e => setPasswordData({ ...passwordData, oldPassword: e.target.value })}
                    disabled={isLoading}
                    autoFocus
                  />
                </div>
                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--text-muted)' }}>New Password</label>
                  <input
                    type="password"
                    required
                    className="auth-input"
                    style={{ paddingLeft: 12 }}
                    value={passwordData.newPassword}
                    onChange={e => setPasswordData({ ...passwordData, newPassword: e.target.value })}
                    disabled={isLoading}
                  />
                </div>
                <div style={{ marginBottom: 8 }}>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--text-muted)' }}>Confirm New Password</label>
                  <input
                    type="password"
                    required
                    className="auth-input"
                    style={{ paddingLeft: 12 }}
                    value={passwordData.confirmPassword}
                    onChange={e => setPasswordData({ ...passwordData, confirmPassword: e.target.value })}
                    disabled={isLoading}
                  />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="auth-btn-text" onClick={() => { setShowPasswordChange(false); setPasswordData({ oldPassword: '', newPassword: '', confirmPassword: '' }); }}>Cancel</button>
                <button type="submit" className="auth-btn-primary" disabled={isLoading || !passwordData.oldPassword || !passwordData.newPassword || !passwordData.confirmPassword}>Change Password</button>
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
              <span className="modal-title">Change Email</span>
              <button className="modal-close-btn" onClick={() => { setShowEmailChange(false); setEmailChangeStep(1); setEmailData({ newEmail: '', currentPassword: '', code: '' }); }}><X size={16} /></button>
            </div>
            {emailChangeStep === 1 ? (
              <form onSubmit={handleRequestEmailChange}>
                <div className="modal-body">
                  {error && (
                    <div className="auth-error" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <AlertCircle size={16} style={{ flexShrink: 0 }} />
                      <span>{error}</span>
                    </div>
                  )}
                  <div style={{ marginBottom: 12 }}>
                    <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--text-muted)' }}>New Email Address</label>
                    <input
                      type="email"
                      required
                      className="auth-input"
                      style={{ paddingLeft: 12 }}
                      value={emailData.newEmail}
                      onChange={e => setEmailData({ ...emailData, newEmail: e.target.value })}
                      disabled={isLoading}
                      autoFocus
                    />
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--text-muted)' }}>Current Password</label>
                    <input
                      type="password"
                      required
                      className="auth-input"
                      style={{ paddingLeft: 12 }}
                      value={emailData.currentPassword}
                      onChange={e => setEmailData({ ...emailData, currentPassword: e.target.value })}
                      disabled={isLoading}
                    />
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="auth-btn-text" onClick={() => { setShowEmailChange(false); setEmailChangeStep(1); setEmailData({ newEmail: '', currentPassword: '', code: '' }); }}>Cancel</button>
                  <button type="submit" className="auth-btn-primary" disabled={isLoading || !emailData.newEmail || !emailData.currentPassword}>Send Verification Code</button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleConfirmEmailChange}>
                <div className="modal-body">
                  {error && (
                    <div className="auth-error" style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <AlertCircle size={16} style={{ flexShrink: 0 }} />
                      <span>{error}</span>
                    </div>
                  )}
                  <div className="auth-info" style={{ marginBottom: 16, fontSize: 13 }}>
                    A verification code has been sent to <strong>{emailData.newEmail}</strong>.
                  </div>
                  <div style={{ marginBottom: 8 }}>
                    <label style={{ display: 'block', marginBottom: 4, fontSize: 13, color: 'var(--text-muted)' }}>Verification Code</label>
                    <input
                      type="text"
                      required
                      className="auth-input auth-input-code"
                      style={{ letterSpacing: 4, textAlign: 'center', fontSize: 18 }}
                      value={emailData.code}
                      onChange={e => setEmailData({ ...emailData, code: e.target.value })}
                      disabled={isLoading}
                      maxLength={6}
                      autoFocus
                    />
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="auth-btn-text" onClick={() => setEmailChangeStep(1)}>Back</button>
                  <button type="button" className="auth-btn-text" onClick={() => { setShowEmailChange(false); setEmailChangeStep(1); setEmailData({ newEmail: '', currentPassword: '', code: '' }); }}>Cancel</button>
                  <button type="submit" className="auth-btn-primary" disabled={isLoading || emailData.code.length < 6}>Confirm Email Change</button>
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
              <span className="modal-title">Set up Two-Factor Authentication</span>
              <button className="modal-close-btn" onClick={() => setShowEnable2FA(false)}><X size={16} /></button>
            </div>
            <form onSubmit={handleConfirmEnable2FA}>
              <div className="modal-body">
                {error && (
                  <div className="auth-error" style={{ marginBottom: 16 }}>
                    <AlertCircle size={16} style={{ flexShrink: 0 }} />
                    <span>{error}</span>
                  </div>
                )}
                <ol style={{ paddingLeft: 20, margin: 0, fontSize: 14, color: 'var(--text-primary)' }}>
                  <li style={{ marginBottom: 12 }}>Scan this QR code with your authenticator app (like Authy or Google Authenticator).</li>
                </ol>
                <div style={{ display: 'flex', justifyContent: 'center', margin: '16px 0', padding: 16, backgroundColor: '#ffffff', borderRadius: 10 }}>
                  <img src={twoFaSetupData.qrCodeUrl} alt="2FA QR Code" width={200} height={200} />
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', marginBottom: 16 }}>
                  Or enter this code manually:<br/>
                  <code style={{ fontSize: 15, fontWeight: 'bold', display: 'inline-block', marginTop: 8, padding: '6px 12px', backgroundColor: 'var(--bg-tertiary)', borderRadius: 6, letterSpacing: '0.05em' }}>
                    {twoFaSetupData.secret}
                  </code>
                </div>
                <div style={{ marginBottom: 8 }}>
                  <label className="auth-label" style={{ display: 'block', marginBottom: 6 }}>Enter the 6-digit code from your app</label>
                  <input type="text" required className="auth-input auth-input-code" value={twoFaCode} onChange={e => setTwoFaCode(e.target.value)} disabled={isLoading} maxLength={6} />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="auth-btn-text" onClick={() => setShowEnable2FA(false)}>Cancel</button>
                <button type="submit" className="auth-btn-primary" disabled={isLoading || twoFaCode.length < 6}>Verify & Enable</button>
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
              <span className="modal-title">Recovery Codes</span>
              <button className="modal-close-btn" onClick={() => { setRecoveryCodes(null); setShowViewRecoveryCodes(false); }}><X size={16} /></button>
            </div>
            <div className="modal-body">
              <div className="auth-error" style={{ backgroundColor: 'var(--warning-bg)', color: 'var(--warning-fg)', borderColor: 'rgba(245, 158, 11, 0.3)', marginBottom: 16, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <AlertCircle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                <span style={{ fontSize: 13 }}>Save these recovery codes in a secure place. This is the <strong>only time</strong> they will be shown. You can use them to sign in if you lose access to your authenticator app.</span>
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
                  <Copy size={14} /> Copy
                </button>
                <button className="auth-btn-secondary" style={{ width: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }} onClick={downloadRecoveryCodes}>
                  <Download size={14} /> Download
                </button>
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="auth-btn-primary" onClick={() => { setRecoveryCodes(null); setShowViewRecoveryCodes(false); }}>I have saved them</button>
            </div>
          </div>
        </div>
      )}

      {/* View Recovery Codes Modal (auth requirement) */}
      {showViewRecoveryCodes && !recoveryCodes && (
        <div className="modal-backdrop" onClick={() => setShowViewRecoveryCodes(false)}>
          <div className="modal-container" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">View Recovery Codes</span>
              <button className="modal-close-btn" onClick={() => setShowViewRecoveryCodes(false)}><X size={16} /></button>
            </div>
            <form onSubmit={handleViewRecoveryCodes}>
              <div className="modal-body">
                {error && (
                  <div className="auth-error" style={{ marginBottom: 16 }}>
                    <AlertCircle size={16} style={{ flexShrink: 0 }} />
                    <span>{error}</span>
                  </div>
                )}
                <p style={{ fontSize: 14, color: 'var(--text-primary)', marginBottom: 16, lineHeight: 1.4 }}>
                  To view or generate new recovery codes, please enter a code from your authenticator app. Note: Generating new codes will invalidate any old ones.
                </p>
                <div style={{ marginBottom: 8 }}>
                  <label className="auth-label" style={{ display: 'block', marginBottom: 6 }}>Authenticator Code</label>
                  <input type="text" required className="auth-input auth-input-code" value={viewCodesTotp} onChange={e => setViewCodesTotp(e.target.value)} disabled={isLoading} maxLength={6} autoFocus />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="auth-btn-text" onClick={() => setShowViewRecoveryCodes(false)}>Cancel</button>
                <button type="submit" className="auth-btn-primary" disabled={isLoading || viewCodesTotp.length < 6}>Verify</button>
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
              <span className="modal-title">Disable Two-Factor Authentication</span>
              <button className="modal-close-btn" onClick={() => setShowDisable2FA(false)}><X size={16} /></button>
            </div>
            <form onSubmit={handleDisable2FA}>
              <div className="modal-body">
                {error && (
                  <div className="auth-error" style={{ marginBottom: 16 }}>
                    <AlertCircle size={16} style={{ flexShrink: 0 }} />
                    <span>{error}</span>
                  </div>
                )}
                <p style={{ fontSize: 14, color: 'var(--text-primary)', marginBottom: 16, lineHeight: 1.4 }}>
                  Are you sure you want to disable two-factor authentication? This will make your account less secure.
                </p>
                <div style={{ marginBottom: 8 }}>
                  <label className="auth-label" style={{ display: 'block', marginBottom: 6 }}>Enter Password to Confirm</label>
                  <input type="password" required className="auth-input" style={{ paddingLeft: 12 }} value={disable2FAPassword} onChange={e => setDisable2FAPassword(e.target.value)} disabled={isLoading} autoFocus />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="auth-btn-text" onClick={() => setShowDisable2FA(false)}>Cancel</button>
                <button type="submit" className="auth-btn-danger" disabled={isLoading || !disable2FAPassword}>Disable 2FA</button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};
