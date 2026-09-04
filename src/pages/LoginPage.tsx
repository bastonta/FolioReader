import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { BookOpen, LogIn, Lock, Mail, AlertCircle, ShieldCheck, KeyRound, ArrowLeft, Server, Loader } from 'lucide-react';
import { ThemeToggle } from '../components/common/ThemeToggle';
import { useBackHandler } from '../services/backHandler';
import { useTranslation } from '../i18n';

interface LoginPageProps {
  theme?: string;
  onToggleTheme?: () => void;
}

function formatServerHost(urlStr: string): string {
  if (!urlStr) return '';
  try {
    const formatted = urlStr.includes('://') ? urlStr : `https://${urlStr}`;
    return new URL(formatted).host || urlStr;
  } catch {
    return urlStr;
  }
}

export const LoginPage: React.FC<LoginPageProps> = ({ theme, onToggleTheme }) => {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const [twoFactorData, setTwoFactorData] = useState<{ userId: string; token: string; need2fa: boolean } | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [isRecovery, setIsRecovery] = useState(false);

  const { login, login2fa, serverUrl, clearServer } = useAuth();
  const navigate = useNavigate();

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (!email || !password) {
      setError(t('auth.enterEmailAndPassword'));
      return;
    }

    try {
      setLoading(true);
      const res = await login(email, password);
      if (res?.need2fa) {
        setTwoFactorData({ userId: res.userId, token: res.token, need2fa: true });
      } else {
        navigate('/', { replace: true });
      }
    } catch (err) {
      setError((err as any)?.message || t('auth.invalidCredentials'));
    } finally {
      setLoading(false);
    }
  };

  const handle2faSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!twoFactorCode) {
      setError(t('auth.enterCode'));
      return;
    }

    try {
      setLoading(true);
      await login2fa(twoFactorData!.userId, twoFactorData!.token, twoFactorCode, isRecovery ? 'recovery' : 'code');
      navigate('/', { replace: true });
    } catch (err) {
      setError((err as any)?.message || t('auth.invalidCode'));
    } finally {
      setLoading(false);
    }
  };

  const handleBackToLogin = () => {
    setTwoFactorData(null);
    setTwoFactorCode('');
    setError('');
  };

  useBackHandler(() => {
    if (twoFactorData) {
      handleBackToLogin();
      return true;
    }
    return false;
  }, Boolean(twoFactorData), 100);

  const handleChangeServer = () => {
    clearServer();
    navigate('/server');
  };

  return (
    <div className="auth-page">
      {/* Top Right Theme Toggle */}
      <ThemeToggle theme={theme} onToggle={onToggleTheme} tabIndex={twoFactorData ? 5 : 6} />

      <div className="auth-card">
        {serverUrl && (
          <div
            className="auth-server-badge"
            onClick={handleChangeServer}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleChangeServer();
              }
            }}
            tabIndex={twoFactorData ? 6 : 7}
            role="button"
            title={t('auth.changeServer')}
          >
            <Server size={14} />
            <span>{formatServerHost(serverUrl)}</span>
          </div>
        )}

        <div className="auth-header">
          <div className="auth-icon-badge">
            {twoFactorData ? <ShieldCheck size={24} /> : <BookOpen size={24} />}
          </div>
          <h1 className="auth-title">
            {twoFactorData ? t('auth.twoFactorTitle') : t('auth.welcomeBack')}
          </h1>
          <p className="auth-subtitle">
            {twoFactorData 
              ? (isRecovery ? t('auth.twoFactorRecoverySubtitle') : t('auth.twoFactorSubtitle'))
              : t('auth.signInSubtitle')}
          </p>
        </div>

        {error && (
          <div className="auth-error">
            <AlertCircle size={18} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        {!twoFactorData ? (
          <form className="auth-form" onSubmit={handleLoginSubmit}>
            <div className="auth-field">
              <label className="auth-label" htmlFor="email">{t('auth.emailLabel')}</label>
              <div className="auth-input-wrapper">
                <div className="auth-input-icon">
                  <Mail size={18} />
                </div>
                <input
                  id="email"
                  name="email"
                  type="email"
                  className="auth-input"
                  placeholder={t('auth.emailPlaceholder')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={loading}
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoFocus
                  tabIndex={1}
                />
              </div>
            </div>

            <div className="auth-field">
              <div className="auth-label-row">
                <label className="auth-label" htmlFor="password">{t('auth.passwordLabel')}</label>
                <Link to="/forgot-password" className="auth-link-sm" tabIndex={4}>{t('auth.forgotPassword')}</Link>
              </div>
              <div className="auth-input-wrapper">
                <div className="auth-input-icon">
                  <Lock size={18} />
                </div>
                <input
                  id="password"
                  name="password"
                  type="password"
                  className="auth-input"
                  placeholder={t('auth.passwordPlaceholder')}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                  autoComplete="current-password"
                  tabIndex={2}
                />
              </div>
            </div>

            <button type="submit" className="auth-btn-primary" disabled={loading || !email || !password} tabIndex={3}>
              {loading ? <Loader size={18} className="spinner" /> : <LogIn size={18} />}
              <span>{loading ? t('auth.signingIn') : t('auth.signIn')}</span>
            </button>

            <div className="auth-footer-text">
              {t('auth.noAccount')}{' '}
              <Link to="/register" className="auth-link" tabIndex={5}>{t('auth.registerHere')}</Link>
            </div>
          </form>
        ) : (
          <form className="auth-form" onSubmit={handle2faSubmit} autoComplete="off">
            <div className="auth-field">
              <label className="auth-label" htmlFor="code">
                {isRecovery ? t('auth.recoveryCodeLabel') : t('auth.totpCodeLabel')}
              </label>
              <div className="auth-input-wrapper">
                <div className="auth-input-icon">
                  <KeyRound size={18} />
                </div>
                <input
                  id="code"
                  name="code"
                  type="text"
                  inputMode={isRecovery ? "text" : "numeric"}
                  className="auth-input auth-input-code"
                  placeholder={isRecovery ? 'XXXXX-XXXXX' : '000000'}
                  value={twoFactorCode}
                  onChange={(e) => setTwoFactorCode(e.target.value.replace(/[^a-zA-Z0-9-]/g, ''))}
                  disabled={loading}
                  autoComplete={isRecovery ? "off" : "one-time-code"}
                  autoFocus
                  tabIndex={1}
                />
              </div>
            </div>

            <button type="submit" className="auth-btn-primary" disabled={loading || !twoFactorCode} tabIndex={2}>
              {loading ? <Loader size={18} className="spinner" /> : <ShieldCheck size={18} />}
              <span>{loading ? t('auth.verifying') : t('auth.verifySignIn')}</span>
            </button>

            <button 
              type="button" 
              className="auth-btn-text" 
              onClick={() => {
                setIsRecovery(!isRecovery);
                setTwoFactorCode('');
                setError('');
              }}
              disabled={loading}
              tabIndex={3}
            >
              {isRecovery ? t('auth.useAuthenticatorCode') : t('auth.useRecoveryCode')}
            </button>
            
            <button 
              type="button" 
              className="auth-btn-secondary" 
              onClick={handleBackToLogin}
              disabled={loading}
              tabIndex={4}
            >
              <ArrowLeft size={16} />
              <span>{t('auth.backToSignIn')}</span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default LoginPage;

