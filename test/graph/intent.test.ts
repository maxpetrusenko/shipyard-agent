import { describe, expect, it } from 'vitest';

import { looksLikeCodeRequest } from '../../src/graph/intent.js';

describe('looksLikeCodeRequest', () => {
  it('treats rebuild instructions as code work', () => {
    expect(
      looksLikeCodeRequest('build ship app in desktop/gauntlet/ship2. here is plan'),
    ).toBe(true);
  });

  it('treats repo creation asks as code work', () => {
    expect(
      looksLikeCodeRequest('create ship2 repo and rebuild ship from the attached plan'),
    ).toBe(true);
  });

  it('keeps plain repo questions in chat mode', () => {
    expect(looksLikeCodeRequest('what is a repo?')).toBe(false);
  });
});
