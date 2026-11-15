import { describe, expect, it } from 'vitest';
import type { Exposure, MatchEvidence, Progress, Settings, TargetLanguage, Word } from '../model';
import { buildPracticeStats, progressKey } from './index';

const at = Date.UTC(2026, 0, 1, 12), DAY = 86_400_000;
const settings: Settings = { language: 'de', chapter: 'all', timezone: 'Europe/Amsterdam' };
const word = (id: string): Word => ({ id, chapter: 'A', partOfSpeech: 'noun', forms: { nl: `nl-${id}`, de: `de-${id}`, fr: `fr-${id}`, en: `en-${id}` }, revision: 1, reviewed: true, enabled: true });
function sample(wordId: string, ordinal: number, changes: Partial<Exposure> = {}, context: Partial<MatchEvidence> = {}): Exposure {
  return { id: `${wordId}-${ordinal}`, sessionId: `session-${ordinal}`, wordId, language: 'de', mode: 'match', outcome: 'correct', choicesRemaining: 4, at: at + ordinal * DAY, revision: 1, context: { boardIndex: 0, boardSize: 6, attempt: 1, selectionSide: 'left', selectionOrder: 2, matchOrder: 3, assisted: false, revisit: false, selectionMs: 100, responseMs: 500, ...context }, ...changes };
}
const stats = (events: Exposure[]) => buildPracticeStats([word('a')], {}, events, settings, at + 30 * DAY)[0];
function baseline(language: TargetLanguage = 'de', choicesRemaining = 4): { words: Word[]; events: Exposure[] } {
  const words = Array.from({ length: 8 }, (_, i) => word(`base-${i}`));
  const events = words.flatMap((w) => Array.from({ length: 3 }, (_, i) => sample(w.id, i, { language, choicesRemaining })));
  return { words, events };
}

describe('recent board evidence', () => {
  it('counts one board sample for several errors, a hint and correction, without erasing mistakes', () => {
    const events = [sample('a', 0, { outcome: 'incorrect' }, { matchOrder: null }), sample('a', 0, { id: 'miss-2', outcome: 'incorrect' }, { attempt: 2, assisted: true, matchOrder: null }), sample('a', 0, { id: 'hint', outcome: 'hint' }, { attempt: 3, assisted: true }), sample('a', 0, { id: 'correction' }, { attempt: 4, assisted: true })];
    const result = stats(events);
    expect(result.sampleCount).toBe(1); expect(result.qualifyingCount).toBe(1); expect(result.firstTryCorrect).toBe(0);
    expect(result.mistakes).toBe(2); expect(result.hints).toBe(1); expect(result.label).toBe('Extra oefenen'); expect(result.responseMs).toBeNull();
  });
  it('retains only the last ten distinct boards, not the last ten clicks', () => {
    const events = Array.from({ length: 11 }, (_, i) => sample('a', i));
    events[0] = sample('a', 0, { outcome: 'incorrect' }, { matchOrder: null });
    const result = stats(events);
    expect(result.sampleCount).toBe(10); expect(result.qualifyingCount).toBe(10); expect(result.firstTryCorrect).toBe(10); expect(result.mistakes).toBe(0);
    const sameTime = events.map((event) => ({ ...event, at }));
    expect(stats(sameTime).mistakes).toBe(0);
    expect(stats([...events, ...events]).sampleCount).toBe(10);
  });
  it('separates boards within one session and excludes old revisions, other languages and recall', () => {
    const events = [sample('a', 0), sample('a', 0, { id: 'second-board' }, { boardIndex: 1, revisit: true }), sample('a', 3, { language: 'fr' }), sample('a', 4, { revision: 2 }), sample('a', 5, { mode: 'recall', context: null, choicesRemaining: 0 })];
    const result = stats(events);
    expect(result.sampleCount).toBe(2); expect(result.qualifyingCount).toBe(1); expect(result.firstTryCorrect).toBe(1);
    expect(result.lastPracticedAt).toBe(at);
    expect(buildPracticeStats([word('a')], {}, events, { ...settings, language: 'fr' }, at)[0].sampleCount).toBe(1);
    expect(buildPracticeStats([{ ...word('a'), revision: 2 }], {}, events, settings, at)[0].sampleCount).toBe(1);
  });
  it('reports unknown for legacy timing/order and preserves lifetime scheduling context', () => {
    const w = word('a');
    const p: Progress = { key: progressKey(w.id, 'de', 'match'), wordId: w.id, language: 'de', mode: 'match', revision: 1, stage: 2, dueAt: at + DAY, lastPracticedAt: at, lastPromotedDay: null, lastFailedDay: '2025-12-31', successes: 9, mistakes: 4, hints: 2 };
    const result = buildPracticeStats([w], { [p.key]: p }, [sample('a', 0, { context: null }), sample('a', 1, { context: null, choicesRemaining: 0 })], settings, at)[0];
    expect(result.sampleCount).toBe(0); expect(result.qualifyingCount).toBe(0); expect(result.mistakes).toBe(0); expect(result.hints).toBe(0);
    expect(result.responseMs).toBeNull(); expect(result.averageSelectionOrder).toBeNull(); expect(result.averageMatchOrder).toBeNull(); expect(result.averageBoardSize).toBeNull(); expect(result.speed).toBe('unknown');
    expect(result.label).toBe('Extra oefenen'); expect(result.dueAt).toBe(p.dueAt); expect(result.lastPracticedAt).toBe(at + DAY);
    expect(p.mistakes).toBe(4);
  });
  it('counts low-choice failures but does not mistake elimination or revisits for first-try accuracy', () => {
    const events = [sample('a', 0, { choicesRemaining: 1 }), sample('a', 1, {}, { revisit: true }), sample('a', 2, { choicesRemaining: 1, outcome: 'incorrect' }, { matchOrder: null })];
    const result = stats(events);
    expect(result.sampleCount).toBe(3); expect(result.qualifyingCount).toBe(1); expect(result.firstTryCorrect).toBe(0); expect(result.mistakes).toBe(1); expect(result.label).toBe('Extra oefenen');
    expect(result.responseMs).toBeNull();
  });
  it('computes recent order averages and usual clean response, not total round time', () => {
    const events = [sample('a', 0, {}, { selectionOrder: 1, matchOrder: 2, boardSize: 6, responseMs: 400 }), sample('a', 1, {}, { selectionOrder: 3, matchOrder: 4, boardSize: 4, responseMs: 800 })];
    const result = stats(events);
    expect(result.averageSelectionOrder).toBe(2); expect(result.averageMatchOrder).toBe(3); expect(result.averageBoardSize).toBe(5); expect(result.responseMs).toBe(600);
    expect(result.label).toBe('Nog weinig geoefend');
  });
  it('does not retain a lifetime error flag after meaningful clean evidence arrives', () => {
    const w = word('a'), p: Progress = { key: progressKey('a', 'de', 'match'), wordId: 'a', language: 'de', mode: 'match', revision: 1, stage: 0, dueAt: at, lastPracticedAt: at - DAY, lastPromotedDay: null, lastFailedDay: '2025-12-31', successes: 0, mistakes: 20, hints: 0 };
    expect(buildPracticeStats([w], { [p.key]: p }, [sample('a', 0)], settings, at)[0].label).toBe('Nog weinig geoefend');
  });
});

