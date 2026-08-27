import React from 'react';
import {
  X,
  Download,
  ExternalLink,
  Sparkles,
  Calendar,
  ArrowRight,
  Tag,
} from 'lucide-react';
import { UpdateInfo, openReleaseUrl, dismissUpdate } from '../../services/updateChecker';
import { formatBuildTime } from '../../constants/buildInfo';
import { useTranslation } from '../../i18n';

interface UpdateModalProps {
  isOpen: boolean;
  onClose: () => void;
  updateInfo: UpdateInfo;
}

/**
 * Format and render markdown-style text safely without external heavyweight libraries
 */
function renderMarkdown(text: string, onLinkClick: (url: string) => void) {
  if (!text || !text.trim()) {
    return null;
  }

  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let inCodeBlock = false;
  let codeBlockContent: string[] = [];

  const formatInline = (str: string): React.ReactNode[] => {
    // Process links [text](url) and inline code `code` and bold **text**
    const parts: React.ReactNode[] = [];
    const regex = /(\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(str)) !== null) {
      if (match.index > lastIndex) {
        parts.push(str.substring(lastIndex, match.index));
      }

      if (match[2] && match[3]) {
        // [text](url)
        const linkText = match[2];
        const linkUrl = match[3];
        parts.push(
          <a
            key={`link-${match.index}`}
            href={linkUrl}
            onClick={(e) => {
              e.preventDefault();
              onLinkClick(linkUrl);
            }}
            style={{
              color: 'var(--accent-color)',
              textDecoration: 'underline',
              cursor: 'pointer',
            }}
          >
            {linkText}
          </a>
        );
      } else if (match[4]) {
        // `code`
        parts.push(
          <code
            key={`code-${match.index}`}
            style={{
              padding: '2px 6px',
              backgroundColor: 'var(--bg-tertiary)',
              borderRadius: 4,
              fontSize: '0.9em',
              fontFamily: 'monospace',
            }}
          >
            {match[4]}
          </code>
        );
      } else if (match[5]) {
        // **bold**
        parts.push(<strong key={`bold-${match.index}`}>{match[5]}</strong>);
      } else if (match[6]) {
        // *italic*
        parts.push(<em key={`italic-${match.index}`}>{match[6]}</em>);
      }

      lastIndex = regex.lastIndex;
    }

    if (lastIndex < str.length) {
      parts.push(str.substring(lastIndex));
    }

    return parts.length > 0 ? parts : [str];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        elements.push(
          <pre
            key={`codeblock-${i}`}
            style={{
              padding: '10px 14px',
              backgroundColor: 'var(--bg-tertiary)',
              borderRadius: 6,
              overflowX: 'auto',
              fontSize: 12,
              fontFamily: 'monospace',
              margin: '8px 0',
            }}
          >
            <code>{codeBlockContent.join('\n')}</code>
          </pre>
        );
        codeBlockContent = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      elements.push(<div key={`spacer-${i}`} style={{ height: 6 }} />);
      continue;
    }

    if (trimmed.startsWith('### ')) {
      elements.push(
        <h4
          key={`h3-${i}`}
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: 'var(--text-primary)',
            marginTop: 10,
            marginBottom: 4,
          }}
        >
          {formatInline(trimmed.substring(4))}
        </h4>
      );
    } else if (trimmed.startsWith('## ')) {
      elements.push(
        <h3
          key={`h2-${i}`}
          style={{
            fontSize: 15,
            fontWeight: 700,
            color: 'var(--text-primary)',
            marginTop: 12,
            marginBottom: 6,
          }}
        >
          {formatInline(trimmed.substring(3))}
        </h3>
      );
    } else if (trimmed.startsWith('# ')) {
      elements.push(
        <h2
          key={`h1-${i}`}
          style={{
            fontSize: 16,
            fontWeight: 700,
            color: 'var(--text-primary)',
            marginTop: 14,
            marginBottom: 8,
          }}
        >
          {formatInline(trimmed.substring(2))}
        </h2>
      );
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      elements.push(
        <li
          key={`li-${i}`}
          style={{
            marginLeft: 16,
            marginBottom: 4,
            fontSize: 13,
            color: 'var(--text-primary)',
            lineHeight: 1.45,
          }}
        >
          {formatInline(trimmed.substring(2))}
        </li>
      );
    } else {
      elements.push(
        <p
          key={`p-${i}`}
          style={{
            fontSize: 13,
            color: 'var(--text-primary)',
            lineHeight: 1.45,
            margin: '4px 0',
          }}
        >
          {formatInline(line)}
        </p>
      );
    }
  }

  if (inCodeBlock && codeBlockContent.length > 0) {
    elements.push(
      <pre
        key="codeblock-end"
        style={{
          padding: '10px 14px',
          backgroundColor: 'var(--bg-tertiary)',
          borderRadius: 6,
          overflowX: 'auto',
          fontSize: 12,
          fontFamily: 'monospace',
          margin: '8px 0',
        }}
      >
        <code>{codeBlockContent.join('\n')}</code>
      </pre>
    );
  }

  return elements;
}

