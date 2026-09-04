import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { BookOpen, UserPlus, User, Mail, Lock, AlertCircle, Loader, Server } from 'lucide-react';
import { ThemeToggle } from '../components/common/ThemeToggle';
import { useTranslation } from '../i18n';

interface RegisterPageProps {
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

export const RegisterPage: React.FC<RegisterPageProps> = ({ theme, onToggleTheme }) => {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const { register, serverUrl, clearServer } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name || !email || !password) {
      setError(t('auth.fillAllFields'));
      return;
    }

    try {
      setLoading(true);
      const res = await register(name, email, password);
      const { userId, resendAfter } = res || {};
      
      navigate('/confirm-email', { 
        state: { 
          userId, 
          email, 
          resendAfter 
        } 
      });
    } catch (err) {
      setError((err as any)?.message || t('auth.registrationFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleChangeServer = () => {
    clearServer();
    navigate('/server');
  };

  return (
    <div className="auth-page">
      {/* Top Right Theme Toggle */}
      <ThemeToggle theme={theme} onToggle={onToggleTheme} tabIndex={6} />

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
            tabIndex={7}
            role="button"
            title={t('auth.changeServer')}
          >
            <Server size={14} />
            <span>{formatServerHost(serverUrl)}</span>
          </div>
        )}

        <div className="auth-header">
          <div className="auth-icon-badge">
            <BookOpen size={24} />
          </div>
          <h1 className="auth-title">{t('auth.createAccount')}</h1>
          <p className="auth-subtitle">{t('auth.joinFolioSubtitle')}</p>
        </div>

        {error && (
          <div className="auth-error">
            <AlertCircle size={18} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="auth-field">
            <label className="auth-label" htmlFor="name">{t('auth.fullNameLabel')}</label>
            <div className="auth-input-wrapper">
              <div className="auth-input-icon">
                <User size={18} />
              </div>
              <input
                id="name"
                name="name"
                type="text"
                className="auth-input"
                placeholder={t('auth.namePlaceholder')}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={loading}
                autoComplete="name"
                autoFocus
                tabIndex={1}
              />
            </div>
          </div>

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
                tabIndex={2}
              />
            </div>
          </div>

          <div className="auth-field">
            <label className="auth-label" htmlFor="password">{t('auth.passwordLabel')}</label>
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
                tabIndex={3}
              />
            </div>
          </div>

          <button type="submit" className="auth-btn-primary" disabled={loading || !name || !email || !password} tabIndex={4}>
            {loading ? <Loader size={18} className="spinner" /> : <UserPlus size={18} />}
            <span>{loading ? t('auth.creatingAccount') : t('auth.createAccount')}</span>
          </button>

          <div className="auth-footer-text">
            {t('auth.alreadyHaveAccount')}{' '}
            <Link to="/login" className="auth-link" tabIndex={5}>{t('auth.signInHere')}</Link>
          </div>
        </form>
      </div>
    </div>
  );
};

export default RegisterPage;

