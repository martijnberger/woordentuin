import { describe, expect, it } from 'vitest';
import type { Exposure, MatchEvidence, Progress, Session, Settings, TargetLanguage, Word } from '../model';
import { seedWords } from '../content/words';
import { applyExposure, buildPracticeStats, createSession, eligibleWords, progressKey, targetLanguages, transition } from './index';

const settings: Settings = { language: 'de', chapter: 'all', timezone: 'Europe/Amsterdam' };
const at = Date.UTC(2026, 0, 1, 12);
const DAY = 86_400_000;
const word = (id: string): Word => ({ id, chapter: 'A', partOfSpeech: 'noun', forms: { nl: `nl-${id}`, de: `de-${id}` }, revision: 1, reviewed: true, enabled: true });
const evidence = (changes: Partial<MatchEvidence> = {}): MatchEvidence => ({ boardIndex: 0, boardSize: 6, attempt: 1, selectionSide: 'left', selectionOrder: 1, matchOrder: 1, assisted: false, revisit: false, selectionMs: 100, responseMs: 500, ...changes });
const event = (changes: Partial<Exposure> = {}): Exposure => ({ id: 'e', sessionId: 's', wordId: 'a', language: 'de', mode: 'match', outcome: 'correct', choicesRemaining: 4, at, revision: 1, context: evidence(), ...changes });
const practiced = (w: Word, dueAt = at - DAY, language: TargetLanguage = 'de'): Progress => ({ key: progressKey(w.id, language, 'match'), wordId: w.id, language, mode: 'match', revision: w.revision, stage: 0, dueAt, lastPracticedAt: at - 2 * DAY, lastPromotedDay: null, lastFailedDay: null, successes: 1, mistakes: 0, hints: 0 });
const history = (ws: Word[], dueAt = at - DAY): Record<string, Progress> => Object.fromEntries(ws.map((w) => [progressKey(w.id, 'de', 'match'), practiced(w, dueAt)]));
const session = (ws: Word[], progress = history(ws)): Session => createSession(ws, progress, settings, [], at, () => 0.5);
function match(input: Session, id: string, time = at): { session: Session; exposures: Exposure[] } {
  return transition(transition(input, { type: 'select', side: 'left', wordId: id }).session, { type: 'select', side: 'right', wordId: id }, time);
}

describe('spacing evidence', () => {
  it('starts at one day and promotes a due strong success only on a later day, once per day', () => {
    const first = applyExposure(undefined, event(), settings.timezone);
    expect(first.stage).toBe(0); expect(first.dueAt).toBe(at + DAY);
    const sameDay = applyExposure(first, event({ at: at + 1000 }), settings.timezone);
    expect(sameDay.stage).toBe(0); expect(sameDay.dueAt).toBe(first.dueAt);
    const later = applyExposure(sameDay, event({ at: at + DAY }), settings.timezone);
    expect(later.stage).toBe(1); expect(later.dueAt).toBe(at + 4 * DAY);
    expect(applyExposure({ ...later, dueAt: at + DAY }, event({ at: at + DAY + 1000 }), settings.timezone).stage).toBe(1);
  });
  it('does not promote low-choice, assisted, repeated, or unknown historical evidence', () => {
    const due = practiced(word('a'));
    for (const weak of [event({ choicesRemaining: 2 }), event({ context: evidence({ attempt: 2, assisted: true }) }), event({ context: evidence({ revisit: true }) }), event({ context: null })]) {
      const next = applyExposure(due, weak, settings.timezone);
      expect(next.stage).toBe(0); expect(next.dueAt).toBe(due.dueAt); expect(next.successes).toBe(due.successes);
    }
    const early = applyExposure({ ...due, dueAt: at + DAY }, event(), settings.timezone);
    expect(early.dueAt).toBe(at + DAY);
    const failed = applyExposure(due, event({ outcome: 'incorrect', context: evidence({ matchOrder: null }) }), settings.timezone);
    const corrected = applyExposure(failed, event({ at: at + 1000 }), settings.timezone);
    expect(corrected.stage).toBe(0); expect(corrected.dueAt).toBe(at + DAY); expect(due.mistakes).toBe(0);
  });
  it('uses local calendar days and keeps archived recall and revisions separate', () => {
    const beforeMidnight = Date.UTC(2026, 0, 1, 22, 30);
    const due = { ...practiced(word('a')), lastPracticedAt: beforeMidnight, dueAt: beforeMidnight + 1000 };
    expect(applyExposure(due, event({ at: beforeMidnight + 2000 }), settings.timezone).stage).toBe(0);
    expect(applyExposure(due, event({ at: beforeMidnight + 60 * 60 * 1000 }), settings.timezone).stage).toBe(1);
    const archived = applyExposure(undefined, event({ mode: 'recall', context: null, choicesRemaining: 0, outcome: 'incorrect' }), settings.timezone);
    expect(archived.mode).toBe('recall'); expect(archived.mistakes).toBe(1);
    expect(applyExposure(archived, event({ mode: 'recall', context: null, choicesRemaining: 0, at: at + DAY }), settings.timezone).stage).toBe(0);
    const revised = applyExposure(due, event({ revision: 2 }), settings.timezone);
    expect(revised.stage).toBe(0); expect(revised.revision).toBe(2);
    expect(progressKey('a', 'de', 'recall')).not.toBe(progressKey('a', 'de', 'match'));
    expect(progressKey('a', 'fr', 'match')).not.toBe(progressKey('a', 'de', 'match'));
  });
  it('does not turn slow correct answers into errors or spacing resets', () => {
    const due = { ...practiced(word('a')), stage: 2 };
    const next = applyExposure(due, event({ context: evidence({ responseMs: 120_000 }) }), settings.timezone);
    expect(next.stage).toBe(3); expect(next.mistakes).toBe(0); expect(next.dueAt).toBe(at + 14 * DAY);
  });
});

