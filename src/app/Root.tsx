import { useEffect, useState } from 'react';
import { store, useReady, useSnapshot } from '../lib/store';
import { Onboarding } from './Onboarding';
import { Shell } from './Shell';
import { Display } from '../display/Display';

const route = () => location.hash.match(/^#\/display\/([\w-]+)/)?.[1] ?? null;

export function Root() {
  const [token, setToken] = useState(route());
  useEffect(() => {
    const f = () => setToken(route());
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  useEffect(() => { void store.init(); }, []);
  if (token) return <Display token={token} />;
  return <AppMain />;
}

function AppMain() {
  const ready = useReady();
  const snap = useSnapshot();
  if (!ready) return <div className="onb"><p>Lädt …</p></div>;
  if (!snap.family || !snap.me) return <Onboarding />;
  return <Shell />;
}
