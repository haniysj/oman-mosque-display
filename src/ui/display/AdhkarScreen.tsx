import type { AppConfig } from '../../domain/types';
import type { DisplayState } from '../../core/engine';
import { formatClock, toDigits } from '../../core/time';
import { FitText } from './parts';

export function AdhkarScreen({ state, cfg }: { state: DisplayState; cfg: AppConfig }) {
  const item = state.adhkarItem;
  const d = cfg.display;
  const clock = formatClock(state.parts.hour * 60 + state.parts.minute, 0, d.timeFormat, d.digits);
  const len = item?.text.length ?? 0;
  const base = len > 300 ? 64 : len > 160 ? 76 : 92;
  return (
    <div className="adhkar" role="region" aria-label="الأذكار">
      <div className="adhkar-top">
        <span className="adhkar-clock"><bdi>{clock.text}</bdi></span>
        <span className="adhkar-title">{item?.category || 'أذكار بعد الصلاة'}</span>
      </div>
      {item ? (
        <div key={item.id} className="adhkar-body">
          <FitText text={item.text} base={base} min={40} lines={7} className="adhkar-text" lh={1.8} />
          {item.source && <div className="adhkar-source">{item.source}</div>}
        </div>
      ) : <div className="adhkar-body" />}
      {state.adhkarCount > 1 && (
        <div className="adhkar-dots" aria-label={`الذكر ${toDigits(state.adhkarIndex + 1, d.digits)} من ${toDigits(state.adhkarCount, d.digits)}`}>
          {Array.from({ length: state.adhkarCount }, (_, i) => <span key={i} className={i === state.adhkarIndex ? 'on' : ''} />)}
        </div>
      )}
    </div>
  );
}
