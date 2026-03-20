import { useState } from 'react';
import { Loader2, ArrowLeft, LogIn } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';

export default function LoginPage({ onBack, onSwitchToRegister }) {
  const { login } = useAuth();
  const { t } = useLanguage();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error(t('login.fillFields'));
      return;
    }
    setLoading(true);
    try {
      await login(email, password);
      toast.success(t('login.welcomeBack'));
      onBack();
    } catch (err) {
      const msg = err.response?.data?.detail || t('login.loginFailed');
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    backgroundColor: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    color: 'var(--color-text)',
  };

  return (
    <div className="min-h-[calc(100vh-48px)] flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm space-y-8 animate-slide-in-up">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-1 btn-tactile" style={{ color: 'var(--color-text-muted)' }}>
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="font-heading text-2xl font-extrabold" style={{ color: 'var(--color-text)' }}>
            {t('login.title')}
          </h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="font-mono text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-dim)' }}>
              {t('login.email')}
            </label>
            <input
              type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder={t('login.emailPlaceholder')}
              className="w-full px-4 py-3 text-sm font-body rounded-sm outline-none" style={inputStyle} autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <label className="font-mono text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-dim)' }}>
              {t('login.password')}
            </label>
            <input
              type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder={t('login.passwordPlaceholder')}
              className="w-full px-4 py-3 text-sm font-body rounded-sm outline-none" style={inputStyle}
            />
          </div>
          <button
            type="submit" disabled={loading}
            className="w-full h-12 rounded-sm font-bold text-sm uppercase tracking-wider btn-tactile transition-all flex items-center justify-center gap-2"
            style={{ backgroundColor: 'var(--color-neon)', color: 'var(--color-bg)', opacity: loading ? 0.7 : 1 }}
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
            {loading ? t('login.signingIn') : t('login.logInBtn')}
          </button>
        </form>

        <p className="text-center font-body text-sm" style={{ color: 'var(--color-text-muted)' }}>
          {t('login.noAccount')}{' '}
          <button onClick={onSwitchToRegister} className="font-bold btn-tactile" style={{ color: 'var(--color-neon)' }}>
            {t('login.signUpLink')}
          </button>
        </p>
      </div>
    </div>
  );
}
