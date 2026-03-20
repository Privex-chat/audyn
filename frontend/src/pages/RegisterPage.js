import { useState } from 'react';
import { Loader2, ArrowLeft, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';

export default function RegisterPage({ onBack, onSwitchToLogin, guestConvert = false }) {
  const { register, convertGuest, isGuest } = useAuth();
  const { t } = useLanguage();
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [bio, setBio] = useState('');
  const [loading, setLoading] = useState(false);
  const isConverting = guestConvert && isGuest;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username || !email || !password) { toast.error(t('register.fillRequired')); return; }
    if (password.length < 8) { toast.error(t('register.passwordMin')); return; }
    setLoading(true);
    try {
      if (isConverting) {
        await convertGuest(username, email, password, bio);
        toast.success(t('register.accountCreated'));
      } else {
        await register(username, email, password, bio);
        toast.success(t('register.welcomeToAudyn'));
      }
      onBack();
    } catch (err) {
      const detail = err.response?.data?.detail;
      const msg = Array.isArray(detail) ? detail[0]?.msg : (detail || t('register.registrationFailed'));
      toast.error(msg);
    } finally { setLoading(false); }
  };

  const inputStyle = { backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' };

  return (
    <div className="min-h-[calc(100vh-48px)] flex flex-col items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm space-y-8 animate-slide-in-up">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="p-1 btn-tactile" style={{ color: 'var(--color-text-muted)' }}><ArrowLeft className="h-4 w-4" /></button>
          <h1 className="font-heading text-2xl font-extrabold" style={{ color: 'var(--color-text)' }}>
            {isConverting ? t('register.saveProgress') : t('register.title')}
          </h1>
        </div>
        {isConverting && <p className="font-body text-sm" style={{ color: 'var(--color-text-secondary)' }}>{t('register.saveProgressDesc')}</p>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="font-mono text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-dim)' }}>{t('register.username')} *</label>
            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder={t('register.usernamePlaceholder')} maxLength={30} className="w-full px-4 py-3 text-sm font-body rounded-sm outline-none" style={inputStyle} autoFocus />
          </div>
          <div className="space-y-1.5">
            <label className="font-mono text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-dim)' }}>{t('register.email')} *</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('register.emailPlaceholder')} className="w-full px-4 py-3 text-sm font-body rounded-sm outline-none" style={inputStyle} />
          </div>
          <div className="space-y-1.5">
            <label className="font-mono text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-dim)' }}>{t('register.password')} *</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('register.passwordPlaceholder')} className="w-full px-4 py-3 text-sm font-body rounded-sm outline-none" style={inputStyle} />
          </div>
          <div className="space-y-1.5">
            <label className="font-mono text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-dim)' }}>{t('register.bio')} <span style={{ color: 'var(--color-text-dim)' }}>({t('register.optional')})</span></label>
            <textarea value={bio} onChange={(e) => setBio(e.target.value)} placeholder={t('register.bioPlaceholder')} maxLength={160} rows={2} className="w-full px-4 py-3 text-sm font-body rounded-sm outline-none resize-none" style={inputStyle} />
          </div>
          <button type="submit" disabled={loading} className="w-full h-12 rounded-sm font-bold text-sm uppercase tracking-wider btn-tactile transition-all flex items-center justify-center gap-2" style={{ backgroundColor: 'var(--color-neon)', color: 'var(--color-bg)', opacity: loading ? 0.7 : 1 }}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            {loading ? t('register.creating') : isConverting ? t('register.saveAccount') : t('register.createAccount')}
          </button>
        </form>
        {!isConverting && (
          <p className="text-center font-body text-sm" style={{ color: 'var(--color-text-muted)' }}>
            {t('register.haveAccount')}{' '}
            <button onClick={onSwitchToLogin} className="font-bold btn-tactile" style={{ color: 'var(--color-neon)' }}>{t('register.logInLink')}</button>
          </p>
        )}
      </div>
    </div>
  );
}
