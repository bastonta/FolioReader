import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { authApi } from '../api/authApi';
import { MailCheck, KeyRound, AlertCircle, RefreshCw, ArrowLeft, CheckCircle2, Loader } from 'lucide-react';
import { ThemeToggle } from '../components/common/ThemeToggle';

interface ConfirmEmailPageProps {
  theme?: string;
  onToggleTheme?: () => void;
}

export const ConfirmEmailPage: React.FC<ConfirmEmailPageProps> = ({ theme, onToggleTheme }) => {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [countdown, setCountdown] = useState(0);

  const location = useLocation();
  const navigate = useNavigate();
  const { emailConfirm } = useAuth();

  const state = location.state as { userId?: string; email?: string; resendAfter?: string } | null;
  const searchParams = new URLSearchParams(location.search);
  
  const userId = state?.userId || searchParams.get('userId');
  const email = state?.email || searchParams.get('email');
  const initialResendAfter = state?.resendAfter || searchParams.get('resendAfter');

  useEffect(() => {
    if (!userId || !email) {
      navigate('/login', { replace: true });
    }
  }, [userId, email, navigate]);

  useEffect(() => {
    if (initialResendAfter) {
      const targetTime = new Date(initialResendAfter).getTime();
      const now = Date.now();
      const diff = Math.ceil((targetTime - now) / 1000);
      if (diff > 0) {
        setCountdown(diff);
      }
    }
  }, [initialResendAfter]);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (countdown > 0) {
      timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [countdown]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!code || code.length !== 6) {
      setError('Please enter a valid 6-digit code');
      return;
    }

    try {
      setLoading(true);
      await emailConfirm(userId!, code);
      setSuccess(true);
      setTimeout(() => navigate('/', { replace: true }), 1500);
    } catch (err) {
      setError((err as any)?.message || 'Invalid confirmation code');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    try {
      setLoading(true);
      setError('');
      const res = await authApi.emailConfirmResend(userId!);
      if (res.resendAfter) {
        const targetTime = new Date(res.resendAfter).getTime();
        const now = Date.now();
        setCountdown(Math.max(0, Math.ceil((targetTime - now) / 1000)));
      } else {
        setCountdown(60);
      }
    } catch (err) {
      setError((err as any)?.message || 'Failed to resend code');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="auth-page">
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
        <div className="auth-card">
          <div className="auth-header">
            <div className="auth-icon-badge success">
              <CheckCircle2 size={24} />
            </div>
            <h1 className="auth-title">Email Confirmed!</h1>
            <p className="auth-subtitle">Your account is ready. Redirecting...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      {/* Top Right Theme Toggle */}
      <ThemeToggle theme={theme} onToggle={onToggleTheme} />

      <div className="auth-card">
        <div className="auth-header">
          <div className="auth-icon-badge">
            <MailCheck size={24} />
          </div>
          <h1 className="auth-title">Confirm Email</h1>
          <p className="auth-subtitle">
            We sent a code to <strong>{email}</strong>
          </p>
        </div>

        {error && (
          <div className="auth-error">
            <AlertCircle size={18} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        <form className="auth-form" onSubmit={handleSubmit} autoComplete="off">
          <div className="auth-field">
            <label className="auth-label" htmlFor="code">Confirmation Code</label>
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
              />
            </div>
          </div>

          <button type="submit" className="auth-btn-primary" disabled={loading || code.length !== 6}>
            {loading ? <Loader size={18} className="spinner" /> : <CheckCircle2 size={18} />}
            <span>{loading ? 'Confirming...' : 'Confirm Email'}</span>
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

          <div className="auth-footer-text">
            <Link to="/login" className="auth-link" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
              <ArrowLeft size={16} /> Back to Sign In
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ConfirmEmailPage;