describe('guarded learner-relative speed', () => {
  it('requires three clean timed pair samples and twenty same-band baseline samples across two sessions', () => {
    const { words, events } = baseline(), target = word('a');
    const own = Array.from({ length: 3 }, (_, i) => sample('a', i, {}, { responseMs: 1000 }));
    expect(buildPracticeStats([...words, target], {}, [...events, ...own], settings, at)[8].speed).toBe('hesitant');
    expect(buildPracticeStats([...words, target], {}, [...events, ...own.slice(0, 2)], settings, at)[8].speed).toBe('unknown');
    expect(buildPracticeStats([...words, target], {}, [...events.slice(0, 15), ...own], settings, at)[8].speed).toBe('unknown');
    const oneSession = [...events, ...own].map((event, i) => ({ ...event, sessionId: 'same', context: { ...event.context!, boardIndex: i % 3 } }));
    expect(buildPracticeStats([...words, target], {}, oneSession, settings, at)[8].speed).toBe('unknown');
  });
  it('compares against the learner rather than a universal seconds cutoff', () => {
    const { words, events } = baseline(), target = word('a');
    const own = Array.from({ length: 3 }, (_, i) => sample('a', i, {}, { responseMs: 10_000 }));
    const slowLearner = events.map((event) => ({ ...event, context: { ...event.context!, responseMs: 20_000 } }));
    const result = buildPracticeStats([...words, target], {}, [...slowLearner, ...own], settings, at)[8];
    expect(result.speed).toBe('fast'); expect(result.mistakes).toBe(0); expect(result.label).toBe('Gaat goed');
  });
  it('does not pool languages or three/four-choice and five/six-choice baselines', () => {
    const { words, events } = baseline('fr'), target = word('a');
    const own = Array.from({ length: 3 }, (_, i) => sample('a', i, {}, { responseMs: 1000 }));
    expect(buildPracticeStats([...words, target], {}, [...events, ...own], settings, at)[8].speed).toBe('unknown');
    const fiveChoices = events.map((event) => ({ ...event, language: 'de' as const, choicesRemaining: 5 }));
    expect(buildPracticeStats([...words, target], {}, [...fiveChoices, ...own], settings, at)[8].speed).toBe('unknown');
  });
  it('excludes low-choice, assisted, revisited and interrupted samples from speed evidence', () => {
    const { words, events } = baseline(), target = word('a');
    for (const context of [{ assisted: true }, { revisit: true }, { responseMs: null }, { selectionMs: null }, { responseMs: Number.NaN }, { responseMs: -1 }]) {
      const own = Array.from({ length: 3 }, (_, i) => sample('a', i, {}, context));
      expect(buildPracticeStats([...words, target], {}, [...events, ...own], settings, at)[8].speed).toBe('unknown');
    }
    const lowChoice = Array.from({ length: 3 }, (_, i) => sample('a', i, { choicesRemaining: 2 }));
    expect(buildPracticeStats([...words, target], {}, [...events, ...lowChoice], settings, at)[8].speed).toBe('unknown');
    const interruptedBaseline = events.map((event) => ({ ...event, context: { ...event.context!, selectionMs: null, responseMs: null } }));
    expect(buildPracticeStats([...words, target], {}, [...interruptedBaseline, ...Array.from({ length: 3 }, (_, i) => sample('a', i))], settings, at)[8].speed).toBe('unknown');
  });
});
