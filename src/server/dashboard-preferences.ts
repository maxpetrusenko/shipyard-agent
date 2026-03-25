/**
 * Shared dashboard preference helpers for mode/model composer state.
 */

export const DASHBOARD_MODEL_STORAGE_KEY = 'shipyard_dashboard_coding_model';
export const DASHBOARD_MODE_STORAGE_KEY = 'shipyard_dashboard_mode';

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

function restoreDashboardModeSel() {
  restoreDashboardSelect('uiModeSel', DASH_MODE_KEY);
}

function persistDashboardModeSel() {
  persistDashboardSelect('uiModeSel', DASH_MODE_KEY);
}

function restoreDashboardModelSel() {
  restoreDashboardSelect('modelSel', DASH_MODEL_KEY);
}

function persistDashboardModelSel() {
  persistDashboardSelect('modelSel', DASH_MODEL_KEY);
}
`;
}
