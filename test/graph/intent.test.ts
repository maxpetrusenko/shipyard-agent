import { describe, it, expect } from 'vitest';
import {
  looksLikeCodeRequest,
  tryArithmeticShortcut,
  tryChatShortcut,
} from '../../src/graph/intent.js';

describe('tryArithmeticShortcut', () => {
  it('evaluates simple expressions', () => {
    expect(tryArithmeticShortcut('2+2')).toBe('4');
    expect(tryArithmeticShortcut(' 3 * 4 ')).toBe('12');
    expect(tryArithmeticShortcut('(1+2)*3')).toBe('9');
  });

  it('handles simple comparison questions', () => {
    expect(tryArithmeticShortcut('2=2?')).toBe('true');
    expect(tryArithmeticShortcut('2 = 3 ?')).toBe('false');
    expect(tryArithmeticShortcut('3<=4?')).toBe('true');
  });

  it('returns null for non-arithmetic', () => {
    expect(tryArithmeticShortcut('what is 2+2')).toBeNull();
    expect(tryArithmeticShortcut('refactor auth')).toBeNull();
    expect(tryArithmeticShortcut('2+alert(1)')).toBeNull();
  });
});

describe('looksLikeCodeRequest', () => {
  it('detects coding language', () => {
    expect(looksLikeCodeRequest('fix the failing test in src/foo.test.ts')).toBe(
      true,
    );
    expect(looksLikeCodeRequest('add a route for /api/health')).toBe(true);
    expect(looksLikeCodeRequest('pnpm test')).toBe(true);
  });

  it('allows casual prompts', () => {
    expect(looksLikeCodeRequest('hello')).toBe(false);
    expect(looksLikeCodeRequest('what is the capital of France?')).toBe(false);
  });
});

describe('tryChatShortcut', () => {
  it('returns an instant reply for trivial greetings', () => {
    expect(tryChatShortcut('hi')).toContain('Hi');
    expect(tryChatShortcut('hello')).toContain('How can I help');
  });

  it('returns null for normal chat prompts', () => {
    expect(tryChatShortcut('what is the capital of France?')).toBeNull();
    expect(tryChatShortcut('fix the build')).toBeNull();
  });
});
