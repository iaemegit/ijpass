import { useEffect, useRef, useState } from 'react';

type Grecaptcha = {
  render: (container: HTMLElement, options: {
    sitekey: string;
    callback: (token: string) => void;
    'expired-callback': () => void;
    'error-callback': () => void;
  }) => number;
  reset: (widgetId?: number) => void;
};

declare global {
  interface Window {
    grecaptcha?: Grecaptcha;
    ijpassRecaptchaReady?: () => void;
  }
}

const scriptId = 'google-recaptcha-script';
let recaptchaPromise: Promise<Grecaptcha> | null = null;

function loadRecaptcha() {
  if (window.grecaptcha) return Promise.resolve(window.grecaptcha);
  if (recaptchaPromise) return recaptchaPromise;

  recaptchaPromise = new Promise<Grecaptcha>((resolve, reject) => {
    const ready = () => {
      if (window.grecaptcha) resolve(window.grecaptcha);
      else {
        recaptchaPromise = null;
        reject(new Error('Google reCAPTCHA did not initialize'));
      }
    };
    const failed = () => reject(new Error('Google reCAPTCHA could not be loaded'));
    const existing = document.getElementById(scriptId) as HTMLScriptElement | null;

    if (existing) {
      existing.addEventListener('error', failed, { once: true });
      return;
    }

    window.ijpassRecaptchaReady = ready;
    const script = document.createElement('script');
    script.id = scriptId;
    script.src = 'https://www.google.com/recaptcha/api.js?onload=ijpassRecaptchaReady&render=explicit';
    script.async = true;
    script.defer = true;
    script.addEventListener('error', () => {
      recaptchaPromise = null;
      failed();
    }, { once: true });
    document.head.appendChild(script);
  });

  return recaptchaPromise;
}

export default function Recaptcha({ onChange }: { onChange: (token: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loadError, setLoadError] = useState('');
  const siteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY?.trim();

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    if (!siteKey) {
      setLoadError('reCAPTCHA has not been configured.');
      return;
    }

    let cancelled = false;
    let widgetId: number | undefined;
    const widgetHost = document.createElement('div');
    root.replaceChildren(widgetHost);

    void loadRecaptcha()
      .then(grecaptcha => {
        if (cancelled) return;
        widgetId = grecaptcha.render(widgetHost, {
          sitekey: siteKey,
          callback: token => { setLoadError(''); onChange(token); },
          'expired-callback': () => onChange(''),
          'error-callback': () => { onChange(''); setLoadError('reCAPTCHA could not connect. Please try again.'); }
        });
      })
      .catch(() => { if (!cancelled) setLoadError('reCAPTCHA could not load. Check your internet connection.'); });

    return () => {
      cancelled = true;
      if (widgetId !== undefined) window.grecaptcha?.reset(widgetId);
      root.replaceChildren();
    };
  }, [onChange, siteKey]);

  return <div className="recaptcha-field">
    <div ref={containerRef} className="recaptcha-widget" />
    {loadError && <div className="text-danger small mt-2" role="alert">{loadError}</div>}
  </div>;
}
