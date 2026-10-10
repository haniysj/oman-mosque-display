import { useCallback, useEffect, useState } from 'react';
import { useApp } from './store/appStore';
import { DisplayScreen } from './ui/display/DisplayScreen';
import { Admin } from './ui/admin/Admin';
import { Preview } from './ui/display/Preview';
import { ErrorBoundary } from './ui/common/ErrorBoundary';

function useHash() {
  const [h, setH] = useState(location.hash);
  useEffect(() => { const f = () => setH(location.hash); window.addEventListener('hashchange', f); return () => window.removeEventListener('hashchange', f); }, []);
  return h;
}

export default function App() {
  const loaded = useApp((s) => s.loaded);
  const loadError = useApp((s) => s.loadError);
  const hash = useHash();
  const adminOpen = hash.startsWith('#/admin');
  const openAdmin = useCallback(() => { location.hash = '#/admin'; }, []);
  const closeAdmin = useCallback(() => { history.replaceState(null, '', location.pathname + location.search); window.dispatchEvent(new HashChangeEvent('hashchange')); }, []);

  if (hash.startsWith('#/preview')) return <Preview />;
  if (!loaded) return <div className="fixed inset-0 bg-[#062A22]" aria-busy />;
  return (
    <>
      <ErrorBoundary area="display"><DisplayScreen onOpenAdmin={openAdmin} adminOpen={adminOpen} /></ErrorBoundary>
      {adminOpen && <ErrorBoundary area="admin"><Admin onClose={closeAdmin} /></ErrorBoundary>}
      {loadError && !adminOpen && (
        <div style={{ position: 'fixed', bottom: 8, left: 8, zIndex: 40, background: '#C2453A', color: '#fff', borderRadius: 999, padding: '4px 12px', fontSize: 13, fontFamily: 'Cairo' }}>
          تعذّر الوصول إلى التخزين المحلي — الإعدادات لن تُحفظ في هذا المتصفح
        </div>
      )}
    </>
  );
}
