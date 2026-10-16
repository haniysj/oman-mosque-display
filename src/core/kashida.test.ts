import { describe, expect, it } from 'vitest';
import { addKashida } from './kashida';

describe('kashida (الحروف المرسلة)', () => {
  it('stretches before round final letters', () => {
    expect(addKashida('يكتبه')).toBe('يكتبـــه');
    expect(addKashida('من')).toBe('مـــن');
    expect(addKashida('يُجمّل')).toBe('يُجمّـــل');
    expect(addKashida('الأولى')).toBe('الأولـــى');
  });
  it('leaves other words alone', () => {
    expect(addKashida('الله أكبر')).toBe('الله أكبر');
    expect(addKashida('والحمدُ لله')).toBe('والحمدُ لله');
    expect(addKashida('ترتاح')).toBe('ترتاح');
    expect(addKashida('له')).toBe('له');
    expect(addKashida('الدار')).toBe('الدار');
  });
  it('never touches Qur\'anic text', () => {
    const q = 'اللَّهُ لَا إِلَٰهَ إِلَّا هُوَ ۚ لَّهُ مَا فِي السَّمَاوَاتِ';
    expect(addKashida(q)).toBe(q);
  });
});