describe('matching-only sessions and exposure context', () => {
  it('handles empty and tiny decks and introduces at most six pairs', () => {
    expect(createSession([], {}, settings, [], at, () => 0).phase).toBe('results');
    const tiny = createSession([word('a')], {}, settings, [], at, () => 0);
    expect(tiny.phase).toBe('intro'); expect(tiny.newWordIds).toEqual(['a']);
    expect(tiny.boards).toHaveLength(3); expect(tiny.boards.every((board) => board.left.length === 1)).toBe(true);
    const fresh = createSession(Array.from({ length: 30 }, (_, i) => word(String(i))), {}, settings, [], at, () => 0);
    expect(fresh.newWordIds).toHaveLength(6);
    expect(fresh.boards.every((board) => board.left.length === 6 && board.right.length === 6)).toBe(true);
    expect(new Set(fresh.boards.flatMap((board) => board.left)).size).toBe(6);
  });
  it('filters unreviewed and missing translations and avoids alternate and Dutch collisions', () => {
    const a = word('a'), b = word('b'), c = word('c'), d = word('d');
    a.alternatives = { de: ['shared'] }; b.forms.de = 'shared'; c.reviewed = false; d.forms.de = '';
    expect(eligibleWords([a, b, c, d], settings)).toHaveLength(2);
    expect(session([a, b]).boards.every((board) => board.left.length === 1)).toBe(true);
    b.forms.de = 'different'; b.forms.nl = a.forms.nl;
    expect(session([a, b]).boards.every((board) => board.left.length === 1)).toBe(true);
  });
  it('skips an ambiguous priority anchor rather than shrinking an otherwise complete board', () => {
    const others = Array.from({ length: 6 }, (_, i) => word(`other-${i}`)), blocker = word('blocker');
    blocker.alternatives = { de: others.map((w) => w.forms.de!) };
    const progress = history([blocker, ...others]);
    progress[progressKey(blocker.id, 'de', 'match')].dueAt = at - 20 * DAY;
    const s = session([blocker, ...others], progress);
    expect(s.boards.every((board) => board.left.length === 6)).toBe(true);
    expect(s.boards.flatMap((board) => board.left)).not.toContain(blocker.id);
  });
  it('keeps selection transient, retains ordered unique anchors, and does not mutate inputs', () => {
    const initial = session(Array.from({ length: 8 }, (_, i) => word(String(i))));
    const [a, b] = initial.boards[0].left;
    let selected = transition(initial, { type: 'select', side: 'left', wordId: a }).session;
    expect(selected.version).toBe(initial.version); expect(initial.selection).toBeNull(); expect(initial.boards[0].selected).toEqual([]);
    selected = transition(selected, { type: 'select', side: 'left', wordId: a }).session;
    expect(selected.selection).toBeNull();
    selected = transition(selected, { type: 'select', side: 'right', wordId: b }).session;
    const resolved = transition(selected, { type: 'select', side: 'left', wordId: b, timing: { selectionMs: 120, responseMs: 450 } }, at);
    expect(resolved.session.boards[0].selected).toEqual([a, b]);
    expect(resolved.exposures[0]).toMatchObject({ choicesRemaining: 6, context: { attempt: 1, selectionSide: 'right', selectionOrder: 2, matchOrder: 1, selectionMs: 120, responseMs: 450, assisted: false, revisit: false } });
  });
  it('attributes a miss only to the anchor and keeps correction assisted after deselection and side changes', () => {
    const initial = session(Array.from({ length: 6 }, (_, i) => word(String(i))));
    const [a, b] = initial.boards[0].left;
    const selected = transition(initial, { type: 'select', side: 'left', wordId: a }).session;
    const missed = transition(selected, { type: 'select', side: 'right', wordId: b }, at);
    expect(missed.exposures).toHaveLength(1);
    expect(missed.exposures[0]).toMatchObject({ wordId: a, chosenWordId: b, outcome: 'incorrect', choicesRemaining: 6, context: { attempt: 1, matchOrder: null, selectionOrder: 1 } });
    const deselected = transition(missed.session, { type: 'select', side: 'left', wordId: a }).session;
    const reverse = transition(deselected, { type: 'select', side: 'right', wordId: a }).session;
    const fixed = transition(reverse, { type: 'select', side: 'left', wordId: a }, at);
    expect(fixed.exposures[0]).toMatchObject({ wordId: a, choicesRemaining: 6, context: { attempt: 2, assisted: true, selectionSide: 'right', selectionOrder: 1 } });
    expect(fixed.session.boards[0].attempts[a]).toBe(2); expect(fixed.session.boards[0].attempts[b]).toBeUndefined();
    expect(fixed.exposures[0].id).not.toBe(missed.exposures[0].id); expect(initial.boards[0].matched).toEqual([]);
  });
  it('never promotes a resumed known-failed anchor as a first attempt', () => {
    let s = session(Array.from({ length: 6 }, (_, i) => word(String(i))));
    const id = s.boards[0].left[0];
    s = { ...s, boards: s.boards.map((board, i) => i === 0 ? { ...board, failed: [id], attempts: { [id]: 1 } } : board) };
    const resolved = match(s, id);
    expect(resolved.exposures[0].context).toMatchObject({ attempt: 2, assisted: true, selectionMs: null, responseMs: null });
    expect(applyExposure(practiced(word(id)), resolved.exposures[0], settings.timezone).stage).toBe(0);
  });
  it('normalizes invalid and missing timing to unknown, never zero', () => {
    const s = session(Array.from({ length: 6 }, (_, i) => word(String(i)))), id = s.boards[0].left[0];
    const selected = transition(s, { type: 'select', side: 'left', wordId: id }).session;
    const invalid = transition(selected, { type: 'select', side: 'right', wordId: id, timing: { selectionMs: -1, responseMs: Number.NaN } }, at);
    expect(invalid.exposures[0].context).toMatchObject({ selectionMs: null, responseMs: null });
    const missing = transition(selected, { type: 'hint' }, at);
    expect(missing.exposures[0].context).toMatchObject({ selectionMs: null, responseMs: null, assisted: true, attempt: 1, matchOrder: 1 });
    const infinite = transition(selected, { type: 'hint', timing: { selectionMs: Number.POSITIVE_INFINITY, responseMs: 0 } }, at);
    expect(infinite.exposures[0].context).toMatchObject({ selectionMs: null, responseMs: 0 });
  });
  it('keeps last-pair evidence weaker than independent six-choice evidence', () => {
    let s = session(Array.from({ length: 6 }, (_, i) => word(String(i))));
    const ids = [...s.boards[0].left], events: Exposure[] = [];
    for (const id of ids) { const result = match(s, id); s = result.session; events.push(...result.exposures); }
    expect(events[0]).toMatchObject({ choicesRemaining: 6, context: { matchOrder: 1 } });
    expect(events[5]).toMatchObject({ choicesRemaining: 1, context: { matchOrder: 6 } });
    const stats = buildPracticeStats(s.words, {}, events, settings, at);
    expect(stats.find((pair) => pair.word.id === ids[0])?.firstTryCorrect).toBe(1);
    expect(stats.find((pair) => pair.word.id === ids[5])?.qualifyingCount).toBe(0);
  });
  it('queues early failures after intervening matches and defers late failures beyond the next board', () => {
    const ws = Array.from({ length: 18 }, (_, i) => word(String(i)));
    let s = session(ws);
    const [early, distractor] = s.boards[0].left;
    const selected = transition(s, { type: 'select', side: 'left', wordId: early }).session;
    expect(transition(selected, { type: 'select', side: 'right', wordId: distractor }, at).session.boards[1].left).toContain(early);
    for (const id of s.boards[0].left.slice(0, 5)) s = match(s, id).session;
    const late = s.boards[0].left[5];
    s = transition(s, { type: 'select', side: 'left', wordId: late }).session;
    // A hint is a completed match, but it cannot be revisited immediately.
    const hinted = transition(s, { type: 'hint' }, at).session;
    expect(hinted.boards[1].left).not.toContain(late); expect(hinted.boards[2].left).toContain(late);
    expect(hinted.boards.every((board) => board.left.length === 6 && new Set(board.left).size === 6)).toBe(true);
  });
  it('keeps six pairs after a late first-round error when no introduced replacement exists', () => {
    let s = createSession(seedWords, {}, { ...settings, language: 'mvt' }, [], at, () => 0.5);
    s = transition(s, { type: 'begin' }).session;
    const ids = [...s.boards[0].left], planned = [...s.boards[1].left];
    for (const id of ids.slice(0, 5)) s = match(s, id).session;
    s = transition(s, { type: 'select', side: 'left', wordId: ids[5] }).session;
    s = transition(s, { type: 'hint' }, at).session;
    expect(s.boards[1].left).toEqual(planned);
    expect(s.boards.every((board) => board.left.length === 6 && new Set(board.left).size === 6)).toBe(true);
    expect(s.newWordIds).toHaveLength(6);
  });
  it('keeps a hinted revisit weak even across a day boundary', () => {
    let s = session(Array.from({ length: 18 }, (_, i) => word(String(i))));
    const ids = [...s.boards[0].left], target = ids[0];
    s = transition(s, { type: 'select', side: 'left', wordId: target }).session;
    const hinted = transition(s, { type: 'hint' }, at); s = hinted.session;
    for (const id of ids.slice(1)) s = match(s, id).session;
    s = transition(s, { type: 'next-board' }).session;
    const retry = match(s, target, at + DAY);
    expect(retry.exposures[0]).toMatchObject({ choicesRemaining: 6, context: { revisit: true, assisted: true } });
    const failed = applyExposure(practiced(word(target)), hinted.exposures[0], settings.timezone);
    expect(applyExposure(failed, retry.exposures[0], settings.timezone).stage).toBe(0);
  });
  it('requires board completion and ends directly after three boards without recall evidence', () => {
    let s = createSession([word('a')], {}, settings, [], at, () => 0);
    s = transition(s, { type: 'begin' }).session;
    expect(transition(s, { type: 'next-board' }).session.phase).toBe('match');
    const events: Exposure[] = [];
    for (let i = 0; i < 3; i++) {
      const result = match(s, 'a'); events.push(...result.exposures);
      s = transition(result.session, { type: 'next-board' }).session;
    }
    expect(s.phase).toBe('results'); expect(events).toHaveLength(3);
    expect(events.every((exposure) => exposure.mode === 'match')).toBe(true);
    expect(events[1].context?.revisit).toBe(true);
  });
});

