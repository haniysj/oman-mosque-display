import { describe, expect, it } from 'vitest';
import { adhkarAt } from './engine';
import { parseSeconds } from '../ui/admin/OtherSections';
import type { AdhkarItem } from '../domain/types';

const item = (id: string, seconds: number | null): AdhkarItem => ({ id, text: id, category: '', source: '', seconds, enabled: true, order: 0 });

describe('per-dhikr display lengths', () => {
  it('each dhikr keeps its own length (any number), others use the default', () => {
    const list = [item('a', 7), item('b', null), item('c', 13)];
    const t0 = 0;
    expect(adhkarAt(list, 20, t0, 6_999).item?.id).toBe('a');
    expect(adhkarAt(list, 20, t0, 7_000).item?.id).toBe('b');
    expect(adhkarAt(list, 20, t0, 26_999).item?.id).toBe('b');
    expect(adhkarAt(list, 20, t0, 27_000).item?.id).toBe('c');
    expect(adhkarAt(list, 20, t0, 40_000).item?.id).toBe('a'); // 7 + 20 + 13 = 40 → cycle
  });
  it('a short dhikr (e.g. 3 s) is allowed; the default is never below 5 s', () => {
    expect(adhkarAt([item('a', 3), item('b', 3)], 60, 0, 3_000).item?.id).toBe('b');
    expect(adhkarAt([item('a', null), item('b', null)], 2, 0, 4_999).item?.id).toBe('a');
  });
  it('reads any number typed (Arabic digits, decimals); empty = default', () => {
    expect(parseSeconds('17')).toBe(17);
    expect(parseSeconds('٢٣')).toBe(23);
    expect(parseSeconds('7.5')).toBe(7.5);
    expect(parseSeconds('')).toBeNull();
    expect(parseSeconds('abc')).toBeUndefined();
    expect(parseSeconds('0')).toBeUndefined();
  });
});
