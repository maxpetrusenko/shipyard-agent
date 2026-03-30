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
var projectRegistry = Array.isArray(PROJECTS_SEED) ? PROJECTS_SEED.slice() : [];

function normalizeProjectRecord(project) {
  if (!project || !project.id) return null;
  return {
    id: String(project.id),
    label: project.label ? String(project.label) : 'Project',
    workDir: project.workDir ? String(project.workDir) : WORK_DIR,
  };
}

function defaultProjectRecord() {
  if (projectRegistry.length > 0) return normalizeProjectRecord(projectRegistry[0]);
  return { id: 'default', label: 'Default Project', workDir: WORK_DIR };
}

function setAvailableProjects(projects) {
  var next = Array.isArray(projects)
    ? projects.map(normalizeProjectRecord).filter(Boolean)
    : [];
  if (!next.length) next = [defaultProjectRecord()];
  projectRegistry = next;
  return projectRegistry;
}

function getAvailableProjects() {
  if (!projectRegistry.length) setAvailableProjects(PROJECTS_SEED);
  return projectRegistry.slice();
}

function upsertProject(project) {
  var next = normalizeProjectRecord(project);
  if (!next) return null;
  var found = false;
  projectRegistry = getAvailableProjects().map(function(entry) {
    if (entry.id !== next.id) return entry;
    found = true;
    return {
      id: next.id,
      label: next.label || entry.label,
      workDir: next.workDir || entry.workDir,
    };
  });
  if (!found) projectRegistry.push(next);
  return next;
}

function getSelectedProject() {
  try {
    var raw = localStorage.getItem(DASH_PROJECT_KEY);
    if (!raw) return defaultProjectRecord();
    var parsed = JSON.parse(raw);
    if (parsed && parsed.id) {
      var existing = getAvailableProjects().find(function(project){ return project.id === parsed.id; });
      if (existing) return existing;
      if (parsed.label || parsed.workDir) return normalizeProjectRecord(parsed);
    }
    return defaultProjectRecord();
  } catch (e) {
    return defaultProjectRecord();
  }
}

function setSelectedProject(id, label, workDir) {
  var selected = normalizeProjectRecord({ id: id, label: label, workDir: workDir }) || defaultProjectRecord();
  upsertProject(selected);
  try {
    localStorage.setItem(DASH_PROJECT_KEY, JSON.stringify(selected));
  } catch (e) {}
}

setAvailableProjects(PROJECTS_SEED);
`;
}
