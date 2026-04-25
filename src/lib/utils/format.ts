/**
 * Stage 7 G1 — Display formatters used across pipeline UI.
 *
 * All functions are total: null/undefined inputs map to a stable placeholder
 * ("-") so callers do not need to guard. Intended to be imported by both
 * Server and Client Components — no React or DOM dependencies.
 */

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/** "500ms" / "3.5s" / "2.1m" / "1.5h" / "-" for null. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '-';
  if (!Number.isFinite(ms) || ms < 0) return '-';
  if (ms < MS_PER_SECOND) return `${Math.floor(ms)}ms`;
  if (ms < MS_PER_MINUTE) return `${(ms / MS_PER_SECOND).toFixed(1)}s`;
  if (ms < MS_PER_HOUR) return `${(ms / MS_PER_MINUTE).toFixed(1)}m`;
  return `${(ms / MS_PER_HOUR).toFixed(1)}h`;
}

/**
 * "30초 전" / "5분 전" / "2시간 전" / fallback to local date string for older values.
 * `now` 는 테스트에서 결정성을 위해 주입.
 */
export function formatRelativeTime(
  iso: string | null | undefined,
  now: number = Date.now(),
): string {
  if (!iso) return '-';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '-';
  const ms = now - t;
  if (ms < 0) return '-';
  if (ms < MS_PER_MINUTE) return `${Math.floor(ms / MS_PER_SECOND)}초 전`;
  if (ms < MS_PER_HOUR) return `${Math.floor(ms / MS_PER_MINUTE)}분 전`;
  if (ms < MS_PER_DAY) return `${Math.floor(ms / MS_PER_HOUR)}시간 전`;
  return new Date(iso).toLocaleDateString('ko-KR');
}

/** Returns the prefix of the id; original returned untouched if shorter than `length`. */
export function truncateId(id: string | null | undefined, length = 8): string {
  if (!id) return '-';
  if (id.length <= length) return id;
  return id.slice(0, length);
}
