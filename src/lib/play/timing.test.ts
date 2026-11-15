import { describe, expect, it } from 'vitest';
import { BoardTiming } from './timing';

function clock() {
  let now = 0;
  const timing = new BoardTiming(() => now);
  return { timing, advance: (ms: number) => { now += ms; } };
}

describe('active board timing', () => {
  it('excludes saving, feedback and transition pauses from selection and response time', () => {
    const { timing, advance } = clock();
    timing.start(true);
    advance(5000); // Board is not interactive yet.
    timing.resume();
    advance(100);
    timing.pause();
    advance(8000);
    timing.resume();
    advance(200);
    timing.select('a');
    advance(400);
    timing.pause();
    advance(9000);
    timing.resume();
    advance(50);
    expect(timing.evidence('a')).toEqual({ selectionMs: 300, responseMs: 450 });
  });

  it('retains the earliest anchor timing across cancellation, other selections and corrections', () => {
    const { timing, advance } = clock();
    timing.start(true); timing.resume();
    advance(100); timing.select('a');
    advance(200); timing.select('b');
    advance(300); timing.select('a');
    expect(timing.evidence('a')).toEqual({ selectionMs: 100, responseMs: 500 });
    timing.pause(); advance(1000); timing.resume();
    advance(200); timing.select('a');
    expect(timing.evidence('a')).toEqual({ selectionMs: 100, responseMs: 700 });
  });

  it('never restores current-board timing after blur, backgrounding or a failed save', () => {
    const { timing, advance } = clock();
    timing.start(true); timing.resume();
    advance(100); timing.select('a');
    timing.invalidate(); advance(10000); timing.resume(); timing.select('a');
    expect(timing.evidence('a')).toEqual({ selectionMs: null, responseMs: null });
    timing.start(true); timing.resume();
    advance(80); timing.select('b'); advance(120);
    expect(timing.evidence('b')).toEqual({ selectionMs: 80, responseMs: 120 });
  });

  it('leaves resumed/reloaded boards and missing anchors unknown, not zero', () => {
    const { timing, advance } = clock();
    timing.start(false); timing.resume(); advance(500); timing.select('a');
    expect(timing.evidence('a')).toEqual({ selectionMs: null, responseMs: null });
    timing.start(true); timing.resume();
    expect(timing.evidence('a')).toEqual({ selectionMs: null, responseMs: null });
  });
});
