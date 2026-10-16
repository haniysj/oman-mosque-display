import { describe, expect, it } from 'vitest';
import { adhkarForSlot, groupIdOf } from './engine';
import { defaultAdhkar, defaultAdhkarGroups } from '../domain/defaults';
import type { AdhkarItem } from '../domain/types';

const item = (id: string, groupId: string | undefined, order: number, category = ''): AdhkarItem =>
  ({ id, text: id, category, source: '', seconds: null, enabled: true, order, ...(groupId ? { groupId } : {}) });

describe('adhkar groups', () => {
  const groups = defaultAdhkarGroups();
  const list = [item('m1', 'morning', 0), item('a1', 'after', 1), item('e1', 'evening', 2), item('a2', 'after', 3), item('m2', 'morning', 4)];

  it('after Fajr: after-prayer group first, then morning — each in its own order', () => {
    expect(adhkarForSlot(list, groups, 'fajr').map((a) => a.id)).toEqual(['a1', 'a2', 'm1', 'm2']);
  });
  it('after Asr: after-prayer then evening; after Dhuhr: after-prayer only', () => {
    expect(adhkarForSlot(list, groups, 'asr').map((a) => a.id)).toEqual(['a1', 'a2', 'e1']);
    expect(adhkarForSlot(list, groups, 'dhuhr').map((a) => a.id)).toEqual(['a1', 'a2']);
  });
  it('group order is respected and the title is the group name', () => {
    const swapped = [groups[1], groups[0], groups[2]];
    const r = adhkarForSlot(list, swapped, 'fajr');
    expect(r.map((a) => a.id)).toEqual(['m1', 'm2', 'a1', 'a2']);
    expect(r[0].category).toBe('أذكار الصباح');
    expect(r.map((a) => a.order)).toEqual([0, 1, 2, 3]);
  });
  it('disabled group / disabled items are skipped', () => {
    const g = groups.map((x) => (x.id === 'morning' ? { ...x, enabled: false } : x));
    expect(adhkarForSlot(list, g, 'fajr').map((a) => a.id)).toEqual(['a1', 'a2']);
    expect(adhkarForSlot(list.map((a) => (a.id === 'a1' ? { ...a, enabled: false } : a)), groups, 'dhuhr').map((a) => a.id)).toEqual(['a2']);
  });
  it('older items without groupId are placed by their category', () => {
    expect(groupIdOf(item('x', undefined, 0, 'أذكار الصباح'), groups)).toBe('morning');
    expect(groupIdOf(item('y', undefined, 0, 'أذكار المساء'), groups)).toBe('evening');
    expect(groupIdOf(item('z', undefined, 0, 'آية الكرسي'), groups)).toBe('after');
  });
  it('defaults: Friday prayer shows the after-prayer group', () => {
    const r = adhkarForSlot(defaultAdhkar(), groups, 'jumuah');
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((a) => a.category === 'أذكار بعد الصلاة')).toBe(true);
  });
});
