import type { Board, Exposure, Language, MatchEvidence, PracticeLanguage, Progress, Session, Settings, TargetLanguage, Word } from '../model';
import { MATCH_PAIRS } from '../model';
import { MVT_WORD_IDS } from '../content/words';
import { FRENCH_3VWO_WORD_IDS } from '../content/french-3vwo';
import { cleanSuccess, pairKey, recentAppearances, summarizePairs, validDuration } from './stats';
import type { PairStats } from './stats';
export type { PairStats } from './stats';

export const LANGUAGES: Record<TargetLanguage, string> = { de: 'Duits', fr: 'Frans', es: 'Spaans', en: 'Engels' };
export const PRACTICE_MODES: Record<PracticeLanguage, string> = { ...LANGUAGES, 'fr-3vwo': 'Frans · 3 VWO', mvt: 'MVT · Frans, Duits en Spaans' };
const targets: TargetLanguage[] = ['fr', 'de', 'es'];
export interface MatchTiming { selectionMs: number | null; responseMs: number | null }
export type Action = { type: 'begin' } | { type: 'select'; side: 'left' | 'right'; wordId: string; timing?: MatchTiming } | { type: 'hint'; timing?: MatchTiming } | { type: 'next-board' };
export const progressKey = (wordId: string, language: TargetLanguage, mode: 'match' | 'recall'): string => JSON.stringify([wordId, language, mode]);
const day = (at: number, timezone: string): string => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
};
const DAY = 86_400_000;
const intervals = [1, 3, 7, 14, 30];
let idCounter = 0;
function uniqueId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${(++idCounter).toString(36)}-${Math.random().toString(36).slice(2)}`;
}
export function inPracticeSet(word: Word, language: PracticeLanguage): boolean {
  if (language === 'mvt') return MVT_WORD_IDS.has(word.id);
  return FRENCH_3VWO_WORD_IDS.has(word.id) === (language === 'fr-3vwo');
}
export function practiceChapters(words: Word[], language: PracticeLanguage): string[] {
  return [...new Set(words.filter((word) => inPracticeSet(word, language)).map((word) => word.chapter))]
    .sort((a, b) => a.localeCompare(b, 'nl', { numeric: true }));
}
export function targetLanguages(word: Word, settings: Settings): TargetLanguage[] {
  if (!inPracticeSet(word, settings.language)) return [];
  if (settings.language === 'mvt') return targets.filter((language) => !!word.forms[language]?.trim());
  const target = settings.language === 'fr-3vwo' ? 'fr' : settings.language;
  return word.forms[target]?.trim() ? [target] : [];
}
export function eligibleWords(words: Word[], settings: Settings): Word[] {
  return words.filter((w) => w.enabled && w.reviewed && (settings.chapter === 'all' || settings.chapter === w.chapter) && !!w.forms.nl?.trim() && targetLanguages(w, settings).length > 0);
}
export function buildPracticeStats(words: Word[], progress: Record<string, Progress>, exposures: readonly Exposure[], settings: Settings, now = Date.now()): PairStats[] {
  return summarizePairs(words, progress, exposures, settings, targetLanguages, now);
}
export function applyExposure(previous: Progress | undefined, exposure: Exposure, timezone: string): Progress {
  const same = previous?.revision === exposure.revision && previous.wordId === exposure.wordId && previous.language === exposure.language && previous.mode === exposure.mode;
  const p: Progress = same ? { ...previous } : { key: progressKey(exposure.wordId, exposure.language, exposure.mode), wordId: exposure.wordId, language: exposure.language, mode: exposure.mode, revision: exposure.revision, stage: 0, dueAt: exposure.at + DAY, lastPracticedAt: exposure.at, lastPromotedDay: null, lastFailedDay: null, successes: 0, mistakes: 0, hints: 0 };
  const today = day(exposure.at, timezone);
  if (exposure.outcome === 'incorrect' || exposure.outcome === 'hint') {
    p.stage = 0; p.dueAt = exposure.at + DAY; p.lastFailedDay = today;
    if (exposure.outcome === 'incorrect') p.mistakes++; else p.hints++;
  } else {
    // Recall and context-free archive records never become objective recognition evidence.
    const strong = cleanSuccess(exposure);
    if (strong) p.successes++;
    if (same && strong && exposure.at >= p.dueAt && day(p.lastPracticedAt, timezone) < today && p.lastPromotedDay !== today && p.lastFailedDay !== today) {
      p.stage = Math.min(p.stage + 1, intervals.length - 1);
      p.dueAt = exposure.at + intervals[p.stage] * DAY;
      p.lastPromotedDay = today;
    }
  }
  p.lastPracticedAt = exposure.at;
  return p;
}
function normalized(value: string): string { return value.normalize('NFC').trim().toLocaleLowerCase().replace(/\s+/g, ' '); }
function variants(word: Word, language: Language): Set<string> {
  const value = word.forms[language] ?? '';
  return new Set([value, ...value.split(/,\s*|\//), ...(word.alternatives?.[language] ?? [])].map(normalized).filter(Boolean));
}
function conflicts(a: Word, aLanguage: TargetLanguage, b: Word, bLanguage: TargetLanguage): boolean {
  const overlap = (av: Set<string>, bv: Set<string>) => [...av].some((v) => bv.has(v));
  return a.id === b.id || overlap(variants(a, 'nl'), variants(b, 'nl')) || overlap(variants(a, aLanguage), variants(b, bLanguage));
}
function shuffle<T>(items: T[], rng: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) { const j = Math.max(0, Math.min(i, Math.floor(rng() * (i + 1)))); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}
type Category = 'difficult' | 'other' | 'support';
type Pair = { word: Word; language: TargetLanguage; prior: Progress | undefined; stats: PairStats; difficulty: number; category: Category };
export function createSession(words: Word[], progress: Record<string, Progress>, settings: Settings, exposures: readonly Exposure[], now = Date.now(), rng: () => number = Math.random): Session {
  const eligible = eligibleWords(words, settings);
  const recent = recentAppearances(exposures);
  const pairs: Pair[] = shuffle(buildPracticeStats(words, progress, exposures, settings, now).map((stats) => {
    const { word, language } = stats;
    const stored = progress[progressKey(word.id, language, 'match')], prior = stored?.revision === word.revision ? stored : undefined;
    const samples = recent.get(pairKey(word.id, language, word.revision)) ?? [];
    const recentErrors = samples.filter((sample) => sample.mistake || sample.hint).length;
    const legacyError = stats.qualifyingCount === 0 && prior?.lastFailedDay && (!prior.lastPromotedDay || prior.lastFailedDay >= prior.lastPromotedDay) ? 1 : 0;
    const difficulty = recentErrors || legacyError;
    return { word, language, prior, stats, difficulty, category: difficulty ? 'difficult' : !prior || prior.dueAt <= now ? 'other' : 'support' } satisfies Pair;
  }), rng);
  const substantial = new Set(pairs.filter((pair) => pair.category === 'difficult').map((pair) => pair.word.id)).size >= 12;
  // These are round targets, not quotas: empty or incompatible groups fall back.
  const allocation: Category[] = substantial
    ? ['difficult', 'other', 'difficult', 'support', 'difficult', 'difficult']
    : ['difficult', 'other', 'difficult', 'support', 'difficult', 'other'];
  const assignments = new Map<string, Pair>(), introduced = new Set<string>(), appearances = new Map<string, number>();
  const counts: Record<TargetLanguage, number> = { en: 0, fr: 0, de: 0, es: 0 };
  const weakness: Record<TargetLanguage, number> = { en: 0, fr: 0, de: 0, es: 0 };
  for (const language of Object.keys(weakness) as TargetLanguage[]) {
    const samples = pairs.filter((pair) => pair.language === language);
    weakness[language] = samples.reduce((sum, pair) => sum + pair.difficulty, 0) / Math.max(1, samples.length);
  }
  const boards: Board[] = [];
  for (let boardIndex = 0; boardIndex < 3 && pairs.length; boardIndex++) {
    const pool = pairs.filter((pair) => !assignments.has(pair.word.id) || assignments.get(pair.word.id)!.language === pair.language);
    // Search at most six slots. Backtracking prevents a high-priority ambiguous
    // anchor from shrinking a board when another complete combination exists.
    const search = (chosen: Pair[], remaining: Pair[], size: number, required: TargetLanguage[]): Pair[] | null => {
      const missing = required.filter((language) => !chosen.some((pair) => pair.language === language));
      if (chosen.length === size) return missing.length ? null : chosen;
      const newCount = introduced.size + chosen.filter((pair) => !pair.prior && !introduced.has(pair.word.id)).length;
      const available = remaining.filter((pair) => (pair.prior || introduced.has(pair.word.id) || newCount < MATCH_PAIRS)
        && chosen.every((other) => !conflicts(pair.word, pair.language, other.word, other.language)));
      const needed = size - chosen.length;
      if (missing.length > needed || missing.some((language) => !available.some((pair) => pair.language === language))) return null;
      if (new Set(available.map((pair) => normalized(pair.word.forms.nl!))).size < needed
        || new Set(available.map((pair) => normalized(pair.word.forms[pair.language]!))).size < needed) return null;
      const desired = allocation[chosen.length];
      const mustCoverLanguage = needed <= missing.length;
      const localCounts = { ...counts };
      for (const pair of chosen) localCounts[pair.language]++;
      available.sort((a, b) => {
        const categoryRank = (pair: Pair) => pair.category === desired ? 0 : desired === 'support' ? pair.category === 'other' ? 1 : 2 : desired === 'difficult' ? pair.category === 'other' ? 1 : 2 : pair.category === 'difficult' ? 1 : 2;
        const languageRank = mustCoverLanguage ? Number(!missing.includes(a.language)) - Number(!missing.includes(b.language)) : 0;
        return languageRank || categoryRank(a) - categoryRank(b)
          || (appearances.get(a.word.id) ?? 0) - (appearances.get(b.word.id) ?? 0)
          || b.difficulty - a.difficulty
          || (a.prior?.dueAt ?? now) - (b.prior?.dueAt ?? now)
          || Number(b.stats.speed === 'hesitant') - Number(a.stats.speed === 'hesitant')
          || weakness[b.language] - weakness[a.language]
          || localCounts[a.language] - localCounts[b.language];
      });
      for (let index = 0; index < available.length; index++) {
        const result = search([...chosen, available[index]], available.slice(index + 1), size, required);
        if (result) return result;
      }
      return null;
    };
    let chosen: Pair[] = [];
    for (let size = MATCH_PAIRS; size > 0; size--) {
      const languages = [...new Set(pool.map((pair) => pair.language))];
      const result = search([], pool, size, languages) ?? search([], pool, size, []);
      if (result) { chosen = result; break; }
    }
    for (const pair of chosen) {
      assignments.set(pair.word.id, pair);
      if (!pair.prior) introduced.add(pair.word.id);
      appearances.set(pair.word.id, (appearances.get(pair.word.id) ?? 0) + 1); counts[pair.language]++;
    }
    if (chosen.length) {
      const ids = chosen.map(({ word }) => word.id);
      boards.push({ left: shuffle(ids, rng), right: shuffle(ids, rng), matched: [], failed: [], hinted: [], attempts: {}, selected: [] });
    }
  }
  const frozen = eligible.filter((word) => assignments.has(word.id)).map((word) => ({ ...word, forms: { ...word.forms }, ...(word.alternatives ? { alternatives: Object.fromEntries(Object.entries(word.alternatives).map(([language, values]) => [language, [...values]])) } : {}) }));
  const wordLanguages = Object.fromEntries(frozen.map((word) => [word.id, assignments.get(word.id)!.language]));
  return { id: uniqueId(), version: 0, settings: { ...settings }, phase: boards.length ? (introduced.size ? 'intro' : 'match') : 'results', words: frozen, wordLanguages, newWordIds: [...introduced], boards, boardIndex: 0, completedPairs: 0, startedAt: now, correct: 0, mistakes: 0, hints: 0, selection: null, feedback: '' };
}

function queueRetry(session: Session, wordId: string): void {
  const current = session.boards[session.boardIndex];
  let intervening = current.left.filter((id) => id !== wordId && !current.matched.includes(id)).length;
  const word = session.words.find((candidate) => candidate.id === wordId)!;
  const canFill = (board: Board, id: string, boardIndex: number): boolean => {
    if (board.left.includes(id) || board.left.some((other) => conflicts(session.words.find((candidate) => candidate.id === id)!, session.wordLanguages[id], session.words.find((candidate) => candidate.id === other)!, session.wordLanguages[other]))) return false;
    // Do not accidentally reinsert another just-failed pair removed for delay.
    for (let earlier = session.boardIndex; earlier < boardIndex; earlier++) {
      const prior = session.boards[earlier];
      if (!prior.failed.includes(id) && !prior.hinted.includes(id)) continue;
      let gap = earlier === session.boardIndex ? prior.left.filter((other) => other !== id && !prior.matched.includes(other)).length : 0;
      for (let between = earlier + 1; between < boardIndex; between++) gap += session.boards[between].left.filter((other) => other !== id).length;
      if (gap < 3) return false;
    }
    return true;
  };
  const fill = (board: Board, boardIndex: number) => {
    for (const candidate of session.words) {
      if (board.left.length >= MATCH_PAIRS) break;
      if (candidate.id === wordId || !canFill(board, candidate.id, boardIndex)) continue;
      board.left.push(candidate.id); board.right.unshift(candidate.id);
    }
  };
  for (let index = session.boardIndex + 1; index < session.boards.length; index++) {
    const board = session.boards[index];
    if (intervening < 3) {
      // Delay is optional when the frozen pool cannot replace the slot: keep
      // the already-planned full board, rather than manufacturing a smaller one.
      if (board.left.includes(wordId) && board.left.length > 1) {
        const delayed = { ...board, left: board.left.filter((id) => id !== wordId), right: board.right.filter((id) => id !== wordId) };
        fill(delayed, index);
        if (delayed.left.length >= board.left.length) {
          board.left = delayed.left; board.right = delayed.right;
        }
      }
      intervening += board.left.filter((id) => id !== wordId).length;
      continue;
    }
    if (board.left.includes(wordId)) return;
    const collisions = board.left.filter((id) => conflicts(word, session.wordLanguages[wordId], session.words.find((candidate) => candidate.id === id)!, session.wordLanguages[id]));
    // A retry may replace a slot, never destroy a full board through ambiguity.
    if (collisions.length > 1) { intervening += board.left.length; continue; }
    const removed = collisions[0] ?? (board.left.length >= MATCH_PAIRS ? board.left[board.left.length - 1] : undefined);
    if (removed) { board.left = board.left.filter((id) => id !== removed); board.right = board.right.filter((id) => id !== removed); }
    board.left = [wordId, ...board.left]; board.right = [...board.right, wordId];
    fill(board, index);
    return;
  }
}
export function transition(input: Session, action: Action, now = Date.now()): { session: Session; exposures: Exposure[] } {
  const session: Session = { ...input, boards: input.boards.map((board) => ({ ...board, left: [...board.left], right: [...board.right], matched: [...board.matched], failed: [...board.failed], hinted: [...board.hinted], attempts: { ...board.attempts }, selected: [...board.selected] })), selection: input.selection ? { ...input.selection } : null };
  const exposures: Exposure[] = [];
  const emit = (wordId: string, outcome: Exposure['outcome'], chosenWordId: string | undefined, timing: MatchTiming | undefined) => {
    const board = session.boards[session.boardIndex], word = session.words.find((candidate) => candidate.id === wordId)!;
    const earlier = session.boards.slice(0, session.boardIndex);
    const attempt = (board.attempts[wordId] ?? (board.failed.includes(wordId) || board.hinted.includes(wordId) ? 1 : 0)) + 1;
    const assisted = outcome === 'hint' || attempt > 1 || earlier.some((prior) => prior.failed.includes(wordId) || prior.hinted.includes(wordId));
    if (!board.selected.includes(wordId)) board.selected.push(wordId);
    const context: MatchEvidence = {
      boardIndex: session.boardIndex, boardSize: board.left.length, attempt,
      selectionSide: session.selection!.side, selectionOrder: board.selected.indexOf(wordId) + 1,
      matchOrder: outcome === 'incorrect' ? null : board.matched.length + 1,
      assisted, revisit: earlier.some((prior) => prior.left.includes(wordId)),
      selectionMs: validDuration(timing?.selectionMs), responseMs: validDuration(timing?.responseMs)
    };
    board.attempts[wordId] = attempt;
    exposures.push({ id: `${session.id}:${session.version + 1}:${exposures.length}`, sessionId: session.id, wordId, ...(chosenWordId ? { chosenWordId } : {}), language: session.wordLanguages[wordId], mode: 'match', outcome, choicesRemaining: board.left.length - board.matched.length, at: now, revision: word.revision, context });
  };
  let persistent = false;
  if (action.type === 'begin' && session.phase === 'intro') { session.phase = 'match'; session.feedback = ''; persistent = true; }
  else if (action.type === 'select' && session.phase === 'match') {
    const board = session.boards[session.boardIndex];
    if (!board || !board[action.side].includes(action.wordId) || board.matched.includes(action.wordId) || board.matched.length === board.left.length) return { session: input, exposures };
    const selected = session.selection;
    if (!selected || selected.side === action.side) {
      session.selection = selected?.wordId === action.wordId ? null : { side: action.side, wordId: action.wordId };
      if (session.selection && !board.selected.includes(action.wordId)) board.selected.push(action.wordId);
    } else {
      const anchor = selected.wordId, chosen = action.wordId;
      if (anchor === chosen) {
        emit(anchor, 'correct', chosen, action.timing);
        board.matched.push(anchor); session.completedPairs++; session.correct++; session.selection = null;
        session.feedback = exposures[0].context!.assisted ? 'Goed geprobeerd!' : 'Goed gedaan!';
      } else {
        emit(anchor, 'incorrect', chosen, action.timing);
        if (!board.failed.includes(anchor)) board.failed.push(anchor);
        session.mistakes++; session.feedback = 'Bijna! Probeer nog eens.'; queueRetry(session, anchor);
      }
      persistent = true;
    }
  } else if (action.type === 'hint' && session.phase === 'match' && session.selection) {
    const board = session.boards[session.boardIndex], id = session.selection.wordId;
    if (board && !board.matched.includes(id)) {
      emit(id, 'hint', undefined, action.timing);
      if (!board.hinted.includes(id)) board.hinted.push(id);
      board.matched.push(id); session.completedPairs++; session.hints++; session.selection = null;
      session.feedback = 'Samen gevonden!'; queueRetry(session, id); persistent = true;
    }
  } else if (action.type === 'next-board' && session.phase === 'match') {
    const board = session.boards[session.boardIndex];
    if (board && board.matched.length === board.left.length) {
      session.selection = null; session.feedback = ''; session.boardIndex++;
      if (session.boardIndex >= session.boards.length) session.phase = 'results';
      persistent = true;
    }
  }
  if (persistent) session.version++;
  return { session, exposures };
}
