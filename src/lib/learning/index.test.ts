import { describe, expect, it } from 'vitest';
import type { Exposure, Progress, Settings, Word } from '../model';
import { applyExposure, createSession, eligibleWords, progressKey, transition } from './index';

const settings: Settings = { language: 'de', chapter: 'all', timezone: 'Europe/Amsterdam' };
const at = Date.UTC(2026, 0, 1, 12);
const DAY = 86_400_000;
const word = (id: string): Word => ({ id, chapter: 'A', partOfSpeech: 'noun', forms: { nl: `nl-${id}`, de: `de-${id}` }, revision: 1, reviewed: true, enabled: true });
const event = (changes: Partial<Exposure> = {}): Exposure => ({ id: 'e', sessionId: 's', wordId: 'a', language: 'de', mode: 'match', outcome: 'correct', choicesRemaining: 4, at, revision: 1, ...changes });
const practiced = (w: Word, dueAt = at - DAY): Progress => ({ key: progressKey(w.id, 'de', 'match'), wordId: w.id, language: 'de', mode: 'match', revision: 1, stage: 0, dueAt, lastPracticedAt: at - 2 * DAY, lastPromotedDay: null, lastFailedDay: null, successes: 1, mistakes: 0, hints: 0 });

describe('spacing evidence', () => {
  it('introduces at one day and promotes only a due, strong success on a later day', () => {
    const first = applyExposure(undefined, event(), settings.timezone);
    expect(first.stage).toBe(0); expect(first.dueAt).toBe(at + DAY);
    const sameDay = applyExposure(first, event({ at: at + 1000 }), settings.timezone);
    expect(sameDay.stage).toBe(0); expect(sameDay.dueAt).toBe(first.dueAt);
    const later = applyExposure(sameDay, event({ at: at + DAY }), settings.timezone);
    expect(later.stage).toBe(1); expect(later.dueAt).toBe(at + 4 * DAY);
    expect(applyExposure(later, event({ at: at + DAY + 1000 }), settings.timezone).stage).toBe(1);
  });
  it('does not postpone due words on early or weak success, and failure blocks same-day promotion', () => {
    const w = word('a'); const due = practiced(w);
    const weak = applyExposure(due, event({ choicesRemaining: 2 }), settings.timezone);
    expect(weak.stage).toBe(0); expect(weak.dueAt).toBe(due.dueAt);
    const early = applyExposure({ ...due, dueAt: at + DAY }, event(), settings.timezone);
    expect(early.dueAt).toBe(at + DAY);
    const failed = applyExposure(due, event({ outcome: 'incorrect' }), settings.timezone);
    const corrected = applyExposure(failed, event({ at: at + 1000 }), settings.timezone);
    expect(corrected.stage).toBe(0); expect(corrected.dueAt).toBe(at + DAY);
    expect(due.mistakes).toBe(0);
  });
  it('uses local calendar days and separates recall and revisions', () => {
    const beforeMidnight = Date.UTC(2026, 0, 1, 22, 30);
    const first = applyExposure(undefined, event({ at: beforeMidnight, mode: 'recall' }), settings.timezone);
    const next = applyExposure(first, event({ at: beforeMidnight + DAY, mode: 'recall', choicesRemaining: 0 }), settings.timezone);
    expect(next.stage).toBe(1);
    const revised = applyExposure(next, event({ at: beforeMidnight + 2 * DAY, mode: 'recall', revision: 2 }), settings.timezone);
    expect(revised.stage).toBe(0); expect(revised.revision).toBe(2);
    expect(progressKey('a', 'de', 'recall')).not.toBe(progressKey('a', 'de', 'match'));
    expect(progressKey('a', 'fr', 'match')).not.toBe(progressKey('a', 'de', 'match'));
  });
});
describe('sessions', () => {
  it('handles empty and tiny decks and never introduces more than two', () => {
    expect(createSession([], {}, settings, at, () => 0).phase).toBe('results');
    const s = createSession([word('a')], {}, settings, at, () => 0);
    expect(s.phase).toBe('intro'); expect(s.newWordIds).toEqual(['a']);
    expect(s.boards.every((b) => b.left.length === 1)).toBe(true);
    expect(createSession(Array.from({ length: 8 }, (_, i) => word(String(i))), {}, settings, at, () => 0).newWordIds).toHaveLength(2);
  });
  it('filters unreviewed and missing translations and avoids alternate collisions', () => {
    const a = word('a'), b = word('b'), c = word('c');
    a.alternatives = { de: ['shared'] }; b.forms.de = 'shared';
    c.reviewed = false;
    expect(eligibleWords([a, b, c], settings)).toHaveLength(2);
    const s = createSession([a, b], {}, settings, at, () => 0);
    expect(s.boards.every((board) => board.left.length === 1)).toBe(true);
  });
  it('prioritizes due words, does not mutate inputs and keeps selection transient', () => {
    const ws = Array.from({ length: 14 }, (_, i) => word(String(i)));
    const progress = Object.fromEntries(ws.slice(0, 12).map((w) => [progressKey(w.id, 'de', 'match'), practiced(w)]));
    const s = createSession(ws, progress, settings, at, () => 0);
    expect(s.newWordIds).toEqual([]); expect(s.phase).toBe('match');
    const id = s.boards[0].left[0];
    const selected = transition(s, { type: 'select', side: 'left', wordId: id }, at).session;
    expect(selected.version).toBe(s.version); expect(s.selection).toBeNull();
    expect(transition(selected, { type: 'select', side: 'left', wordId: id }, at).session.selection).toBeNull();
  });
  it('includes overdue recall independently of recognition boards without introducing extra words', () => {
    const ws = Array.from({ length: 13 }, (_, i) => word(String(i)));
    const progress = Object.fromEntries(ws.map((w) => [progressKey(w.id, 'de', 'match'), practiced(w)]));
    const target = ws[12];
    progress[progressKey(target.id, 'de', 'match')] = { ...practiced(target, at + 30 * DAY), stage: 4 };
    progress[progressKey(target.id, 'de', 'recall')] = { ...practiced(target, at - DAY), key: progressKey(target.id, 'de', 'recall'), mode: 'recall', lastFailedDay: '2025-12-31' };
    const s = createSession(ws, progress, settings, at, () => 0);
    expect(s.boards.flatMap((b) => b.left)).not.toContain(target.id);
    expect(s.recallWordIds[0]).toBe(target.id);
    expect(s.words.some((w) => w.id === target.id)).toBe(true);
    expect(s.newWordIds).toHaveLength(0);
  });
  it('removes a premature natural repeat if a later board allows three other completions', () => {
    const ws = Array.from({ length: 4 }, (_, i) => word(String(i)));
    const progress = Object.fromEntries(ws.map((w) => [progressKey(w.id, 'de', 'match'), practiced(w)]));
    let s = createSession(ws, progress, settings, at, () => 0);
    const ids = [...s.boards[0].left], target = ids[0];
    for (const id of ids.slice(1, 3)) {
      s = transition(s, { type: 'select', side: 'left', wordId: id }).session;
      s = transition(s, { type: 'select', side: 'right', wordId: id }, at).session;
    }
    s = transition(s, { type: 'select', side: 'left', wordId: target }).session;
    s = transition(s, { type: 'select', side: 'right', wordId: ids[3] }, at).session;
    expect(s.boards[1].left).not.toContain(target);
    expect(s.boards[2].left).toContain(target);
  });
  it('attributes a miss only to the anchor and correction remains weak from either side', () => {
    const ws = Array.from({ length: 4 }, (_, i) => word(String(i)));
    const progress = Object.fromEntries(ws.map((w) => [progressKey(w.id, 'de', 'match'), practiced(w)]));
    const s = createSession(ws, progress, settings, at, () => 0);
    const [a, b] = s.boards[0].left;
    const selected = transition(s, { type: 'select', side: 'left', wordId: a }).session;
    const missed = transition(selected, { type: 'select', side: 'right', wordId: b }, at);
    expect(missed.exposures).toHaveLength(1); expect(missed.exposures[0]).toMatchObject({ wordId: a, chosenWordId: b, outcome: 'incorrect' });
    const deselected = transition(missed.session, { type: 'select', side: 'left', wordId: a }).session;
    const reverse = transition(deselected, { type: 'select', side: 'right', wordId: a }).session;
    const fixed = transition(reverse, { type: 'select', side: 'left', wordId: a }, at);
    expect(fixed.exposures[0]).toMatchObject({ wordId: a, outcome: 'correct', choicesRemaining: 0 });
    expect(fixed.exposures[0].id).not.toBe(missed.exposures[0].id);
    expect(s.boards[0].matched).toEqual([]);
  });
  it('queues a failed pair after three intervening completions where possible', () => {
    const ws = Array.from({ length: 12 }, (_, i) => word(String(i)));
    const progress = Object.fromEntries(ws.map((w) => [progressKey(w.id, 'de', 'match'), practiced(w)]));
    const s = createSession(ws, progress, settings, at, () => 0);
    const [a, b] = s.boards[0].left;
    const selected = transition(s, { type: 'select', side: 'left', wordId: a }).session;
    const missed = transition(selected, { type: 'select', side: 'right', wordId: b }, at).session;
    expect(missed.boards[1].left).toContain(a);
  });
  it('keeps a hinted retry weak even when the session crosses a day boundary', () => {
    const ws = Array.from({ length: 12 }, (_, i) => word(String(i)));
    const progress = Object.fromEntries(ws.map((w) => [progressKey(w.id, 'de', 'match'), practiced(w)]));
    let s = createSession(ws, progress, settings, at, () => 0);
    const ids = [...s.boards[0].left], target = ids[0];
    s = transition(s, { type: 'select', side: 'left', wordId: target }).session;
    const hint = transition(s, { type: 'hint' }, at);
    expect(hint.exposures[0]).toMatchObject({ wordId: target, outcome: 'hint' });
    s = hint.session;
    for (const id of ids.slice(1)) {
      s = transition(s, { type: 'select', side: 'left', wordId: id }).session;
      s = transition(s, { type: 'select', side: 'right', wordId: id }, at).session;
    }
    s = transition(s, { type: 'next-board' }).session;
    s = transition(s, { type: 'select', side: 'right', wordId: target }).session;
    const retry = transition(s, { type: 'select', side: 'left', wordId: target }, at + DAY);
    expect(retry.exposures[0]).toMatchObject({ outcome: 'correct', choicesRemaining: 0 });
    expect(applyExposure(applyExposure(progress[progressKey(target, 'de', 'match')], hint.exposures[0], settings.timezone), retry.exposures[0], settings.timezone).stage).toBe(0);
  });
  it('requires board completion and keeps recall self-report distinct; skipping creates no evidence', () => {
    let s = createSession([word('a')], {}, settings, at, () => 0);
    s = transition(s, { type: 'begin' }).session;
    expect(transition(s, { type: 'next-board' }).session.phase).toBe('match');
    for (let i = 0; i < 3; i++) {
      s = transition(s, { type: 'select', side: 'left', wordId: 'a' }).session;
      const matched = transition(s, { type: 'select', side: 'right', wordId: 'a' }, at);
      expect(matched.exposures[0].choicesRemaining).toBe(1);
      s = transition(matched.session, { type: 'next-board' }).session;
    }
    expect(s.phase).toBe('recall');
    const recalled = transition(s, { type: 'recall', known: true }, at);
    expect(recalled.exposures[0]).toMatchObject({ mode: 'recall', outcome: 'correct' });
    expect(recalled.session.phase).toBe('results');
    expect(transition(s, { type: 'skip-recall' }).exposures).toEqual([]);
  });
});
