'use client';
import Link from 'next/link';

interface ProjectCardData {
  projectDir: string;
  projectName: string | null;
  taskCount: number;
  completedCount: number;
  failedCount: number;
  runningCount: number;
  latestTask: string;
  totalCost: number;
  projectType: string | null;
}

interface ProjectsViewProps {
  projects: ProjectCardData[];
  onNewProject: () => void;
}

export default function ProjectsView({ projects, onNewProject }: ProjectsViewProps) {
  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="text-4xl mb-4" style={{ color: 'var(--text-secondary)' }}>📁</div>
        <h3 className="text-lg font-medium mb-2" style={{ color: 'var(--text-primary)' }}>No projects yet</h3>
        <p className="text-sm mb-6 max-w-md" style={{ color: 'var(--text-secondary)' }}>
          Create your first task with a project directory and it will appear here.
        </p>
        <button onClick={onNewProject}
          className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition-colors">
          Create your first project
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {projects.map(project => (
        <ProjectCard key={project.projectDir} project={project} />
      ))}
    </div>
  );
}

function ProjectCard({ project }: { project: ProjectCardData }) {
  const dirName = project.projectDir.split('/').filter(Boolean).pop() ?? project.projectDir;
  // Prefer dirName over projectName if projectName looks like a task prompt (too long)
  const displayName = (project.projectName && project.projectName.length <= 30)
    ? project.projectName
    : dirName;
  const successRate = project.taskCount > 0
    ? Math.round((project.completedCount / project.taskCount) * 100)
    : 0;

  const encodedDir = encodeURIComponent(btoa(project.projectDir));

  return (
    <Link href={`/projects/${encodedDir}`}>
      <div className="rounded-xl p-4 border transition-all hover:border-indigo-500/40 hover:shadow-lg cursor-pointer"
        style={{
          background: 'var(--bg-card)',
          borderColor: 'var(--border-color)',
        }}>
        {/* Header: project name + type badge */}
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-medium text-sm truncate" style={{ color: 'var(--text-primary)' }}>
            {displayName}
          </h3>
          {project.projectType && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-400 shrink-0 ml-2">
              {project.projectType}
            </span>
          )}
        </div>

        {/* Path */}
        <p className="text-xs mb-3 truncate" style={{ color: 'var(--text-secondary)' }}>
          {project.projectDir}
        </p>

        {/* 3 metrics */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="text-center">
            <div className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              {project.taskCount}
            </div>
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>Tasks</div>
          </div>
          <div className="text-center">
            <div className={`text-lg font-semibold ${successRate >= 80 ? 'text-emerald-400' : successRate >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
              {successRate}%
            </div>
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>Success</div>
          </div>
          <div className="text-center">
            <div className="text-lg font-semibold text-violet-400">
              ${project.totalCost.toFixed(2)}
            </div>
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>Cost</div>
          </div>
        </div>

        {/* Footer: status dots + last activity */}
        <div className="flex items-center justify-between text-xs" style={{ color: 'var(--text-secondary)' }}>
          <div className="flex items-center gap-1.5">
            {project.runningCount > 0 && (
              <>
                <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                <span className="text-blue-400">{project.runningCount} running</span>
              </>
            )}
            {project.runningCount === 0 && project.failedCount > 0 && (
              <span className="text-red-400">{project.failedCount} failed</span>
            )}
            {project.runningCount === 0 && project.failedCount === 0 && (
              <span className="text-emerald-400">idle</span>
            )}
          </div>
          <span>{formatRelativeTime(project.latestTask)}</span>
        </div>
      </div>
    </Link>
  );
}

function formatRelativeTime(dateStr: string): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
