/**
 * Shared dashboard preference helpers for mode/model composer state.
 */

export const DASHBOARD_MODEL_STORAGE_KEY = 'shipyard_dashboard_coding_model';
export const DASHBOARD_MODE_STORAGE_KEY = 'shipyard_dashboard_mode';
export const DASHBOARD_OPENAI_KEY_STORAGE_KEY = 'shipyard_dashboard_openai_api_key';
export const DASHBOARD_ANTHROPIC_KEY_STORAGE_KEY = 'shipyard_dashboard_anthropic_api_key';
export const DASHBOARD_GITHUB_REPO_STORAGE_KEY = 'shipyard_dashboard_github_repo';
export const DASHBOARD_PROJECT_STORAGE_KEY = 'shipyard_selectedProject';

export function getDashboardPreferenceScript(): string {
  return `
var DASH_MODEL_KEY = ${JSON.stringify(DASHBOARD_MODEL_STORAGE_KEY)};
var DASH_MODE_KEY = ${JSON.stringify(DASHBOARD_MODE_STORAGE_KEY)};

function loadDashboardPref(key) {
  try {
    var value = localStorage.getItem(key);
    return value == null ? '' : String(value);
  } catch (e) {
    return '';
  }
}

function saveDashboardPref(key, value) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch (e) {}
}

function restoreDashboardSelect(selectId, storageKey) {
  var sel = document.getElementById(selectId);
  if (!sel) return;
  var value = loadDashboardPref(storageKey);
  if (!value) return;
  for (var i = 0; i < sel.options.length; i++) {
    var opt = sel.options[i];
    if (opt.value === value) {
      sel.value = value;
      return;
    }
  }
}

function persistDashboardSelect(selectId, storageKey) {
  var sel = document.getElementById(selectId);
  if (!sel) return;
  saveDashboardPref(storageKey, sel.value);
}

function restoreDashboardModelSel() {
  restoreDashboardSelect('modelSel', DASH_MODEL_KEY);
}

function persistDashboardModelSel() {
  persistDashboardSelect('modelSel', DASH_MODEL_KEY);
}

function restoreDashboardInput(inputId, storageKey) {
  var el = document.getElementById(inputId);
  if (!el) return;
  var value = loadDashboardPref(storageKey);
  if (!value) return;
  el.value = value;
}

function persistDashboardInput(inputId, storageKey) {
  var el = document.getElementById(inputId);
  if (!el) return;
  saveDashboardPref(storageKey, el.value || '');
}
`;
}

export function getProjectPreferencesScript(): string {
  return `
var DASH_PROJECT_KEY = ${JSON.stringify(DASHBOARD_PROJECT_STORAGE_KEY)};

function getSelectedProject() {
  try {
    var raw = localStorage.getItem(DASH_PROJECT_KEY);
    if (!raw) return { id: 'default', label: 'Default Project' };
    var parsed = JSON.parse(raw);
    if (parsed && parsed.id && parsed.label) return parsed;
    return { id: 'default', label: 'Default Project' };
  } catch (e) {
    return { id: 'default', label: 'Default Project' };
  }
}

function setSelectedProject(id, label) {
  try {
    localStorage.setItem(DASH_PROJECT_KEY, JSON.stringify({ id: id, label: label }));
  } catch (e) {}
}
`;
}
