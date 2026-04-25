import { notFound } from 'next/navigation';
import {
  getPipelineRun,
  getPipelineRunState,
  listPipelineEvents,
} from '@/lib/db/queries/pipeline-runs';
import { RunHeader } from './_components/RunHeader';
import { NodesTable } from './_components/NodesTable';
import { EventsTimeline } from './_components/EventsTimeline';
import { StateJsonViewer } from './_components/StateJsonViewer';
import { LiveEventsFeed } from './_components/LiveEventsFeed';
import { parseEventsPage } from './_lib/events-pagination';

const EVENTS_PAGE_SIZE = 50;

interface PageProps {
  params: Promise<{ projectId: string; runId: string }>;
  searchParams: Promise<{ eventsPage?: string }>;
}

/**
 * Stage 7 G2 — Pipeline Run detail page (Server Component).
 *
 * Read-only. Stack: meta header / nodes table / events timeline / raw state JSON.
 * Validates that the requested run belongs to the URL's projectId — otherwise
 * 404 (prevents URL tampering across projects).
 */
export default async function PipelineRunDetailPage({ params, searchParams }: PageProps) {
  const { projectId, runId } = await params;
  const sp = await searchParams;

  const eventsPage = parseEventsPage(sp.eventsPage);
  const eventsOffset = (eventsPage - 1) * EVENTS_PAGE_SIZE;

  const [run, stateView, events] = await Promise.all([
    Promise.resolve(getPipelineRun(runId)),
    Promise.resolve(getPipelineRunState(runId)),
    Promise.resolve(
      listPipelineEvents(runId, { limit: EVENTS_PAGE_SIZE, offset: eventsOffset }),
    ),
  ]);

  if (!run || run.projectId !== projectId) {
    notFound();
  }

  return (
    <div className="min-h-screen p-6 max-w-7xl mx-auto space-y-6">
      <RunHeader run={run} projectId={projectId} />
      <NodesTable state={stateView?.state ?? null} />
      {run.status === 'running' || run.status === 'initializing' ? (
        <LiveEventsFeed runId={runId} />
      ) : (
        <EventsTimeline
          events={events}
          projectId={projectId}
          runId={runId}
          currentPage={eventsPage}
          pageSize={EVENTS_PAGE_SIZE}
        />
      )}
      <StateJsonViewer state={stateView?.state ?? null} />
    </div>
  );
}
