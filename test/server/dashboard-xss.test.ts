import { describe, expect, it } from 'vitest';
import { getSettingsModalScript } from '../../src/server/dashboard-settings.js';
import { getRetryScript } from '../../src/server/dashboard-retry.js';

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

describe('Dashboard XSS hardening', () => {
  it('ack-template preview renders script-like text via textContent', () => {
    const input = {
      value: '<script>alert(1)</script>',
      placeholder: '',
    };
    const preview = { textContent: '', style: { display: 'none' } };
    const documentStub = {
      getElementById(id: string) {
        if (id === 'ackTemplateInput') return input;
        if (id === 'ackTemplatePreview') return preview;
        return null;
      },
      querySelector() { return null; },
      addEventListener() { return undefined; },
    };

    const context = {
      document: documentStub,
      window: { addEventListener() {} },
      settingsStatus: {},
      WORK_DIR: '.',
      benchmarkSummary: null,
      refreshProviderReadiness() {},
      refreshCheckpoints() {},
      refreshBenchmarkSummary() {},
      refreshSettingsStatus() {},
      loadAckTemplate() {},
      restoreDashboardInput() {},
      persistDashboardInput() {},
      loadDashboardPref() { return ''; },
      saveDashboardPref() {},
      setBadge() {},
      refreshRunsFromApi() {},
      esc: escapeHtml,
    } as any;

    // eslint-disable-next-line no-new-func
    const run = new Function('ctx', `with (ctx) { ${getSettingsModalScript()}; return previewAckTemplate; }`);
    const previewFn = run(context) as () => void;
    previewFn();

    expect(preview.textContent).toContain('<script>alert(1)</script>');
    expect((preview as any).innerHTML).toBeUndefined();
  });

  it('retry drawer escapes malicious event fields before HTML insertion', () => {
    const drawer = { classList: { add() {}, remove() {} } };
    const body = { innerHTML: '' };
    const title = { textContent: '' };
    const modal = { classList: { add() {}, remove() {} } };
    const documentStub = {
      getElementById(id: string) {
        if (id === 'retryDrawer') return drawer;
        if (id === 'retryDrawerBody') return body;
        if (id === 'retryDrawerTitle') return title;
        if (id === 'retryModal') return modal;
        return null;
      },
      querySelectorAll() { return []; },
      addEventListener() { return undefined; },
    };
    const context = {
      document: documentStub,
      window: {},
      confirm() { return false; },
      esc: escapeHtml,
    } as any;

    // eslint-disable-next-line no-new-func
    const run = new Function('ctx', `with (ctx) { ${getRetryScript()}; _retryEvents = [{
      id: 'evt-1',
      source: 'api',
      eventType: 'invoke',
      status: 'accepted',
      receivedAt: '2026-01-01T00:00:00.000Z',
      instruction: '<img onerror=alert(1)>',
      metadata: { note: '<img onerror=alert(1)>' }
    }]; return openEventDrawer; }`);
    const openDrawer = run(context) as (eventId: string) => void;
    openDrawer('evt-1');

    expect(body.innerHTML).not.toContain('<img onerror=alert(1)>');
    expect(body.innerHTML).toContain('&lt;img onerror=alert(1)&gt;');
  });

  it('github repo loader returns a promise and auto-selects a single granted repo', async () => {
    const savedPrefs: Record<string, string> = {};
    const repoSearch = { value: '' };
    const repoStatus = { textContent: '', className: '' };
    const repoSelect = { innerHTML: '', value: '', options: [] as Array<{ value: string }> };
    const installSelect = { value: '77', options: [{ value: '77' }] };
    const repoMeta = { innerHTML: '' };
    const installMeta = { innerHTML: '' };
    const documentStub = {
      getElementById(id: string) {
        if (id === 'ghRepoSearchInput') return repoSearch;
        if (id === 'ghStatus') return repoStatus;
        if (id === 'ghRepoSel') return repoSelect;
        if (id === 'ghInstallSel') return installSelect;
        if (id === 'ghRepoMeta') return repoMeta;
        if (id === 'ghInstallMeta') return installMeta;
        return null;
      },
      querySelector() { return null; },
      addEventListener() { return undefined; },
    };

    const context = {
      document: documentStub,
      window: { addEventListener() {} },
      settingsStatus: {
        githubAppConfigured: true,
        githubConnected: true,
        githubInstallationId: 77,
        githubInstallMissing: [],
        githubAppMissing: [],
      },
      WORK_DIR: '.',
      benchmarkSummary: null,
      refreshProviderReadiness() {},
      refreshCheckpoints() {},
      refreshBenchmarkSummary() {},
      refreshSettingsStatus() { return Promise.resolve(); },
      loadAckTemplate() {},
      restoreDashboardInput() {},
      persistDashboardInput() {},
      loadDashboardPref(key: string) { return savedPrefs[key] || ''; },
      saveDashboardPref(key: string, value: string) { savedPrefs[key] = value; },
      setBadge() {},
      refreshRunsFromApi() {},
      GH_REPO_STORAGE: 'shipyard_dashboard_repo',
      fetch() {
        return Promise.resolve({
          ok: true,
          json() {
            return Promise.resolve({ repos: [{ full_name: 'max/ship-agent' }] });
          },
        });
      },
      esc: escapeHtml,
    } as any;

    // eslint-disable-next-line no-new-func
    const run = new Function('ctx', `with (ctx) { ${getSettingsModalScript()}; return loadGithubRepos; }`);
    const loadGithubReposFn = run(context) as () => Promise<Array<{ full_name: string }>>;

    const result = loadGithubReposFn();

    expect(result && typeof result.then).toBe('function');
    await result;
    expect(repoSelect.value).toBe('max/ship-agent');
    expect(savedPrefs['shipyard_dashboard_repo']).toBe('max/ship-agent');
    expect(repoMeta.innerHTML).toContain('Ready to connect');
  });
});
