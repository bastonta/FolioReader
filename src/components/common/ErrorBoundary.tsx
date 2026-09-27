import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackTitle?: string;
  fallbackMessage?: string;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('Unhandled React Error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      const title = this.props.fallbackTitle || 'Something went wrong';
      const message =
        this.props.fallbackMessage ||
        'An unexpected error occurred in the application. You can try recovering or reloading.';

      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            padding: '2rem',
            backgroundColor: 'var(--bg-primary, #ffffff)',
            color: 'var(--text-primary, #2e3436)',
            fontFamily: 'var(--font-sans, system-ui, sans-serif)',
            textAlign: 'center',
            boxSizing: 'border-box',
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: '50%',
              backgroundColor: 'rgba(224, 27, 36, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '1.25rem',
              color: 'var(--danger-color, #e01b24)',
            }}
          >
            <AlertTriangle size={32} />
          </div>

          <h2
            style={{
              margin: '0 0 0.5rem 0',
              fontSize: '1.35rem',
              fontWeight: 600,
            }}
          >
            {title}
          </h2>

          <p
            style={{
              margin: '0 0 1.5rem 0',
              maxWidth: 480,
              fontSize: '0.95rem',
              color: 'var(--text-secondary, #5e5c64)',
              lineHeight: 1.5,
            }}
          >
            {message}
          </p>

          {this.state.error?.message && (
            <pre
              style={{
                maxWidth: 540,
                width: '100%',
                maxHeight: 120,
                overflowY: 'auto',
                padding: '0.75rem 1rem',
                margin: '0 0 1.5rem 0',
                backgroundColor: 'var(--bg-secondary, #f6f5f4)',
                border: '1px solid var(--border-color, #deddda)',
                borderRadius: 'var(--radius-md, 8px)',
                fontSize: '0.8rem',
                color: 'var(--danger-color, #c01c28)',
                textAlign: 'left',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {this.state.error.message}
            </pre>
          )}

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
            {this.props.onReset && (
              <button
                type="button"
                onClick={this.handleReset}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.6rem 1.2rem',
                  backgroundColor: 'var(--accent-color, #3584e4)',
                  color: 'var(--accent-text, #ffffff)',
                  border: 'none',
                  borderRadius: 'var(--radius-md, 8px)',
                  fontSize: '0.9rem',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                <Home size={16} />
                Return to Library
              </button>
            )}

            <button
              type="button"
              onClick={this.handleReload}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.6rem 1.2rem',
                backgroundColor: 'var(--bg-secondary, #f6f5f4)',
                color: 'var(--text-primary, #2e3436)',
                border: '1px solid var(--border-color, #deddda)',
                borderRadius: 'var(--radius-md, 8px)',
                fontSize: '0.9rem',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              <RefreshCw size={16} />
              Reload App
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