describe('three-language MVT', () => {
  it('balances French, German and Spanish, excludes English and outsider words, and keeps six anchors', () => {
    const mixed: Settings = { ...settings, language: 'mvt' };
    const s = createSession([...seedWords, word('outside')], {}, mixed, [], at, () => 0.5);
    expect(s.newWordIds).toHaveLength(6);
    expect(s.boards.every((board) => board.left.length === 6 && new Set(board.left).size === 6)).toBe(true);
    for (const board of s.boards) expect(new Set(board.left.map((id) => s.wordLanguages[id]))).toEqual(new Set(['fr', 'de', 'es']));
    expect(Object.values(s.wordLanguages)).not.toContain('en'); expect(s.words.some((item) => item.id === 'outside')).toBe(false);
    expect(Object.keys(s.wordLanguages).sort()).toEqual(s.words.map((item) => item.id).sort());
    expect(buildPracticeStats(seedWords, {}, [], mixed, at).every((stats) => stats.language !== 'en')).toBe(true);
  });
  it('reserves a rare-language anchor instead of assigning its Dutch word another language', () => {
    const ws = seedWords.filter((w) => w.forms.de && w.forms.fr && w.forms.es).slice(0, 6).map((w, i) => ({ ...w, forms: { nl: `nl-${i}`, de: `de-${i}`, es: `es-${i}`, ...(i === 0 ? { fr: 'rare-fr' } : {}) } }));
    const progress = Object.fromEntries(ws.flatMap((w, i) => (['de', 'fr', 'es'] as const).filter((language) => w.forms[language]).map((language) => {
      const prior = practiced(w, at - (i === 0 && language === 'de' ? 20 : 1) * DAY, language);
      return [prior.key, prior];
    })));
    const s = createSession(ws, progress, { ...settings, language: 'mvt' }, [], at, () => 0.5);
    expect(s.wordLanguages[ws[0].id]).toBe('fr');
    for (const board of s.boards) {
      expect(board.left).toHaveLength(6);
      expect(new Set(board.left.map((id) => s.wordLanguages[id]))).toEqual(new Set(['fr', 'de', 'es']));
    }
  });
  it('gives a weaker language more appearances without starving the other eligible languages', () => {
    const ws = seedWords.filter((w) => w.forms.de && w.forms.fr && w.forms.es).slice(0, 30).map((w, i) => ({ ...w, forms: { nl: `nl-${i}`, de: `de-${i}`, fr: `fr-${i}`, es: `es-${i}` } }));
    const progress = Object.fromEntries(ws.flatMap((w) => (['fr', 'de', 'es'] as const).map((language) => {
      const prior = practiced(w, at - DAY, language);
      return [prior.key, prior];
    })));
    const errors = ws.map((w, i) => event({ id: `de-error-${i}`, wordId: w.id, outcome: 'incorrect', context: evidence({ matchOrder: null }) }));
    const s = createSession(ws, progress, { ...settings, language: 'mvt' }, errors, at, () => 0.5);
    const languages = s.boards.flatMap((board) => board.left.map((id) => s.wordLanguages[id]));
    expect(languages.filter((language) => language === 'de').length).toBeGreaterThan(languages.filter((language) => language === 'fr').length);
    expect(languages.filter((language) => language === 'de').length).toBeGreaterThan(languages.filter((language) => language === 'es').length);
    for (const board of s.boards) expect(new Set(board.left.map((id) => s.wordLanguages[id]))).toEqual(new Set(['fr', 'de', 'es']));
  });
  it('retains independent English practice and history without English-only words entering MVT', () => {
    const english = seedWords.find((item) => item.forms.en)!;
    const englishOnly = { ...english, forms: { nl: english.forms.nl, en: 'English only' } };
    expect(targetLanguages(englishOnly, { ...settings, language: 'mvt' })).toEqual([]);
    const p = practiced(english, at - DAY, 'en');
    const s = createSession([english], { [p.key]: p }, { ...settings, language: 'en' }, [], at, () => 0.5);
    expect(s.phase).toBe('match'); expect(s.wordLanguages[english.id]).toBe('en');
    expect(buildPracticeStats([english], { [p.key]: p }, [], { ...settings, language: 'en' }, at)[0].lastPracticedAt).toBe(p.lastPracticedAt);
  });
  it('attributes errors and hints to the first-selected anchor language only', () => {
    let s = createSession(seedWords, {}, { ...settings, language: 'mvt' }, [], at, () => 0.5);
    s = transition(s, { type: 'begin' }).session;
    const [a, b] = s.boards[0].left;
    s = transition(s, { type: 'select', side: 'right', wordId: a }).session;
    const missed = transition(s, { type: 'select', side: 'left', wordId: b }, at);
    expect(missed.exposures[0]).toMatchObject({ wordId: a, chosenWordId: b, language: s.wordLanguages[a], outcome: 'incorrect' });
    const hint = transition(missed.session, { type: 'hint' }, at);
    expect(hint.exposures[0]).toMatchObject({ wordId: a, language: s.wordLanguages[a], outcome: 'hint', context: { attempt: 2, assisted: true } });
  });
  it('avoids cross-language answer collisions while adding new languages alongside due pairs', () => {
    const originals = seedWords.filter((item) => item.forms.de && item.forms.fr && item.forms.es).slice(0, 14);
    const ws = originals.map((item, index) => ({ ...item, forms: { nl: `woord-${index}`, en: 'unused', fr: index < 2 ? 'shared' : `fr-${index}`, de: index < 2 ? 'shared' : `de-${index}`, es: index < 2 ? 'shared' : `es-${index}` } }));
    const s = createSession(ws, history(ws.slice(0, 10)), { ...settings, language: 'mvt' }, [], at, () => 0.5);
    expect(s.newWordIds.length).toBeGreaterThan(0); expect(s.newWordIds.length).toBeLessThanOrEqual(6);
    expect(s.boards.every((board) => !(board.left.includes(ws[0].id) && board.left.includes(ws[1].id)))).toBe(true);
    expect(s.boards.every((board) => board.left.length === 6)).toBe(true);
  });
});

