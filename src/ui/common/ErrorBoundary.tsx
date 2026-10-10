import { Component, type ReactNode } from 'react';
import { log } from '../../store/appStore';

/** Never leave a blank screen: show a calm fallback and retry automatically. */
export class ErrorBoundary extends Component<{ children: ReactNode; area: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  private timer: ReturnType<typeof setTimeout> | null = null;
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) {
    log('error', `${this.props.area}: ${error.message}`);
    this.timer = setTimeout(() => this.setState({ error: null }), 15000);
  }
  componentWillUnmount() { if (this.timer) clearTimeout(this.timer); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: '#062A22', color: '#F1DFA8', fontFamily: 'Cairo, Tahoma, sans-serif', direction: 'rtl', textAlign: 'center', padding: 24 }}>
        <div>
          <div style={{ fontSize: 28, fontWeight: 800 }}>حدث خلل مؤقت في العرض</div>
          <div style={{ fontSize: 16, marginTop: 8, opacity: 0.8 }}>ستُعاد المحاولة تلقائياً خلال ثوانٍ.</div>
          <button onClick={() => location.reload()} style={{ marginTop: 16, padding: '8px 20px', borderRadius: 999, border: '1px solid #D4AF61', background: 'transparent', color: '#F1DFA8', fontSize: 16, cursor: 'pointer' }}>إعادة التحميل</button>
        </div>
      </div>
    );
  }
}
