import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { check } from '../src/index.ts';

const SKILL = readFileSync(new URL('../skill/SKILL.md', import.meta.url), 'utf8');

describe('skill/SKILL.md', () => {
  it('starts with the front matter an Agent Skill needs', () => {
    const front = /^---\n([\s\S]*?)\n---\n/.exec(SKILL)?.[1];
    assert.ok(front, 'front matter');
    assert.match(front, /^name: idef0$/m);
    const description = /^description: (.+)$/m.exec(front)?.[1] ?? '';
    assert.ok(description.length > 50 && description.length <= 1024, `description of ${description.length} characters`);
  });

  it('has examples that compile without warnings', () => {
    const blocks = [...SKILL.matchAll(/^```idef0\n([\s\S]*?)^```$/gm)].map((m) => m[1]!);
    const inline = [...SKILL.matchAll(/`(activity "[^`]*)`/g)].map((m) => m[1]!);
    assert.ok(blocks.length > 0 && inline.length > 0, 'examples found');
    for (const source of [...blocks, ...inline]) {
      assert.deepEqual(check(source).warnings, [], source);
    }
  });
});
