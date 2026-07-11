import { useState, useRef, useEffect } from 'react';
import { Globe } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';

const LANG_FLAGS = {
  en: '🇬🇧',
  hi: '🇮🇳',
  es: '🇪🇸',
  ja: '🇯🇵',
  ko: '🇰🇷',
};

export default function LanguageSwitcher() {
  const { language, setLanguage, t, languages } = useLanguage();
  const [open, setOpen] = useState(false);
  const [focusedLanguage, setFocusedLanguage] = useState(language);
  const ref = useRef(null);
  const toggleRef = useRef(null);
  const optionRefs = useRef({});

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const nextLanguage = languages.includes(focusedLanguage) ? focusedLanguage : language;
    setFocusedLanguage(nextLanguage);
    window.requestAnimationFrame(() => optionRefs.current[nextLanguage]?.focus());
  }, [focusedLanguage, language, languages, open]);

  const focusToggle = () => {
    window.requestAnimationFrame(() => toggleRef.current?.focus());
  };

  const handleMenuKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      focusToggle();
      return;
    }

    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;

    e.preventDefault();
    if (!languages.length) return;
    const currentIndex = languages.indexOf(focusedLanguage);
    const fallbackIndex = Math.max(languages.indexOf(language), 0);
    const activeIndex = currentIndex >= 0 ? currentIndex : fallbackIndex;
    const direction = e.key === 'ArrowDown' ? 1 : -1;
    const nextIndex = (activeIndex + direction + languages.length) % languages.length;
    const nextLanguage = languages[nextIndex];
    setFocusedLanguage(nextLanguage);
    optionRefs.current[nextLanguage]?.focus();
  };

  const handleSelect = (lang) => {
    setLanguage(lang);
    setOpen(false);
    focusToggle();
  };

  return (
    <div
      ref={ref}
      className="z-50"
      style={{
        position: 'fixed',
        bottom: '1rem',
        right: '1rem',
        pointerEvents: 'auto',
      }}
    >
      {}
      {open && (
        <div
          className="absolute bottom-full right-0 mb-2 rounded-sm overflow-hidden animate-slide-in-up"
          role="menu"
          aria-label="Language options"
          onKeyDown={handleMenuKeyDown}
          style={{
            backgroundColor: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            boxShadow: '0 -4px 20px rgba(0,0,0,0.3)',
            minWidth: '140px',
          }}
        >
          {languages.map((lang) => (
            <button
              key={lang}
              ref={(node) => {
                if (node) optionRefs.current[lang] = node;
                else delete optionRefs.current[lang];
              }}
              onClick={() => handleSelect(lang)}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors btn-tactile"
              role="menuitemradio"
              aria-checked={language === lang}
              tabIndex={focusedLanguage === lang ? 0 : -1}
              style={{
                backgroundColor: language === lang ? 'var(--color-neon-subtle)' : 'transparent',
                borderBottom: '1px solid var(--color-border-subtle)',
                color: language === lang ? 'var(--color-neon)' : 'var(--color-text)',
              }}
              onMouseEnter={(e) => {
                if (language !== lang) e.currentTarget.style.backgroundColor = 'var(--color-surface-hl)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = language === lang ? 'var(--color-neon-subtle)' : 'transparent';
              }}
            >
              <span className="text-base">{LANG_FLAGS[lang]}</span>
              <span className="font-mono text-xs">{t(`languages.${lang}`)}</span>
              {language === lang && (
                <span className="ml-auto text-[10px]" style={{ color: 'var(--color-neon)' }}>✓</span>
              )}
            </button>
          ))}
        </div>
      )}

      {}
      <button
        ref={toggleRef}
        onClick={() => {
          setFocusedLanguage(language);
          setOpen(!open);
        }}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm transition-all btn-tactile"
        style={{
          backgroundColor: open ? 'var(--color-neon-subtle)' : 'var(--color-surface)',
          border: `1px solid ${open ? 'var(--color-neon-dim)' : 'var(--color-border)'}`,
          color: open ? 'var(--color-neon)' : 'var(--color-text-muted)',
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
        }}
        aria-label="Change language"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Change language"
      >
        <Globe className="h-3.5 w-3.5" />
        <span className="font-mono text-[10px] uppercase tracking-wider">
          {LANG_FLAGS[language]} {language.toUpperCase()}
        </span>
      </button>
    </div>
  );
}
