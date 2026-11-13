export type Language = 'nl' | 'de' | 'fr' | 'es' | 'en';
export type TargetLanguage = Exclude<Language, 'nl'>;
export type PracticeLanguage = TargetLanguage | 'mvt';
export const MATCH_PAIRS = 6;

export interface Word {
  id: string;
  chapter: string;
  partOfSpeech: 'verb' | 'noun' | 'adjective' | 'other';
  forms: Partial<Record<Language, string>>;
  alternatives?: Partial<Record<Language, string[]>>;
  context?: string;
  revision: number;
  reviewed: boolean;
  enabled: boolean;
  note?: string;
}
export interface Settings { language: PracticeLanguage; chapter: string; timezone: string }
export interface Progress {
  key: string; wordId: string; language: TargetLanguage; mode: 'match' | 'recall';
  revision: number; stage: number; dueAt: number; lastPracticedAt: number;
  lastPromotedDay: string | null; lastFailedDay: string | null;
  successes: number; mistakes: number; hints: number;
}
export interface Exposure {
  id: string; sessionId: string; wordId: string; chosenWordId?: string;
  language: TargetLanguage; mode: 'match' | 'recall'; outcome: 'correct' | 'incorrect' | 'hint';
  choicesRemaining: number; at: number; revision: number;
}
export interface Board { left: string[]; right: string[]; matched: string[]; failed: string[]; hinted: string[] }
export interface Session {
  id: string; version: number; settings: Settings; phase: 'intro' | 'match' | 'recall' | 'results';
  words: Word[]; newWordIds: string[]; boards: Board[]; boardIndex: number; recallWordIds: string[];
  wordLanguages: Record<string, TargetLanguage>;
  recallIndex: number; completedPairs: number; startedAt: number; correct: number; mistakes: number;
  hints: number; selection: { side: 'left' | 'right'; wordId: string } | null; feedback: string;
}
export interface Snapshot {
  schemaVersion: 2; words: Word[]; progress: Record<string, Progress>; exposures: Exposure[];
  settings: Settings; session: Session | null;
}