export const UpdateModal: React.FC<UpdateModalProps> = ({
  isOpen,
  onClose,
  updateInfo,
}) => {
  const { t } = useTranslation();

  if (!isOpen) return null;

  const handleDismiss = () => {
    dismissUpdate(updateInfo.latestVersion);
    onClose();
  };

  const handleOpenReleasePage = () => {
    openReleaseUrl(updateInfo.htmlUrl);
  };

  const handleDownloadAsset = () => {
    if (updateInfo.assetUrl) {
      openReleaseUrl(updateInfo.assetUrl);
    } else {
      handleOpenReleasePage();
    }
  };

  const isPre = updateInfo.isPrerelease;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-container"
        style={{
          maxWidth: 520,
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="modal-drag-handle" />

        {/* Modal Header */}
        <div className="modal-header" style={{ paddingBottom: 12 }}>
          <div className="modal-header-title-row">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  backgroundColor: isPre
                    ? "rgba(234, 179, 8, 0.15)"
                    : "rgba(59, 130, 246, 0.15)",
                  color: isPre ? "#eab308" : "var(--accent-color)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                <Sparkles size={18} />
              </div>
              <div>
                <h3 className="modal-title" style={{ fontSize: 16, margin: 0 }}>
                  {isPre ? t("update.prereleaseTitle") : t("update.title")}
                </h3>
              </div>
            </div>

            <button
              type="button"
              className="modal-close-btn"
              onClick={onClose}
              aria-label={t("common.close")}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div
          className="modal-body"
          style={{
            flex: 1,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 16,
            paddingTop: 8,
          }}
        >
          {/* Version Banner */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 16px",
              backgroundColor: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: "var(--radius-md)",
              gap: 12,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {t("update.currentVersion")}:
                </span>
                <span
                  style={{
                    fontSize: 13,
                    fontFamily: "monospace",
                    fontWeight: 600,
                    color: "var(--text-secondary)",
                  }}
                >
                  v{updateInfo.currentVersion}
                </span>
              </div>

              <ArrowRight size={14} style={{ color: "var(--text-muted)" }} />

              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {t("update.latestVersion")}:
                </span>
                <span
                  style={{
                    fontSize: 13,
                    fontFamily: "monospace",
                    fontWeight: 700,
                    color: "var(--accent-color)",
                  }}
                >
                  v{updateInfo.latestVersion}
                </span>
              </div>
            </div>

            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                padding: "3px 8px",
                borderRadius: 12,
                backgroundColor: isPre
                  ? "rgba(234, 179, 8, 0.15)"
                  : "rgba(34, 197, 94, 0.15)",
                color: isPre ? "#ca8a04" : "#16a34a",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                flexShrink: 0,
              }}
            >
              <Tag size={12} />
              <span>{isPre ? "BETA" : "NEW"}</span>
            </span>
          </div>

          {/* Release Date Info */}
          {updateInfo.publishedAt && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                color: "var(--text-muted)",
              }}
            >
              <Calendar size={13} />
              <span>{formatBuildTime(updateInfo.publishedAt)}</span>
            </div>
          )}

          {/* Release Notes */}
          <div>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "var(--text-primary)",
                marginBottom: 8,
              }}
            >
              {t("update.releaseNotes")}
            </div>

            <div
              style={{
                maxHeight: 220,
                overflowY: "auto",
                padding: "12px 14px",
                backgroundColor: "var(--bg-secondary)",
                border: "1px solid var(--border-color)",
                borderRadius: "var(--radius-md)",
              }}
            >
              {updateInfo.releaseNotes ? (
                renderMarkdown(updateInfo.releaseNotes, openReleaseUrl)
              ) : (
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  {t("update.noReleaseNotes")}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div
          className="modal-footer"
          style={{
            padding: "14px 20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            className="auth-btn-secondary"
            style={{ padding: "8px 14px", fontSize: 13 }}
            onClick={handleDismiss}
          >
            {t("update.later")}
          </button>

          <div style={{ display: "flex", gap: 8, width: "100%" }}>
            <button
              type="button"
              className="auth-btn-secondary"
              style={{
                flex: 1,
                minWidth: 0,
                padding: "8px 12px",
                fontSize: 13,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
              onClick={handleOpenReleasePage}
            >
              <ExternalLink size={14} style={{ flexShrink: 0 }} />
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {t("update.openReleasePage")}
              </span>
            </button>

            <button
              type="button"
              className="auth-btn-primary"
              style={{
                flex: 1,
                minWidth: 0,
                padding: "8px 12px",
                fontSize: 13,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
              onClick={handleDownloadAsset}
            >
              <Download size={14} style={{ flexShrink: 0 }} />
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {updateInfo.assetUrl?.endsWith(".apk")
                  ? t("update.downloadApk")
                  : t("update.downloadUpdate")}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
