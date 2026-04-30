'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import MissionHeader from './components/mission/MissionHeader';
import KanbanView from './components/mission/KanbanView';
import GridView from './components/mission/GridView';
import TimelineView from './components/mission/TimelineView';
import ProjectsView from './components/mission/ProjectsView';
import KpiBar from './components/mission/KpiBar';
import NewTaskModal from './components/mission/NewTaskModal';
import CreateProjectModal from './components/mission/CreateProjectModal';

interface Task {
  id: string;
  prompt: string;
  status: string;
  agentId: string;
  projectDir: string | null;
  result: unknown;
  createdAt: string;
  updatedAt: string;
}

interface TaskEvent {
  type: string;
  data: unknown;
  createdAt: string;
}

function isToday(dateStr: string): boolean {
  const d = new Date(dateStr);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
}

function parseResult(result: unknown): Record<string, unknown> | null {
  if (!result) return null;
  if (typeof result === 'string') {
    try { return JSON.parse(result); } catch { return null; }
  }
  return result as Record<string, unknown>;
}

export default function MissionControl() {
  const router = useRouter();
  const [view, setView] = useState<'kanban' | 'grid' | 'timeline' | 'projects'>('projects');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [showNewTask, setShowNewTask] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);
  const [taskEvents, setTaskEvents] = useState<Record<string, TaskEvent[]>>({});
  const [initialProjectDir, setInitialProjectDir] = useState<string | undefined>();
  const [chainTask, setChainTask] = useState<{ id: string; prompt: string } | null>(null);
  const [projects, setProjects] = useState<Array<{
    projectDir: string;
    projectName: string | null;
    taskCount: number;
    completedCount: number;
    failedCount: number;
    runningCount: number;
    latestTask: string;
    totalCost: number;
    projectType: string | null;
  }>>([]);

  // Handle URL params (projectDir, chain, newTask)
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const dirFromUrl = urlParams.get('projectDir');
    if (dirFromUrl) setInitialProjectDir(dirFromUrl);
    if (urlParams.get('newTask')) setShowNewTask(true);
    const chainId = urlParams.get('chain');
    if (chainId) {
      fetch(`/api/tasks/${chainId}`)
        .then(r => r.json())
        .then(data => {
          setChainTask({ id: data.id, prompt: data.prompt });
          if (data.projectDir) setInitialProjectDir(data.projectDir);
          setShowNewTask(true);
        })
        .catch(() => {});
    }
  }, []);

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks?limit=50');
      const data = await res.json();
      setTasks(data);
    } catch { /* ignore */ }
  }, []);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch('/api/projects');
      const data = await res.json();
      setProjects(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchTasks();
    const interval = setInterval(fetchTasks, 5000);
    return () => clearInterval(interval);
  }, [fetchTasks]);

  // Fetch projects when switching to projects view
  useEffect(() => {
    if (view === 'projects') {
      fetchProjects();
      const interval = setInterval(fetchProjects, 10000);
      return () => clearInterval(interval);
    }
  }, [view, fetchProjects]);

  // Load events for Timeline view
  useEffect(() => {
    if (view !== 'timeline') return;
    tasks.forEach(task => {
      fetch(`/api/tasks/${task.id}`).then(r => r.json()).then(data => {
        setTaskEvents(prev => ({ ...prev, [task.id]: data.events ?? [] }));
      }).catch(() => {});
    });
  }, [view, tasks]);

  // KPI calculations
  const todayTasks = tasks.filter(t => isToday(t.createdAt));
  const completedToday = todayTasks.filter(t => t.status === 'completed').length;
  const successRate = todayTasks.length > 0 ? Math.round(completedToday / todayTasks.length * 100) : 0;
  const activeTasks = tasks.filter(t => ['planning', 'coding', 'verifying', 'retrying'].includes(t.status)).length;

  // Cost from results
  const todayCost = todayTasks.reduce((sum, t) => {
    const r = parseResult(t.result);
    return sum + Number(r?.costUsd ?? r?.totalCostUsd ?? 0);
  }, 0);
  const avgCost = todayTasks.length > 0 ? todayCost / todayTasks.length : 0;

  // Score
  const scored = todayTasks.filter(t => {
    const r = parseResult(t.result);
    return r?.score != null;
  });
  const avgScore = scored.length > 0
    ? scored.reduce((sum, t) => {
        const r = parseResult(t.result);
        return sum + Number(r?.score ?? 0);
      }, 0) / scored.length
    : 0;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--bg-primary)' }}>
      <MissionHeader
        activeView={view}
        onViewChange={setView}
        activeTasks={activeTasks}
        todayCost={todayCost}
        onNewTask={() => setShowNewTask(true)}
      />

      <div className="flex-1 p-5 overflow-x-auto">
        {view === 'kanban' && <KanbanView tasks={tasks} />}
        {view === 'grid' && <GridView tasks={tasks} onNewTask={() => setShowNewTask(true)} />}
        {view === 'timeline' && <TimelineView tasks={tasks} events={taskEvents} />}
        {view === 'projects' && <ProjectsView projects={projects} onNewProject={() => setShowNewProject(true)} />}
      </div>

      <KpiBar
        todayTotal={todayTasks.length}
        completedToday={completedToday}
        successRate={successRate}
        totalCost={todayCost}
        avgCost={avgCost}
        avgScore={avgScore}
        scoredTasks={scored.length}
      />

      {showNewTask && (
        <NewTaskModal
          onClose={() => setShowNewTask(false)}
          onCreated={() => { setShowNewTask(false); fetchTasks(); }}
          initialProjectDir={initialProjectDir}
          chainTask={chainTask}
        />
      )}

      {showNewProject && (
        <CreateProjectModal
          onClose={() => setShowNewProject(false)}
          onCreated={(project) => {
            setShowNewProject(false);
            router.push(`/projects/${encodeURIComponent(btoa(project.path))}`);
          }}
        />
      )}
    </div>
  );
}
