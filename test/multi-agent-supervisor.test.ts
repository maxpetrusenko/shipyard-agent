import { describe, expect, it } from 'vitest';
import { extractJsonPayload } from '../src/multi-agent/supervisor.js';

describe('extractJsonPayload', () => {
  it('parses the first balanced object with subtasks from mixed text', () => {
    const text = [
      'plan notes before json',
      '{"ignored":true}',
      '```json',
      JSON.stringify({
        subtasks: [
          {
            id: '1',
            description: 'Edit src/a.ts',
            files: ['src/a.ts'],
            meta: { nested: { safe: true } },
          },
        ],
        sequential_pairs: [['1', '2']],
      }),
      '```',
    ].join('\n');

    expect(extractJsonPayload(text)).toEqual({
      subtasks: [
        {
          id: '1',
          description: 'Edit src/a.ts',
          files: ['src/a.ts'],
          meta: { nested: { safe: true } },
        },
      ],
      sequentialPairs: [['1', '2']],
    });
  });

  it('accepts camelCase sequentialPairs payloads', () => {
    const text = JSON.stringify({
      subtasks: [{ id: '1', description: 'Edit src/a.ts', files: ['src/a.ts'] }],
      sequentialPairs: [['1', '2']],
    });

    expect(extractJsonPayload(text)?.sequentialPairs).toEqual([['1', '2']]);
  });
});