describe('adaptive allocation and recent error aging', () => {
  function pool(difficult: number): { ws: Word[]; progress: Record<string, Progress>; exposures: Exposure[] } {
    const ws = Array.from({ length: difficult + 18 }, (_, i) => word(String(i))), progress = history(ws);
    const exposures = ws.slice(0, difficult).map((w, i) => event({ id: `failure-${i}`, sessionId: `old-${i}`, wordId: w.id, outcome: 'incorrect', context: evidence({ matchOrder: null }) }));
    for (const w of ws.slice(difficult + 12)) progress[progressKey(w.id, 'de', 'match')].dueAt = at + DAY;
    return { ws, progress, exposures };
  }
  it('targets nine difficult, six other due and three familiar appearances when all categories exist', () => {
    const { ws, progress, exposures } = pool(6);
    const s = createSession(ws, progress, settings, exposures, at, () => 0.5), ids = s.boards.flatMap((board) => board.left);
    expect(ids.filter((id) => Number(id) < 6)).toHaveLength(9);
    expect(ids.filter((id) => Number(id) >= 6 && Number(id) < 18)).toHaveLength(6);
    expect(ids.filter((id) => Number(id) >= 18)).toHaveLength(3);
  });
  it('allows twelve difficult appearances but retains three other and three familiar slots', () => {
    const { ws, progress, exposures } = pool(12);
    const s = createSession(ws, progress, settings, exposures, at, () => 0.5), ids = s.boards.flatMap((board) => board.left);
    expect(ids.filter((id) => Number(id) < 12)).toHaveLength(12);
    expect(ids.filter((id) => Number(id) >= 12 && Number(id) < 24)).toHaveLength(3);
    expect(ids.filter((id) => Number(id) >= 24)).toHaveLength(3);
  });
  it('keeps a recently missed future-due pair in practice ahead of clean familiar peers', () => {
    const ws = Array.from({ length: 30 }, (_, i) => word(String(i))), p = history(ws, at + 20 * DAY);
    const errors = [event({ wordId: ws[29].id, outcome: 'incorrect', context: evidence({ matchOrder: null }) })];
    const s = createSession(ws, p, settings, errors, at, () => 0.5);
    expect(s.boards.flatMap((board) => board.left).filter((id) => id === ws[29].id).length).toBeGreaterThanOrEqual(2);
  });
  it('ages lifetime errors out after ten meaningful independent boards', () => {
    const w = word('a'), p = { ...practiced(w, at + DAY), mistakes: 100, lastFailedDay: '2025-12-31' };
    const errors = [event({ id: 'old', outcome: 'incorrect', at: at - 20 * DAY, context: evidence({ matchOrder: null }) })];
    const successes = Array.from({ length: 10 }, (_, i) => event({ id: `good-${i}`, sessionId: `day-${i}`, at: at + i * DAY }));
    const recent = buildPracticeStats([w], { [p.key]: p }, [...errors, ...successes], settings, at + 10 * DAY)[0];
    expect(recent.sampleCount).toBe(10); expect(recent.mistakes).toBe(0); expect(recent.label).toBe('Gaat goed');
    expect(p.mistakes).toBe(100);
    const ws = [w, ...Array.from({ length: 20 }, (_, i) => word(`other-${i}`))], progress = { ...history(ws, at + DAY), [p.key]: p };
    const s = createSession(ws, progress, settings, [...errors, ...successes], at + DAY / 2, () => 0.5);
    expect(s.boards.flatMap((board) => board.left).filter((id) => id === w.id).length).toBeLessThanOrEqual(1);
  });
});
