import type { Board, Exposure, Language, Progress, Session, Settings, TargetLanguage, Word } from '../model';

export const LANGUAGES: Record<TargetLanguage, string> = { de: 'Duits', fr: 'Frans', es: 'Spaans', en: 'Engels' };
export type Action = { type: 'begin' } | { type: 'select'; side: 'left' | 'right'; wordId: string } | { type: 'hint' } | { type: 'next-board' } | { type: 'recall'; known: boolean } | { type: 'skip-recall' };
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
export function eligibleWords(words: Word[], settings: Settings): Word[] {
  return words.filter((w) => w.enabled && w.reviewed && (settings.chapter === 'all' || settings.chapter === w.chapter) && !!w.forms.nl?.trim() && !!w.forms[settings.language]?.trim());
}
export function applyExposure(previous: Progress | undefined, exposure: Exposure, timezone: string): Progress {
  const same = previous?.revision === exposure.revision && previous.wordId === exposure.wordId && previous.language === exposure.language && previous.mode === exposure.mode;
  const p: Progress = same ? { ...previous } : { key: progressKey(exposure.wordId, exposure.language, exposure.mode), wordId: exposure.wordId, language: exposure.language, mode: exposure.mode, revision: exposure.revision, stage: 0, dueAt: exposure.at + DAY, lastPracticedAt: exposure.at, lastPromotedDay: null, lastFailedDay: null, successes: 0, mistakes: 0, hints: 0 };
  const today = day(exposure.at, timezone);
  if (exposure.outcome === 'incorrect' || exposure.outcome === 'hint') {
    p.stage = 0; p.dueAt = exposure.at + DAY; p.lastFailedDay = today;
    if (exposure.outcome === 'incorrect') p.mistakes++; else p.hints++;
  } else {
    const strong = exposure.mode === 'recall' || exposure.choicesRemaining >= 3;
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
function conflicts(a: Word, b: Word, language: TargetLanguage): boolean {
  for (const lang of ['nl', language] as const) {
    const av = variants(a, lang), bv = variants(b, lang);
    for (const v of av) if (bv.has(v)) return true;
  }
  return false;
}
function shuffle<T>(items: T[], rng: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) { const j = Math.max(0, Math.min(i, Math.floor(rng() * (i + 1)))); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
}
function makeBoard(words: Word[], language: TargetLanguage, rng: () => number): Board {
  const chosen: Word[] = [];
  for (const word of words) if (chosen.length < 4 && chosen.every((other) => !conflicts(word, other, language))) chosen.push(word);
  const ids = chosen.map((w) => w.id);
  return { left: shuffle(ids, rng), right: shuffle(ids, rng), matched: [], failed: [], hinted: [] };
}
export function createSession(words: Word[], progress: Record<string, Progress>, settings: Settings, now = Date.now(), rng: () => number = Math.random): Session {
  const eligible = eligibleWords(words, settings);
  const prior = (w: Word) => { const p = progress[progressKey(w.id, settings.language, 'match')]; return p?.revision === w.revision ? p : undefined; };
  const due = eligible.filter((w) => { const p = prior(w); return p && p.dueAt <= now; }).sort((a, b) => {
    const pa = prior(a)!, pb = prior(b)!;
    const troubleA = pa.lastFailedDay && (!pa.lastPromotedDay || pa.lastFailedDay >= pa.lastPromotedDay) ? 1 : 0;
    const troubleB = pb.lastFailedDay && (!pb.lastPromotedDay || pb.lastFailedDay >= pb.lastPromotedDay) ? 1 : 0;
    return troubleB - troubleA || pa.dueAt - pb.dueAt;
  });
  const fresh = shuffle(eligible.filter((w) => !prior(w)), rng).slice(0, due.length >= 12 ? 0 : Math.min(2, 12 - due.length));
  const support = shuffle(eligible.filter((w) => { const p = prior(w); return p && p.dueAt > now; }), rng);
  const pool = [...due, ...fresh, ...support];
  const boards: Board[] = [];
  for (let i = 0; i < 3 && pool.length; i++) {
    const offset = i * 4;
    const candidates = [...pool.slice(offset), ...pool.slice(0, offset)];
    const board = makeBoard(candidates, settings.language, rng);
    if (board.left.length) boards.push(board);
  }
  const used = new Set(boards.flatMap((b) => b.left));
  const newWordIds = fresh.filter((w) => used.has(w.id)).map((w) => w.id);
  const dueRecall = eligible.filter((w) => {
    const p = progress[progressKey(w.id, settings.language, 'recall')];
    return prior(w) && p?.revision === w.revision && p.dueAt <= now;
  }).sort((a, b) => {
    const pa = progress[progressKey(a.id, settings.language, 'recall')], pb = progress[progressKey(b.id, settings.language, 'recall')];
    const troubleA = pa.lastFailedDay && (!pa.lastPromotedDay || pa.lastFailedDay >= pa.lastPromotedDay) ? 1 : 0;
    const troubleB = pb.lastFailedDay && (!pb.lastPromotedDay || pb.lastFailedDay >= pb.lastPromotedDay) ? 1 : 0;
    return troubleB - troubleA || pa.dueAt - pb.dueAt;
  }).map((w) => w.id);
  const recallWordIds = [...new Set([...dueRecall, ...boards.flatMap((b) => b.left)])].slice(0, 3);
  for (const id of recallWordIds) used.add(id);
  const frozen = eligible.filter((w) => used.has(w.id)).map((w) => ({ ...w, forms: { ...w.forms }, ...(w.alternatives ? { alternatives: Object.fromEntries(Object.entries(w.alternatives).map(([k, v]) => [k, [...v]])) } : {}) }));
  return { id: uniqueId(), version: 0, settings: { ...settings }, phase: boards.length ? (newWordIds.length ? 'intro' : 'match') : 'results', words: frozen, newWordIds, boards, boardIndex: 0, recallWordIds, recallIndex: 0, completedPairs: 0, startedAt: now, correct: 0, mistakes: 0, hints: 0, selection: null, feedback: '' };
}
function queueRetry(session: Session, wordId: string): void {
  const current = session.boards[session.boardIndex];
  let intervening = current.left.filter((id) => id !== wordId && !current.matched.includes(id)).length;
  const word = session.words.find((w) => w.id === wordId)!;
  const premature: Board[] = [];
  for (let i = session.boardIndex + 1; i < session.boards.length; i++) {
    const board = session.boards[i];
    if (intervening >= 3) {
      for (const earlier of premature) {
        earlier.left = earlier.left.filter((id) => id !== wordId);
        earlier.right = earlier.right.filter((id) => id !== wordId);
      }
      if (board.left.includes(wordId)) return;
      const conflictsWithRetry = new Set(board.left.filter((id) => conflicts(word, session.words.find((w) => w.id === id)!, session.settings.language)));
      board.left = board.left.filter((id) => !conflictsWithRetry.has(id));
      board.right = board.right.filter((id) => !conflictsWithRetry.has(id));
      if (board.left.length >= 4) { const removed = board.left[board.left.length - 1]; board.left = board.left.filter((id) => id !== removed); board.right = board.right.filter((id) => id !== removed); }
      board.left = [wordId, ...board.left]; board.right = [...board.right, wordId];
      return;
    }
    if (board.left.includes(wordId) && board.left.length > 1) premature.push(board);
    intervening += board.left.filter((id) => id !== wordId).length;
  }
}
export function transition(input: Session, action: Action, now = Date.now()): { session: Session; exposures: Exposure[] } {
  const session: Session = { ...input, boards: input.boards.map((b) => ({ left: [...b.left], right: [...b.right], matched: [...b.matched], failed: [...b.failed], hinted: [...b.hinted] })), selection: input.selection ? { ...input.selection } : null };
  const exposures: Exposure[] = [];
  const emit = (wordId: string, outcome: Exposure['outcome'], choicesRemaining: number, mode: Exposure['mode'], chosenWordId?: string) => {
    const word = session.words.find((w) => w.id === wordId)!;
    exposures.push({ id: `${session.id}:${session.version + 1}:${exposures.length}`, sessionId: session.id, wordId, ...(chosenWordId ? { chosenWordId } : {}), language: session.settings.language, mode, outcome, choicesRemaining, at: now, revision: word.revision });
  };
  let persistent = false;
  if (action.type === 'begin' && session.phase === 'intro') { session.phase = 'match'; session.feedback = ''; persistent = true; }
  else if (action.type === 'select' && session.phase === 'match') {
    const board = session.boards[session.boardIndex];
    if (!board || !board[action.side].includes(action.wordId) || board.matched.includes(action.wordId) || board.matched.length === board.left.length) return { session: input, exposures };
    const selected = session.selection;
    if (!selected || selected.side === action.side) session.selection = selected?.wordId === action.wordId ? null : { side: action.side, wordId: action.wordId };
    else {
      const anchor = selected.wordId, chosen = action.wordId, remaining = board.left.length - board.matched.length;
      if (anchor === chosen) {
        const assisted = session.boards.slice(0, session.boardIndex + 1).some((earlier) => earlier.failed.includes(anchor) || earlier.hinted.includes(anchor));
        emit(anchor, 'correct', assisted ? 0 : remaining, 'match', chosen);
        board.matched.push(anchor); session.completedPairs++; session.correct++; session.selection = null;
        session.feedback = assisted ? 'Goed geprobeerd!' : 'Goed gedaan!';
        if (remaining < 3 && !assisted) queueRetry(session, anchor);
      } else {
        emit(anchor, 'incorrect', remaining, 'match', chosen); if (!board.failed.includes(anchor)) board.failed.push(anchor);
        session.mistakes++; session.feedback = 'Bijna! Probeer nog eens.'; queueRetry(session, anchor);
      }
      persistent = true;
    }
  } else if (action.type === 'hint' && session.phase === 'match' && session.selection) {
    const board = session.boards[session.boardIndex], id = session.selection.wordId;
    if (board && !board.matched.includes(id)) {
      emit(id, 'hint', board.left.length - board.matched.length, 'match');
      if (!board.hinted.includes(id)) board.hinted.push(id);
      board.matched.push(id); session.completedPairs++; session.hints++; session.selection = null;
      session.feedback = 'Samen gevonden!'; queueRetry(session, id); persistent = true;
    }
  } else if (action.type === 'next-board' && session.phase === 'match') {
    const board = session.boards[session.boardIndex];
    if (board && board.matched.length === board.left.length) {
      session.selection = null; session.feedback = ''; session.boardIndex++;
      if (session.boardIndex >= session.boards.length) session.phase = session.recallWordIds.length ? 'recall' : 'results';
      persistent = true;
    }
  } else if (action.type === 'recall' && session.phase === 'recall') {
    const id = session.recallWordIds[session.recallIndex];
    if (id) { emit(id, action.known ? 'correct' : 'incorrect', 0, 'recall'); session.recallIndex++; if (session.recallIndex >= session.recallWordIds.length) session.phase = 'results'; session.feedback = ''; persistent = true; }
  } else if (action.type === 'skip-recall' && session.phase === 'recall') { session.phase = 'results'; session.feedback = ''; persistent = true; }
  if (persistent) session.version++;
  return { session, exposures };
}
