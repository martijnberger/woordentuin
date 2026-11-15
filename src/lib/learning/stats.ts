import type { Exposure, Progress, Settings, TargetLanguage, Word } from '../model';

export interface PairStats {
  word: Word;
  language: TargetLanguage;
  sampleCount: number;
  qualifyingCount: number;
  firstTryCorrect: number;
  mistakes: number;
  hints: number;
  responseMs: number | null;
  averageSelectionOrder: number | null;
  averageMatchOrder: number | null;
  averageBoardSize: number | null;
  label: 'Nog weinig geoefend' | 'Extra oefenen' | 'Gaat goed';
  reason: string;
  lastPracticedAt: number | null;
  dueAt: number | null;
  speed: 'fast' | 'hesitant' | 'typical' | 'unknown';
}

export interface Appearance {
  events: Exposure[];
  first: Exposure;
  mistake: boolean;
  hint: boolean;
  qualifying: boolean;
  clean: Exposure | null;
}
export const pairKey = (wordId: string, language: TargetLanguage, revision: number): string => JSON.stringify([wordId, language, revision]);
export const validDuration = (value: number | null | undefined): number | null => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const mean = (values: number[]): number | null => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
export const median = (values: number[]): number | null => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const band = (choices: number): number => choices <= 4 ? 3 : 5;
export const cleanSuccess = (event: Exposure): boolean => event.mode === 'match' && event.outcome === 'correct' && event.choicesRemaining >= 3 && event.context !== null && event.context.attempt === 1 && !event.context.assisted && !event.context.revisit;

/** One sample is one board appearance, never a correction or another click. */
export function recentAppearances(exposures: readonly Exposure[]): Map<string, Appearance[]> {
  const groups = new Map<string, Map<string, Exposure[]>>(), ids = new Set<string>();
  for (const event of exposures) {
    if (ids.has(event.id)) continue;
    ids.add(event.id);
    if (event.mode !== 'match' || !event.context) continue;
    const key = pairKey(event.wordId, event.language, event.revision);
    let boards = groups.get(key);
    if (!boards) { boards = new Map(); groups.set(key, boards); }
    const boardKey = JSON.stringify([event.sessionId, event.context.boardIndex]);
    const events = boards.get(boardKey) ?? [];
    events.push(event); boards.set(boardKey, events);
  }
  const result = new Map<string, Appearance[]>();
  for (const [key, boards] of groups) {
    const recent = [...boards.values()].reverse().sort((a, b) => Math.max(...b.map((e) => e.at)) - Math.max(...a.map((e) => e.at))).slice(0, 10);
    result.set(key, recent.map((events) => {
      events.sort((a, b) => a.context!.attempt - b.context!.attempt || a.at - b.at);
      const first = events[0], mistake = events.some((e) => e.outcome === 'incorrect'), hint = events.some((e) => e.outcome === 'hint');
      const clean = !mistake && !hint && cleanSuccess(first) ? first : null;
      const qualifying = mistake || hint || (first.context!.attempt === 1 && !first.context!.assisted && !first.context!.revisit && first.choicesRemaining >= 3);
      return { events, first, mistake, hint, qualifying, clean };
    }));
  }
  return result;
}

