import type { DashboardView } from '../types';

export const DASHBOARD_VIEW_STORAGE_KEY = 'tmb_dashboard_view';
export const DEFAULT_DASHBOARD_VIEW: DashboardView = 'analytics';

export const DASHBOARD_VIEW_PATHS: Record<DashboardView, string> = {
  setup: 'setup',
  analytics: 'analytics',
  surveys: 'surveys',
  observability: 'observability',
  handoff: 'handoff',
  broadcast: 'broadcast',
  sessions: 'sessions',
  settings: 'settings',
  flows: 'flows',
  dbMaintenance: 'db-maintenance',
};

export function isDashboardView(value: string): value is DashboardView {
  return Object.prototype.hasOwnProperty.call(DASHBOARD_VIEW_PATHS, value);
}

export function dashboardViewToPath(view: DashboardView): string {
  return `/${DASHBOARD_VIEW_PATHS[view]}`;
}

export function dashboardPathToView(pathSegment: string | undefined): DashboardView | null {
  const normalized = String(pathSegment || '').trim();
  const match = (Object.entries(DASHBOARD_VIEW_PATHS) as Array<[DashboardView, string]>)
    .find(([, path]) => path === normalized);

  return match ? match[0] : null;
}

export function readLegacyDashboardView(): DashboardView | null {
  if (typeof window === 'undefined') return null;
  const stored = String(window.localStorage.getItem(DASHBOARD_VIEW_STORAGE_KEY) || '').trim();
  return isDashboardView(stored) ? stored : null;
}

export function readLegacyDashboardPath(): string {
  return dashboardViewToPath(readLegacyDashboardView() || DEFAULT_DASHBOARD_VIEW);
}

export function clearLegacyDashboardView(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(DASHBOARD_VIEW_STORAGE_KEY);
}
