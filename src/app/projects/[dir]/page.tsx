'use client';
import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface ProjectInfo {
  projectDir: string;
  taskCount: number;
  completedCount: number;
  failedCount: number;
  runningCount: number;
  latestTask: string;
  totalCost: number;
  projectType?: string;
}

interface ProjectTask {
  id: string;
  prompt: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  executionMode?: string;
  cycleCount?: number;
}

interface FileEntry {
  name: string;
  type: 'file' | 'directory';
  size?: number;
}

interface AgentFile {
  role: string;
  content: string;
  source: string;
  filePath?: string;
}

export default function ProjectPage({ params }: { params: Promise<{ dir: string }> }) {
  const { dir } = use(params);
  const projectDir = atob(decodeURIComponent(dir));

  const [info, setInfo] = useState<ProjectInfo | null>(null);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [projectTasks, setProjectTasks] = useState<ProjectTask[]>([]);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [previewFile, setPreviewFile] = useState<{ path: string; content: string; language: string } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  // Tabs
  const [activeTab, setActiveTab] = useState<'overview' | 'tasks' | 'files' | 'harness'>('overview');

  // Harness state
  const [harnessAgents, setHarnessAgents] = useState<AgentFile[]>([]);
  const [editingAgent, setEditingAgent] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [harnessMessage, setHarnessMessage] = useState('');

  useEffect(() => {
    fetch('/api/projects')
      .then(r => r.json())
      .then((projects: any[]) => {
        const found = projects.find((p: any) => p.projectDir === projectDir);
        if (found) {
          setInfo(found);
          setProjectName(found.projectName ?? null);
        }
      })
      .catch(() => {});
  }, [projectDir]);

  useEffect(() => {
    fetch(`/api/tasks?projectDir=${encodeURIComponent(projectDir)}&limit=50`)
      .then(r => r.json())
      .then(setProjectTasks)
      .catch(() => {});
  }, [projectDir]);

  useEffect(() => {
    fetch(`/api/projects/files?dir=${encodeURIComponent(projectDir)}`)
      .then(r => r.json())
      .then(setFiles)
      .catch(() => setFiles([]));
  }, [projectDir]);

  useEffect(() => {
    if (activeTab === 'harness') {
      fetch(`/api/harness?projectDir=${encodeURIComponent(projectDir)}`)
        .then(r => r.json())
        .then(data => setHarnessAgents(data.agents ?? []))
        .catch(() => {});
    }
  }, [activeTab, projectDir]);

  const handleDeleteTask = async (taskId: string) => {
    if (!confirm('Delete this task?')) return;
    await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' });
    setProjectTasks(prev => prev.filter(t => t.id !== taskId));
  };

  const handleDeleteAll = async () => {
    if (!confirm(`Delete ALL ${projectTasks.length} tasks for this project?`)) return;
    setDeleting(true);
    for (const t of projectTasks) {
      await fetch(`/api/tasks/${t.id}`, { method: 'DELETE' });
    }
    setProjectTasks([]);
    setDeleting(false);
  };

  const handleOpenFolder = async () => {
    await fetch('/api/workspace/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: projectDir }),
    });
  };

  const loadFilePreview = async (filePath: string) => {
    if (previewFile?.path === filePath) { setPreviewFile(null); return; }
    try {
      const res = await fetch(`/api/files?projectDir=${encodeURIComponent(projectDir)}&file=${encodeURIComponent(filePath)}`);
      if (res.ok) setPreviewFile(await res.json());
    } catch {}
  };

  const handleSaveAgent = async () => {
    if (!editingAgent) return;
    await fetch('/api/harness', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'agent',
        role: editingAgent,
        content: editContent,
        scope: 'project',
        projectDir,
      }),
    });
    setEditingAgent(null);
    setHarnessMessage(`Saved ${editingAgent}.md → project (.autodev/agents/)`);
    setTimeout(() => setHarnessMessage(''), 3000);
    const res = await fetch(`/api/harness?projectDir=${encodeURIComponent(projectDir)}`);
    const data = await res.json();
    setHarnessAgents(data.agents ?? []);
  };

  const handleResetAgent = async (role: string) => {
    if (!confirm(`Reset ${role}.md? Will fall back to global or default.`)) return;
    await fetch(`/api/harness?role=${role}&scope=project&projectDir=${encodeURIComponent(projectDir)}`, { method: 'DELETE' });
    const res = await fetch(`/api/harness?projectDir=${encodeURIComponent(projectDir)}`);
    const data = await res.json();
    setHarnessAgents(data.agents ?? []);
    setHarnessMessage(`${role}.md reset`);
    setTimeout(() => setHarnessMessage(''), 3000);
  };

  const sourceColor = (source: string) => {
    if (source === 'project') return 'text-teal-400 bg-teal-900/30';
    if (source === 'global') return 'text-purple-400 bg-purple-900/30';
    return 'text-gray-400 bg-gray-800';
  };

  return (
    <div className="min-h-screen p-8 max-w-5xl mx-auto">
      <Link href="/" className="text-indigo-400 hover:text-indigo-300 text-sm mb-4 inline-block">
        &larr; Back to Dashboard
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold mb-1">{projectName ?? 'Project'}</h1>
          <code className="text-sm text-gray-400 bg-gray-800 px-2 py-1 rounded">{projectDir}</code>
          {info?.projectType && (
            <span className="ml-2 px-2 py-0.5 text-xs bg-indigo-900/50 text-indigo-300 rounded">
              {info.projectType}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={async () => {
              if (!confirm('Delete all tasks and data for this project?')) return;
              await fetch(`/api/projects?dir=${encodeURIComponent(projectDir)}`, { method: 'DELETE' });
              router.push('/');
            }}
            className="px-3 py-1.5 text-xs bg-red-900/50 hover:bg-red-900 text-red-300 rounded-lg transition-colors">
            Delete Project
          </button>
          <button onClick={handleOpenFolder}
            className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors">
            Open Folder
          </button>
          <Link
            href={`/?projectDir=${encodeURIComponent(projectDir)}`}
            className="px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors">
            + New Task
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b" style={{ borderColor: 'var(--border-color)' }}>
        {([
          { id: 'overview' as const, label: 'Overview' },
          { id: 'tasks' as const, label: `Tasks (${projectTasks.length})` },
          { id: 'harness' as const, label: 'Harness' },
          { id: 'files' as const, label: `Files (${files.length})` },
        ]).map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              activeTab === t.id
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent hover:text-gray-400'
            }`}
            style={{ color: activeTab === t.id ? undefined : 'var(--text-secondary)' }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Overview Tab */}
      {activeTab === 'overview' && info && (
        <div className="space-y-6">
          {/* Stats cards */}
          <div className="grid grid-cols-4 gap-3">
            <div className="rounded-lg p-4 border" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
              <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Total Tasks</p>
              <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{info.taskCount}</p>
            </div>
            <div className="rounded-lg p-4 border" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
              <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Success Rate</p>
              <p className={`text-2xl font-bold ${
                info.taskCount > 0 && (info.completedCount / info.taskCount) >= 0.8 ? 'text-emerald-400' :
                info.taskCount > 0 && (info.completedCount / info.taskCount) >= 0.5 ? 'text-amber-400' : 'text-red-400'
              }`}>
                {info.taskCount > 0 ? Math.round((info.completedCount / info.taskCount) * 100) : 0}%
              </p>
            </div>
            <div className="rounded-lg p-4 border" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
              <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Total Cost</p>
              <p className="text-2xl font-bold text-violet-400">${info.totalCost.toFixed(2)}</p>
            </div>
            <div className="rounded-lg p-4 border" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
              <p className="text-xs mb-1" style={{ color: 'var(--text-secondary)' }}>Status</p>
              {info.runningCount > 0 ? (
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse" />
                  <span className="text-lg font-bold text-blue-400">{info.runningCount} running</span>
                </div>
              ) : (
                <p className="text-2xl font-bold text-emerald-400">Idle</p>
              )}
            </div>
          </div>

          {/* Breakdown */}
          <div className="rounded-lg border p-4" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Task Breakdown</h3>
            <div className="flex gap-6 text-sm">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-emerald-500" />
                <span style={{ color: 'var(--text-secondary)' }}>Completed: <span className="font-medium text-emerald-400">{info.completedCount}</span></span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-red-500" />
                <span style={{ color: 'var(--text-secondary)' }}>Failed: <span className="font-medium text-red-400">{info.failedCount}</span></span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-blue-500" />
                <span style={{ color: 'var(--text-secondary)' }}>Running: <span className="font-medium text-blue-400">{info.runningCount}</span></span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-gray-500" />
                <span style={{ color: 'var(--text-secondary)' }}>Pending: <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{info.taskCount - info.completedCount - info.failedCount - info.runningCount}</span></span>
              </div>
            </div>
            {/* Progress bar */}
            {info.taskCount > 0 && (
              <div className="mt-3 h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-secondary, #1f2937)' }}>
                <div className="h-full flex">
                  <div className="bg-emerald-500" style={{ width: `${(info.completedCount / info.taskCount) * 100}%` }} />
                  <div className="bg-blue-500" style={{ width: `${(info.runningCount / info.taskCount) * 100}%` }} />
                  <div className="bg-red-500" style={{ width: `${(info.failedCount / info.taskCount) * 100}%` }} />
                </div>
              </div>
            )}
          </div>

          {/* Recent tasks (last 5) */}
          <div className="rounded-lg border p-4" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)' }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Recent Activity</h3>
              <button onClick={() => setActiveTab('tasks')} className="text-xs text-indigo-400 hover:text-indigo-300">
                View all &rarr;
              </button>
            </div>
            <div className="space-y-2">
              {projectTasks.slice(0, 5).map(t => (
                <Link key={t.id} href={`/tasks/${t.id}`} className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-800/50 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${
                      t.status === 'completed' ? 'bg-emerald-500' :
                      t.status === 'failed' || t.status === 'escalated' ? 'bg-red-500' :
                      ['planning', 'coding', 'verifying'].includes(t.status) ? 'bg-blue-500 animate-pulse' :
                      'bg-gray-500'
                    }`} />
                    <span className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{t.prompt}</span>
                  </div>
                  <span className="text-xs shrink-0 ml-3" style={{ color: 'var(--text-secondary)' }}>
                    {new Date(t.updatedAt).toLocaleDateString()}
                  </span>
                </Link>
              ))}
              {projectTasks.length === 0 && (
                <p className="text-sm py-2" style={{ color: 'var(--text-secondary)' }}>No tasks yet.</p>
              )}
            </div>
          </div>

          {/* Harness scope info */}
          <div className="text-xs px-3 py-2 rounded-lg" style={{ background: 'var(--bg-card)', borderColor: 'var(--border-color)', border: '1px solid var(--border-color)' }}>
            <span style={{ color: 'var(--text-secondary)' }}>Harness scope: </span>
            <span style={{ color: 'var(--text-primary)' }}>{projectDir}/.autodev/</span>
            {harnessAgents.length > 0 && harnessAgents.every(a => a.source !== 'project') && (
              <span className="text-amber-400 ml-2">(inheriting from global)</span>
            )}
            <button onClick={() => setActiveTab('harness')} className="ml-2 text-indigo-400 hover:text-indigo-300">
              Configure &rarr;
            </button>
          </div>
        </div>
      )}

      {/* Tasks Tab */}
      {activeTab === 'tasks' && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Task History</h2>
            {projectTasks.length > 0 && (
              <button onClick={handleDeleteAll} disabled={deleting}
                className="px-2 py-1 text-xs text-red-400 hover:text-red-300 hover:bg-red-900/20 rounded transition-colors disabled:opacity-50">
                Delete all
              </button>
            )}
          </div>
          <div className="space-y-2">
            {projectTasks.length === 0 ? (
              <p className="text-gray-500 text-sm p-4 bg-gray-900 rounded-lg border border-gray-800">No tasks yet.</p>
            ) : (
              projectTasks.map(t => (
                <div key={t.id} className="p-3 bg-gray-900 rounded-lg border border-gray-800 hover:border-gray-700 transition-colors">
                  <div className="flex items-start justify-between">
                    <Link href={`/tasks/${t.id}`} className="flex-1 min-w-0 mr-3">
                      <p className="text-sm text-gray-200 truncate">{t.prompt}</p>
                      <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                        <span className={`px-1.5 py-0.5 rounded-full font-medium ${
                          t.status === 'completed' ? 'bg-green-900/50 text-green-400' :
                          t.status === 'failed' || t.status === 'escalated' ? 'bg-red-900/50 text-red-400' :
                          'bg-gray-800 text-gray-400'
                        }`}>
                          {t.status}
                        </span>
                        {t.executionMode === 'auto-cycle' && (
                          <span className="text-amber-500">{t.cycleCount} cycles</span>
                        )}
                        <span>{new Date(t.createdAt).toLocaleString()}</span>
                      </div>
                    </Link>
                    <button onClick={() => handleDeleteTask(t.id)}
                      className="text-gray-600 hover:text-red-400 transition-colors p-1" title="Delete task">
                      x
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Files Tab */}
      {activeTab === 'files' && (
        <div>
          <h2 className="text-lg font-semibold mb-3">Files</h2>
          <div className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
            {files.length === 0 ? (
              <p className="text-gray-500 text-sm p-4">No files or directory not found.</p>
            ) : (
              <div className="divide-y divide-gray-800">
                {files.map((f, i) => (
                  <button
                    key={i}
                    onClick={() => f.type === 'file' ? loadFilePreview(f.name) : null}
                    className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                      f.type === 'file'
                        ? 'hover:bg-gray-800 cursor-pointer'
                        : 'text-gray-500 cursor-default'
                    } ${previewFile?.path === f.name ? 'bg-indigo-900/20 text-indigo-300' : 'text-gray-300'}`}
                  >
                    <span className="mr-2">{f.type === 'directory' ? '/' : ' '}</span>
                    {f.name}
                    {f.size !== undefined && <span className="text-gray-600 ml-2">{(f.size / 1024).toFixed(1)}KB</span>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {previewFile && (
            <div className="mt-3 rounded-lg border border-gray-700 overflow-hidden">
              <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 border-b border-gray-700">
                <span className="text-xs text-gray-400">{previewFile.path}</span>
                <button onClick={() => setPreviewFile(null)} className="text-xs text-gray-500 hover:text-gray-300">x</button>
              </div>
              <pre className="p-3 text-xs text-gray-300 overflow-x-auto max-h-80 bg-gray-950">
                <code>{previewFile.content}</code>
              </pre>
            </div>
          )}
        </div>
      )}

      {/* Harness Tab */}
      {activeTab === 'harness' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-gray-500">
              프로젝트별 에이전트 프롬프트 설정. 수정하면 이 프로젝트의 .autodev/agents/에 저장됩니다.
            </p>
          </div>

          {harnessMessage && (
            <div className="px-3 py-2 bg-emerald-900/30 text-emerald-400 text-sm rounded-lg border border-emerald-800">
              {harnessMessage}
            </div>
          )}

          {harnessAgents.map(agent => (
            <div key={agent.role} className="bg-gray-900/50 border border-gray-800 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <h3 className="text-sm font-semibold">{agent.role}.md</h3>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${sourceColor(agent.source)}`}>
                    {agent.source}
                  </span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setEditingAgent(agent.role); setEditContent(agent.content); }}
                    className="px-3 py-1 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg"
                  >
                    Edit
                  </button>
                  {agent.source === 'project' && (
                    <button
                      onClick={() => handleResetAgent(agent.role)}
                      className="px-3 py-1 text-xs text-red-400 hover:bg-red-900/20 rounded-lg"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>
              <pre className="text-xs text-gray-400 max-h-24 overflow-y-auto whitespace-pre-wrap bg-gray-950 rounded-lg p-3">
                {agent.content.slice(0, 300)}{agent.content.length > 300 ? '...' : ''}
              </pre>
            </div>
          ))}

          {/* Edit Modal */}
          {editingAgent && (
            <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-8">
              <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-3xl max-h-[80vh] flex flex-col">
                <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-semibold">{editingAgent}.md</h3>
                    <span className="text-[10px] px-2 py-0.5 rounded-full text-teal-400 bg-teal-900/30">
                      → project
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setEditingAgent(null)} className="px-3 py-1 text-xs text-gray-400 hover:text-gray-200">
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveAgent}
                      className="px-4 py-1 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg"
                    >
                      Save to Project
                    </button>
                  </div>
                </div>
                <textarea
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  className="flex-1 p-4 bg-gray-950 text-sm text-gray-200 font-mono resize-none outline-none"
                  spellCheck={false}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
