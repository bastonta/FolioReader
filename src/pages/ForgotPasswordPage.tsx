import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { authApi } from '../api/authApi';
import { KeyRound, Mail, Lock, AlertCircle, CheckCircle2, ArrowLeft, RefreshCw, ShieldCheck, Loader } from 'lucide-react';
import { ThemeToggle } from '../components/common/ThemeToggle';
import { useTranslation } from '../i18n';

interface ForgotPasswordPageProps {
  theme?: string;
  onToggleTheme?: () => void;
}

export const ForgotPasswordPage: React.FC<ForgotPasswordPageProps> = ({ theme, onToggleTheme }) => {
  const { t } = useTranslation();
  const [step, setStep] = useState<'REQUEST' | 'VERIFY' | 'RESET' | 'SUCCESS'>('REQUEST');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [token, setToken] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(0);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (countdown > 0) {
      timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [countdown]);

  const handleRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!email) {
      setError(t('auth.enterEmail'));
      return;
    }

    try {
      setLoading(true);
      await authApi.passwordForgot(email);
      setStep('VERIFY');
      setCountdown(60);
    } catch (err) {
      setError((err as any)?.message || t('auth.sendResetCodeFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!code) {
      setError(t('auth.enterCode'));
      return;
    }

    try {
      setLoading(true);
      const res = await authApi.passwordResetValidation(email, code);
      setToken(res.token);
      setStep('RESET');
    } catch (err) {
      setError((err as any)?.message || t('auth.invalidCode'));
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError(t('auth.passwordsDoNotMatch'));
      return;
    }

    if (password.length < 8) {
      setError(t('auth.passwordMinLength'));
      return;
    }

    try {
      setLoading(true);
      await authApi.passwordReset(email, token, password);
      setStep('SUCCESS');
    } catch (err) {
      setError((err as any)?.message || t('auth.resetPasswordFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    try {
      setLoading(true);
      setError('');
      await authApi.passwordForgot(email);
      setCountdown(60);
    } catch (err) {
      setError((err as any)?.message || t('auth.resendFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      {/* Top Right Theme Toggle */}
      <ThemeToggle theme={theme} onToggle={onToggleTheme} tabIndex={step === 'SUCCESS' ? 2 : (step === 'VERIFY' || step === 'RESET' ? 5 : 4)} />

      <div className="auth-card">
        {step === 'REQUEST' && (
          <>
            <div className="auth-header">
              <div className="auth-icon-badge">
                <KeyRound size={24} />
              </div>
              <h1 className="auth-title">{t('auth.forgotPasswordTitle')}</h1>
              <p className="auth-subtitle">{t('auth.forgotPasswordSubtitle')}</p>
            </div>

            {error && (
              <div className="auth-error">
                <AlertCircle size={18} style={{ flexShrink: 0 }} />
                <span>{error}</span>
              </div>
            )}

            <form className="auth-form" onSubmit={handleRequest}>
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
                    autoComplete="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    autoFocus
                    tabIndex={1}
                  />
                </div>
              </div>

              <button type="submit" className="auth-btn-primary" disabled={loading || !email} tabIndex={2}>
                {loading ? <Loader size={18} className="spinner" /> : <Mail size={18} />}
                <span>{loading ? t('auth.sending') : t('auth.sendResetCode')}</span>
              </button>
            </form>
          </>
        )}

        {step === 'VERIFY' && (
          <>
            <div className="auth-header">
              <div className="auth-icon-badge">
                <ShieldCheck size={24} />
              </div>
              <h1 className="auth-title">{t('auth.verifyCodeTitle')}</h1>
              <p className="auth-subtitle">{t('auth.verifyCodeSubtitle', { email })}</p>
            </div>

            {error && (
              <div className="auth-error">
                <AlertCircle size={18} style={{ flexShrink: 0 }} />
                <span>{error}</span>
              </div>
            )}

            <form className="auth-form" onSubmit={handleVerify} autoComplete="off">
              <div className="auth-field">
                <label className="auth-label" htmlFor="code">{t('auth.resetCodeLabel')}</label>
                <div className="auth-input-wrapper">
                  <div className="auth-input-icon">
                    <KeyRound size={18} />
                  </div>
                  <input
                    id="code"
                    name="code"
                    type="text"
                    inputMode="numeric"
                    className="auth-input auth-input-code"
                    placeholder="000000"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    disabled={loading}
                    autoComplete="one-time-code"
                    autoFocus
                    tabIndex={1}
                  />
                </div>
              </div>

              <button type="submit" className="auth-btn-primary" disabled={loading || code.length !== 6} tabIndex={2}>
                {loading ? <Loader size={18} className="spinner" /> : <ShieldCheck size={18} />}
                <span>{loading ? t('auth.verifying') : t('auth.verifyCodeTitle')}</span>
              </button>

              <button 
                type="button" 
                className="auth-btn-text" 
                onClick={handleResend}
                disabled={loading || countdown > 0}
                tabIndex={3}
              >
                <RefreshCw size={16} className={countdown > 0 ? '' : 'spin-on-hover'} />
                <span>
                  {countdown > 0 ? t('auth.resendCodeIn', { count: countdown }) : t('auth.resendCode')}
                </span>
              </button>
            </form>
          </>
        )}

        {step === 'RESET' && (
          <>
            <div className="auth-header">
              <div className="auth-icon-badge">
                <Lock size={24} />
              </div>
              <h1 className="auth-title">{t('auth.newPasswordTitle')}</h1>
              <p className="auth-subtitle">{t('auth.newPasswordSubtitle')}</p>
            </div>

            {error && (
              <div className="auth-error">
                <AlertCircle size={18} style={{ flexShrink: 0 }} />
                <span>{error}</span>
              </div>
            )}

            <form className="auth-form" onSubmit={handleReset}>
              <div className="auth-field">
                <label className="auth-label" htmlFor="password">{t('auth.newPasswordLabel')}</label>
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
                    autoComplete="new-password"
                    tabIndex={1}
                  />
                </div>
              </div>

              <div className="auth-field">
                <label className="auth-label" htmlFor="confirmPassword">{t('auth.confirmPasswordLabel')}</label>
                <div className="auth-input-wrapper">
                  <div className="auth-input-icon">
                    <Lock size={18} />
                  </div>
                  <input
                    id="confirmPassword"
                    name="confirmPassword"
                    type="password"
                    className="auth-input"
                    placeholder={t('auth.passwordPlaceholder')}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={loading}
                    autoComplete="new-password"
                    tabIndex={2}
                  />
                </div>
              </div>

              <button type="submit" className="auth-btn-primary" disabled={loading || !password || !confirmPassword} tabIndex={3}>
                {loading ? <Loader size={18} className="spinner" /> : <Lock size={18} />}
                <span>{loading ? t('auth.resetting') : t('auth.resetPasswordBtn')}</span>
              </button>
            </form>
          </>
        )}

        {step === 'SUCCESS' && (
          <div className="auth-header">
            <div className="auth-icon-badge success">
              <CheckCircle2 size={24} />
            </div>
            <h1 className="auth-title">{t('auth.passwordResetSuccessTitle')}</h1>
            <p className="auth-subtitle">{t('auth.passwordResetSuccessSubtitle')}</p>
            <br />
            <Link to="/login" className="auth-btn-primary" style={{ textDecoration: 'none' }} tabIndex={1}>
              {t('auth.backToSignIn')}
            </Link>
          </div>
        )}

        {step !== 'SUCCESS' && (
          <div className="auth-footer-text">
            <Link to="/login" className="auth-link" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }} tabIndex={step === 'RESET' ? 4 : (step === 'VERIFY' ? 4 : 3)}>
              <ArrowLeft size={16} /> {t('auth.backToSignIn')}
            </Link>
          </div>
        )}

      </div>
    </div>
  );
};

export default ForgotPasswordPage;

