import { Component } from 'react';
import { createT, SUPPORTED_LANGUAGES, DEFAULT_LANGUAGE } from '@/i18n';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {

      let lang = DEFAULT_LANGUAGE;
      try {
        const stored = localStorage.getItem('audyn_language');
        if (stored && SUPPORTED_LANGUAGES.includes(stored)) lang = stored;
      } catch {}
      const t = createT(lang);

      return (
        <div
          className="min-h-screen flex flex-col items-center justify-center px-4"
          style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text)' }}
        >
          <div
            className="w-full max-w-sm p-8 text-center rounded-sm space-y-4"
            style={{
              backgroundColor: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
            }}
          >
            <p className="font-heading text-lg font-bold" style={{ color: 'var(--color-text)' }}>
              {t('errorBoundary.title')}
            </p>
            <p className="font-body text-sm" style={{ color: 'var(--color-text-muted)' }}>
              {t('errorBoundary.message')}
            </p>
            <button
              onClick={this.handleReload}
              className="px-6 py-2.5 rounded-sm font-mono text-xs uppercase tracking-wider btn-tactile"
              style={{
                backgroundColor: 'var(--color-neon)',
                color: 'var(--color-bg)',
              }}
            >
              {t('errorBoundary.reload')}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
