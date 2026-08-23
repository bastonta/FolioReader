import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { authApi } from '../api/authApi';
import { KeyRound, Mail, Lock, AlertCircle, CheckCircle2, ArrowLeft, RefreshCw, ShieldCheck, Loader } from 'lucide-react';
import { ThemeToggle } from '../components/common/ThemeToggle';

interface ForgotPasswordPageProps {
  theme?: string;
  onToggleTheme?: () => void;
}

export const ForgotPasswordPage: React.FC<ForgotPasswordPageProps> = ({ theme, onToggleTheme }) => {
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
      setError('Please enter your email');
      return;
    }

    try {
      setLoading(true);
      await authApi.passwordForgot(email);
      setStep('VERIFY');
      setCountdown(60);
    } catch (err) {
      setError((err as any)?.message || 'Failed to send reset code');
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!code) {
      setError('Please enter the code');
      return;
    }

    try {
      setLoading(true);
      const res = await authApi.passwordResetValidation(email, code);
      setToken(res.token);
      setStep('RESET');
    } catch (err) {
      setError((err as any)?.message || 'Invalid code');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    try {
      setLoading(true);
      await authApi.passwordReset(email, token, password);
      setStep('SUCCESS');
    } catch (err) {
      setError((err as any)?.message || 'Failed to reset password');
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
      setError((err as any)?.message || 'Failed to resend code');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      {/* Top Right Theme Toggle */}
      <ThemeToggle theme={theme} onToggle={onToggleTheme} />

      <div className="auth-card">
        {step === 'REQUEST' && (
          <>
            <div className="auth-header">
              <div className="auth-icon-badge">
                <KeyRound size={24} />
              </div>
              <h1 className="auth-title">Forgot Password</h1>
              <p className="auth-subtitle">Enter your email to receive a reset code</p>
            </div>

            {error && (
              <div className="auth-error">
                <AlertCircle size={18} style={{ flexShrink: 0 }} />
                <span>{error}</span>
              </div>
            )}

            <form className="auth-form" onSubmit={handleRequest}>
              <div className="auth-field">
                <label className="auth-label" htmlFor="email">Email Address</label>
                <div className="auth-input-wrapper">
                  <div className="auth-input-icon">
                    <Mail size={18} />
                  </div>
                  <input
                    id="email"
                    type="email"
                    className="auth-input"
                    placeholder="name@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={loading}
                    autoFocus
                  />
                </div>
              </div>

              <button type="submit" className="auth-btn-primary" disabled={loading || !email}>
                {loading ? <Loader size={18} className="spinner" /> : <Mail size={18} />}
                <span>{loading ? 'Sending...' : 'Send Reset Code'}</span>
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
              <h1 className="auth-title">Verify Code</h1>
              <p className="auth-subtitle">Enter the 6-digit code sent to {email}</p>
            </div>

            {error && (
              <div className="auth-error">
                <AlertCircle size={18} style={{ flexShrink: 0 }} />
                <span>{error}</span>
              </div>
            )}

            <form className="auth-form" onSubmit={handleVerify}>
              <div className="auth-field">
                <label className="auth-label" htmlFor="code">Reset Code</label>
                <div className="auth-input-wrapper">
                  <div className="auth-input-icon">
                    <KeyRound size={18} />
                  </div>
                  <input
                    id="code"
                    type="text"
                    className="auth-input auth-input-code"
                    placeholder="000000"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    disabled={loading}
                    autoFocus
                  />
                </div>
              </div>

              <button type="submit" className="auth-btn-primary" disabled={loading || code.length !== 6}>
                {loading ? <Loader size={18} className="spinner" /> : <ShieldCheck size={18} />}
                <span>{loading ? 'Verifying...' : 'Verify Code'}</span>
              </button>

              <button 
                type="button" 
                className="auth-btn-text" 
                onClick={handleResend}
                disabled={loading || countdown > 0}
              >
                <RefreshCw size={16} className={countdown > 0 ? '' : 'spin-on-hover'} />
                <span>
                  {countdown > 0 ? `Resend code in ${countdown}s` : 'Resend code'}
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
              <h1 className="auth-title">New Password</h1>
              <p className="auth-subtitle">Enter your new password below</p>
            </div>

            {error && (
              <div className="auth-error">
                <AlertCircle size={18} style={{ flexShrink: 0 }} />
                <span>{error}</span>
              </div>
            )}

            <form className="auth-form" onSubmit={handleReset}>
              <div className="auth-field">
                <label className="auth-label" htmlFor="password">New Password</label>
                <div className="auth-input-wrapper">
                  <div className="auth-input-icon">
                    <Lock size={18} />
                  </div>
                  <input
                    id="password"
                    type="password"
                    className="auth-input"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={loading}
                  />
                </div>
              </div>

              <div className="auth-field">
                <label className="auth-label" htmlFor="confirmPassword">Confirm Password</label>
                <div className="auth-input-wrapper">
                  <div className="auth-input-icon">
                    <Lock size={18} />
                  </div>
                  <input
                    id="confirmPassword"
                    type="password"
                    className="auth-input"
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    disabled={loading}
                  />
                </div>
              </div>

              <button type="submit" className="auth-btn-primary" disabled={loading || !password || !confirmPassword}>
                {loading ? <Loader size={18} className="spinner" /> : <Lock size={18} />}
                <span>{loading ? 'Resetting...' : 'Reset Password'}</span>
              </button>
            </form>
          </>
        )}

        {step === 'SUCCESS' && (
          <div className="auth-header">
            <div className="auth-icon-badge success">
              <CheckCircle2 size={24} />
            </div>
            <h1 className="auth-title">Password Reset</h1>
            <p className="auth-subtitle">Your password has been successfully reset.</p>
            <br />
            <Link to="/login" className="auth-btn-primary" style={{ textDecoration: 'none' }}>
              Back to Sign In
            </Link>
          </div>
        )}

        {step !== 'SUCCESS' && (
          <div className="auth-footer-text">
            <Link to="/login" className="auth-link" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <ArrowLeft size={16} /> Back to Sign In
            </Link>
          </div>
        )}

      </div>
    </div>
  );
};

export default ForgotPasswordPage;
