import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { strokePieces } from '../src/strokes.ts';

const P = (x: number, y: number) => ({ x, y });

describe('strokePieces', () => {
  it('strokes a lone path whole, ending at its arrowhead', () => {
    const path = [P(0, 0), P(50, 0), P(50, 40)];
    assert.deepEqual(strokePieces([path], 6), [{ pts: path, atEnd: true }]);
  });

  it('strokes a fork trunk once; the branch peels off one radius before the split', () => {
    // Both paths come down x=10; the first turns right at y=30, the second at y=80.
    const a = [P(10, 0), P(10, 30), P(60, 30)];
    const b = [P(10, 0), P(10, 80), P(60, 80)];
    const [first, second] = strokePieces([a, b], 6);
    assert.deepEqual(first, { pts: a, atEnd: true });
    assert.deepEqual(second, { pts: [P(10, 24), P(10, 80), P(60, 80)], atEnd: true });
  });

  it('strokes a join once; the merging path stops one radius past the junction', () => {
    // A second source joins the first one's line at (40, 50) and both run on to (100, 50).
    const a = [P(0, 50), P(100, 50)];
    const b = [P(40, 0), P(40, 50), P(100, 50)];
    const [, second] = strokePieces([a, b], 6);
    assert.deepEqual(second, { pts: [P(40, 0), P(40, 50), P(46, 50)], atEnd: false });
  });

  it('never extends a piece around a corner it shares', () => {
    // The shared part ends 2 points after a corner, closer than the corner radius.
    const a = [P(0, 0), P(20, 0), P(20, 2), P(20, 40)];
    const b = [P(0, 0), P(20, 0), P(20, 2), P(60, 2)];
    const [, second] = strokePieces([a, b], 6);
    assert.deepEqual(second!.pts[0], P(20, 0));
  });

  it('draws nothing for a path that is entirely covered', () => {
    const a = [P(0, 0), P(30, 0), P(30, 30)];
    assert.equal(strokePieces([a, [...a]], 6).length, 1);
  });

  it('drops repeated points that would leave a corner without a direction', () => {
    const [piece] = strokePieces([[P(0, 0), P(0, 0), P(10, 0), P(10, 0), P(10, 10)]], 6);
    assert.deepEqual(piece!.pts, [P(0, 0), P(10, 0), P(10, 10)]);
  });
});
