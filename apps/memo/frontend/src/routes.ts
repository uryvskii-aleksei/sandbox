export type EntityRef = number | string;
type Page = 'dashboard' | 'inbox' | 'recent' | 'search' | 'trash' | 'drafts';
export type Route = { view: Page } | { view: 'project'; project: EntityRef; folder?: EntityRef };

const publicIdPattern = 'm[a-f0-9]{32}';
const entityPattern = `(${publicIdPattern}|\\d{1,10})`;
const workspacePattern = new RegExp(
  `^(?:workspace|workplace)/${entityPattern}(?:/folder/${entityPattern})?/?$`,
);
const publicId = new RegExp(`^${publicIdPattern}$`);
export const isPublicId = (value: unknown): value is string =>
  typeof value === 'string' && publicId.test(value);
const entityRef = (value: string): EntityRef => (isPublicId(value) ? value : Number(value));

export function parseRoute(pathname: string, base: string): Route {
  if (!pathname.startsWith(base)) return { view: 'dashboard' };
  const relative = pathname.slice(base.length);
  const workspace = workspacePattern.exec(relative);
  if (workspace) {
    return {
      view: 'project',
      project: entityRef(workspace[1]),
      folder: workspace[2] ? entityRef(workspace[2]) : undefined,
    };
  }
  const view = relative.replace(/\/$/, '');
  return {
    view:
      view === 'inbox' ||
      view === 'recent' ||
      view === 'search' ||
      view === 'trash' ||
      view === 'drafts'
        ? view
        : 'dashboard',
  };
}

export function routeUrl(base: string, route: Route): string {
  if (route.view !== 'project') return `${base}${route.view}`;
  const folder = route.folder === undefined ? '' : `/folder/${route.folder}`;
  return `${base}workspace/${route.project}${folder}`;
}
