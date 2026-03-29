import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('package scripts', () => {
  it('keeps the default dev server non-watch for long-running runs', () => {
    const pkg = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf-8'),
    ) as {
      scripts?: Record<string, string>;
    };

    expect(pkg.scripts?.['dev']).toBe('tsx src/index.ts');
    expect(pkg.scripts?.['dev']).not.toContain('watch');
    expect(pkg.scripts?.['dev:watch']).toBe('tsx watch src/index.ts');
  });
});
