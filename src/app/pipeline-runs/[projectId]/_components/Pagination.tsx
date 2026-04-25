import Link from 'next/link';

interface PaginationProps {
  projectId: string;
  currentPage: number;
  totalPages: number;
  searchParams: { status?: string; taskId?: string };
}

export function Pagination({ projectId, currentPage, totalPages, searchParams }: PaginationProps) {
  if (totalPages <= 1) return null;

  function buildHref(page: number) {
    const params = new URLSearchParams();
    if (searchParams.status) params.set('status', searchParams.status);
    if (searchParams.taskId) params.set('taskId', searchParams.taskId);
    if (page > 1) params.set('page', String(page));
    const qs = params.toString();
    return `/pipeline-runs/${projectId}${qs ? `?${qs}` : ''}`;
  }

  const linkClass =
    'px-3 py-1 text-sm rounded border hover:bg-[var(--bg-card)]';
  const linkStyle = { borderColor: 'var(--border-color)', color: 'var(--text-primary)' };

  return (
    <nav className="flex justify-center items-center gap-2 mt-6" aria-label="pagination">
      {currentPage > 1 ? (
        <Link href={buildHref(currentPage - 1)} className={linkClass} style={linkStyle}>
          ← Prev
        </Link>
      ) : (
        <span className="px-3 py-1 text-sm rounded border opacity-30 cursor-not-allowed" style={linkStyle}>
          ← Prev
        </span>
      )}
      <span className="px-3 py-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
        {currentPage} / {totalPages}
      </span>
      {currentPage < totalPages ? (
        <Link href={buildHref(currentPage + 1)} className={linkClass} style={linkStyle}>
          Next →
        </Link>
      ) : (
        <span className="px-3 py-1 text-sm rounded border opacity-30 cursor-not-allowed" style={linkStyle}>
          Next →
        </span>
      )}
    </nav>
  );
}