/** Shared by the scheduler and the parent table; legacy evidence stays unknown. */
export function summarizePairs(words: Word[], progress: Record<string, Progress>, exposures: readonly Exposure[], settings: Settings, languages: (word: Word, settings: Settings) => TargetLanguage[], now: number): PairStats[] {
  const recent = recentAppearances(exposures);
  const baselines = new Map<string, Exposure[]>();
  const lastPracticed = new Map<string, number>();
  for (const event of exposures) {
    if (event.mode !== 'match') continue;
    const key = pairKey(event.wordId, event.language, event.revision);
    lastPracticed.set(key, Math.max(lastPracticed.get(key) ?? event.at, event.at));
  }
  // Chapter filtering does not change the learner's language/choice-band baseline.
  for (const word of words) for (const language of languages(word, { ...settings, chapter: 'all' })) {
    for (const sample of recent.get(pairKey(word.id, language, word.revision)) ?? []) {
      const event = sample.clean;
      if (!event || validDuration(event.context!.responseMs) === null || validDuration(event.context!.selectionMs) === null) continue;
      const key = JSON.stringify([language, band(event.choicesRemaining)]), values = baselines.get(key) ?? [];
      values.push(event); baselines.set(key, values);
    }
  }
  return words.filter((word) => word.enabled && word.reviewed && !!word.forms.nl?.trim() && (settings.chapter === 'all' || settings.chapter === word.chapter)).flatMap((word) => languages(word, settings).map((language): PairStats => {
    const samples = recent.get(pairKey(word.id, language, word.revision)) ?? [];
    const stored = progress[JSON.stringify([word.id, language, 'match'])];
    const prior = stored?.revision === word.revision ? stored : undefined;
    const qualifyingCount = samples.filter((sample) => sample.qualifying).length;
    const firstTryCorrect = samples.filter((sample) => sample.clean !== null).length;
    const mistakes = samples.reduce((sum, sample) => sum + sample.events.filter((event) => event.outcome === 'incorrect').length, 0);
    const hints = samples.reduce((sum, sample) => sum + sample.events.filter((event) => event.outcome === 'hint').length, 0);
    const clean = samples.flatMap((sample) => sample.clean ? [sample.clean] : []);
    const timed = clean.filter((event) => validDuration(event.context!.responseMs) !== null && validDuration(event.context!.selectionMs) !== null);
    let speed: PairStats['speed'] = 'unknown';
    // Each band must independently clear both guards; mixing six-choice and
    // three-choice answers would manufacture a speed difference from elimination.
    const comparisons: number[] = [];
    for (const choiceBand of [3, 5]) {
      const own = timed.filter((event) => band(event.choicesRemaining) === choiceBand);
      const baseline = baselines.get(JSON.stringify([language, choiceBand])) ?? [];
      if (own.length < 3 || baseline.length < 20 || new Set(baseline.map((event) => event.sessionId)).size < 2) continue;
      const usual = median(baseline.map((event) => event.context!.responseMs!));
      const response = median(own.map((event) => event.context!.responseMs!));
      if (usual !== null && usual > 0 && response !== null) comparisons.push(response / usual);
    }
    const comparison = median(comparisons);
    if (comparison !== null) speed = comparison < 0.75 ? 'fast' : comparison > 1.5 ? 'hesitant' : 'typical';
    const legacyTrouble = qualifyingCount === 0 && !!prior?.lastFailedDay && (!prior.lastPromotedDay || prior.lastFailedDay >= prior.lastPromotedDay);
    const needsPractice = samples.some((sample) => sample.mistake || sample.hint) || legacyTrouble;
    const label: PairStats['label'] = needsPractice ? 'Extra oefenen' : qualifyingCount >= 3 && firstTryCorrect / qualifyingCount >= 0.8 ? 'Gaat goed' : 'Nog weinig geoefend';
    const reason = needsPractice
      ? mistakes || hints ? `${mistakes} fout(en) en ${hints} hint(s) in de laatste ${samples.length} bord(en).` : 'Eerdere fout of hint; nog geen nieuwe onafhankelijke waarneming.'
      : label === 'Gaat goed' ? `${firstTryCorrect} van ${qualifyingCount} betekenisvolle borden meteen zelfstandig goed.`
      : qualifyingCount ? `${qualifyingCount} betekenisvolle bord(en); meer onafhankelijke oefening nodig.` : 'Nog geen zelfstandige eerste poging met minstens drie keuzes.';
    const lastEvent = lastPracticed.get(pairKey(word.id, language, word.revision)) ?? null;
    return {
      word, language, sampleCount: samples.length, qualifyingCount, firstTryCorrect, mistakes, hints,
      responseMs: median(timed.map((event) => event.context!.responseMs!)),
      averageSelectionOrder: mean(samples.map((sample) => sample.first.context!.selectionOrder)),
      averageMatchOrder: mean(samples.flatMap((sample) => {
        const completed = sample.events.find((event) => event.context!.matchOrder !== null);
        return completed ? [completed.context!.matchOrder!] : [];
      })),
      averageBoardSize: mean(samples.map((sample) => sample.first.context!.boardSize)),
      label, reason: prior && prior.dueAt <= now ? `${reason} Herhaling is aan de beurt.` : reason,
      lastPracticedAt: prior ? Math.max(prior.lastPracticedAt, lastEvent ?? prior.lastPracticedAt) : lastEvent,
      dueAt: prior?.dueAt ?? null, speed
    };
  }));
}
