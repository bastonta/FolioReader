import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  Loader,
  Server,
} from "lucide-react";
import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetch } from "@tauri-apps/plugin-http";
import { useAuth } from "../context/AuthContext";
import { ThemeToggle } from "../components/common/ThemeToggle";
import { useTranslation } from "../i18n";

interface ServerSetupProps {
  theme?: string;
  onToggleTheme?: () => void;
}

export const ServerSetup: React.FC<ServerSetupProps> = ({ theme, onToggleTheme }) => {
  const { t } = useTranslation();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { setServerUrl } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!url) {
      setError(t('auth.serverUrlRequired'));
      return;
    }

    try {
      setLoading(true);

      let finalUrl = url.trim();
      if (!finalUrl.startsWith("http://") && !finalUrl.startsWith("https://")) {
        finalUrl = "https://" + finalUrl;
      }

      if (finalUrl.endsWith("/")) {
        finalUrl = finalUrl.slice(0, -1);
      }

      // Simple test request to validate the server URL
      const response = await fetch(`${finalUrl}/api/identity`, {
        method: "GET",
      });

      if (!response.ok && response.status !== 401 && response.status !== 404) {
        throw new Error(`Server responded with status: ${response.status}`);
      }

      setServerUrl(finalUrl);
      navigate("/login", { replace: true });
    } catch (err) {
      setError(
        (err as any)?.message ||
          t('auth.serverConnectFailed'),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      {/* Top Right Theme Toggle */}
      <ThemeToggle theme={theme} onToggle={onToggleTheme} tabIndex={3} />

      <div className="auth-card">
        <div className="auth-header">
          <div className="auth-icon-badge">
            <BookOpen size={24} />
          </div>
          <h1 className="auth-title">{t('auth.connectToServer')}</h1>
          <p className="auth-subtitle">{t('auth.enterServerAddress')}</p>
        </div>

        {error && (
          <div className="auth-error">
            <AlertCircle size={18} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        <form className="auth-form" onSubmit={handleSubmit} autoComplete="off">
          <div className="auth-field">
            <label className="auth-label" htmlFor="serverUrl">
              {t('auth.serverUrlLabel')}
            </label>
            <div className="auth-input-wrapper">
              <div className="auth-input-icon">
                <Server size={18} />
              </div>
              <input
                id="serverUrl"
                name="serverUrl"
                type="url"
                className="auth-input"
                placeholder="https://folio.example.com"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={loading}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                autoFocus
                tabIndex={1}
              />
            </div>
          </div>

          <button
            type="submit"
            className="auth-btn-primary"
            disabled={loading || !url}
            tabIndex={2}
          >
            {loading ? (
              <Loader size={18} className="spinner" />
            ) : (
              <ArrowRight size={18} />
            )}
            <span>{loading ? t('auth.connecting') : t('auth.connect')}</span>
          </button>
        </form>
      </div>
    </div>
  );
};

export default ServerSetup;

