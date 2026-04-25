/**
 * Stage 7 G1 micro-fix — out-of-range page resolution.
 *
 * Pure function (no Next.js / DB imports) so it can be unit-tested without
 * mocking the entire framework. The page component is responsible for
 * actually invoking `redirect(target)` when `target !== null`.
 */
export interface ClampPageArgs {
  projectId: string;
  requestedPage: number;
  totalPages: number;
  total: number;
  status?: string;
  taskId?: string;
}

/**
 * Returns the absolute URL to redirect to when the requested page exceeds
 * the available range (and there are actually rows to show). Returns `null`
 * when the request is valid or when there are no rows at all (in which case
 * the empty state should render in place — no redirect).
 */
export function clampPageRedirectTarget(args: ClampPageArgs): string | null {
  if (args.total === 0) return null;
  if (args.requestedPage <= args.totalPages) return null;

  const params = new URLSearchParams();
  if (args.status) params.set('status', args.status);
  if (args.taskId) params.set('taskId', args.taskId);
  if (args.totalPages > 1) params.set('page', String(args.totalPages));
  const qs = params.toString();
  return `/pipeline-runs/${args.projectId}${qs ? `?${qs}` : ''}`;
}
