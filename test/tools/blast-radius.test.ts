import { describe, it, expect } from 'vitest';
import {
  extractExportedSymbols,
  detectExportChanges,
} from '../../src/tools/blast-radius.js';

describe('blast-radius', () => {
  describe('extractExportedSymbols', () => {
    it('extracts named function exports', () => {
      const code = `export function getVisibilityContext() {}\nexport function isAdmin() {}`;
      const symbols = extractExportedSymbols(code);
      expect(symbols.has('getVisibilityContext')).toBe(true);
      expect(symbols.has('isAdmin')).toBe(true);
    });

    it('extracts const/let/var exports', () => {
      const code = `export const FOO = 1;\nexport let bar = 2;\nexport var baz = 3;`;
      const symbols = extractExportedSymbols(code);
      expect(symbols.has('FOO')).toBe(true);
      expect(symbols.has('bar')).toBe(true);
      expect(symbols.has('baz')).toBe(true);
    });

    it('extracts type and interface exports', () => {
      const code = `export type Foo = string;\nexport interface Bar {}`;
      const symbols = extractExportedSymbols(code);
      expect(symbols.has('Foo')).toBe(true);
      expect(symbols.has('Bar')).toBe(true);
    });

    it('extracts braced re-exports', () => {
      const code = `export { getUser, getSession as session }`;
      const symbols = extractExportedSymbols(code);
      expect(symbols.has('getUser')).toBe(true);
      expect(symbols.has('session')).toBe(true);
    });

    it('extracts default export', () => {
      const code = `export default function handler() {}`;
      const symbols = extractExportedSymbols(code);
      expect(symbols.has('handler')).toBe(true);
    });

    it('extracts class and enum exports', () => {
      const code = `export class MyService {}\nexport enum Status { Active }`;
      const symbols = extractExportedSymbols(code);
      expect(symbols.has('MyService')).toBe(true);
      expect(symbols.has('Status')).toBe(true);
    });

    it('returns empty set for no exports', () => {
      const code = `const x = 1;\nfunction foo() {}`;
      const symbols = extractExportedSymbols(code);
      expect(symbols.size).toBe(0);
    });
  });

  describe('detectExportChanges', () => {
    it('detects removed exports', () => {
      const old = `export function foo() {}\nexport function bar() {}\nexport const BAZ = 1;`;
      const new_ = `export function foo() {}`;
      const removed = detectExportChanges(old, new_);
      expect(removed).toContain('bar');
      expect(removed).toContain('BAZ');
      expect(removed).not.toContain('foo');
    });

    it('returns empty when no exports removed', () => {
      const old = `export function foo() {}`;
      const new_ = `export function foo() {}\nexport function bar() {}`;
      const removed = detectExportChanges(old, new_);
      expect(removed).toEqual([]);
    });

    it('returns empty when exports are identical', () => {
      const code = `export function foo() { return 1; }`;
      const code2 = `export function foo() { return 2; }`;
      const removed = detectExportChanges(code, code2);
      expect(removed).toEqual([]);
    });

    it('detects renamed exports as removal + addition', () => {
      const old = `export function getVisibilityContext() {}`;
      const new_ = `export function getVisibilityScope() {}`;
      const removed = detectExportChanges(old, new_);
      expect(removed).toContain('getVisibilityContext');
    });
  });
});
