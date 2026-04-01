'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';

interface AgentFile {
  role: string;
  content: string;
  source: 'project' | 'global' | 'default';
  filePath?: string;
}

interface McpServer {
  id: string;
  type: string;
  enabled: boolean;
  url?: string;
  command?: string;
  args?: string[];
  stages: string[];
}

interface Project {
  projectDir: string;
  taskCount: number;
}

export default function HarnessPage() {
  const [tab, setTab] = useState<'agents' | 'mcp' | 'presets'>('agents');
  const [agents, setAgents] = useState<AgentFile[]>([]);
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
  const [editingRole, setEditingRole] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  // Scope selector
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedScope, setSelectedScope] = useState<string>('global'); // 'global' or projectDir

  // Load project list
  useEffect(() => {
    fetch('/api/projects').then(r => r.json()).then(setProjects).catch(() => {});
  }, []);

  // Load agents based on scope
  useEffect(() => {
    const params = selectedScope !== 'global'
      ? `?projectDir=${encodeURIComponent(selectedScope)}`
      : '';
    fetch(`/api/harness${params}`)
      .then(r => r.json())
      .then(data => setAgents(data.agents ?? []))
      .catch(() => {});
  }, [selectedScope]);

  useEffect(() => {
    fetch('/api/mcp')
      .then(r => r.json())
      .then(data => setMcpServers(data.servers ?? []))
      .catch(() => {});
  }, []);

  const handleEdit = (role: string, content: string) => {
    setEditingRole(role);
    setEditContent(content);
  };

  const handleSave = async () => {
    if (!editingRole) return;
    setSaving(true);
    try {
      const isProject = selectedScope !== 'global';
      const res = await fetch('/api/harness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'agent',
          role: editingRole,
          content: editContent,
          scope: isProject ? 'project' : 'global',
          projectDir: isProject ? selectedScope : undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage(`Saved ${editingRole}.md → ${data.scope} (${data.filePath})`);
        setAgents(prev => prev.map(a =>
          a.role === editingRole ? { ...a, content: editContent, source: data.scope, filePath: data.filePath } : a
        ));
        setEditingRole(null);
      }
    } catch {
      setMessage('Save failed');
    }
    setSaving(false);
    setTimeout(() => setMessage(''), 3000);
  };

  const handleReset = async (role: string) => {
    if (!confirm(`Reset ${role}.md to default? Your customizations will be deleted.`)) return;
    const isProject = selectedScope !== 'global';
    const params = new URLSearchParams({ role, scope: isProject ? 'project' : 'global' });
    if (isProject) params.set('projectDir', selectedScope);
    await fetch(`/api/harness?${params}`, { method: 'DELETE' });
    // Reload
    const fetchParams = isProject ? `?projectDir=${encodeURIComponent(selectedScope)}` : '';
    const res = await fetch(`/api/harness${fetchParams}`);
    const data = await res.json();
    setAgents(data.agents ?? []);
    setMessage(`${role}.md reset to default`);
    setTimeout(() => setMessage(''), 3000);
  };

  const sourceColor = (source: string) => {
    if (source === 'project') return 'text-teal-400 bg-teal-900/30';
    if (source === 'global') return 'text-purple-400 bg-purple-900/30';
    return 'text-gray-400 bg-gray-800';
  };

  return (
    <div className="min-h-screen p-8 max-w-5xl mx-auto">
      <Link href="/" className="text-indigo-400 hover:text-indigo-300 text-sm mb-4 inline-block">
        &larr; Dashboard
      </Link>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Harness Editor</h1>
          <p className="text-sm text-gray-500 mt-1">에이전트 프롬프트, MCP 설정, 프리셋 관리</p>
        </div>
      </div>

      {message && (
        <div className="mb-4 px-3 py-2 bg-emerald-900/30 text-emerald-400 text-sm rounded-lg border border-emerald-800">
          {message}
        </div>
      )}

      {/* Scope Selector */}
      <div className="flex items-center gap-3 mb-4">
        <label className="text-xs text-gray-500">Scope:</label>
        <select
          value={selectedScope}
          onChange={e => setSelectedScope(e.target.value)}
          className="px-3 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-gray-300 focus:outline-none focus:border-indigo-500"
        >
          <option value="global">Global (~/.autodev/)</option>
          {projects.map(p => (
            <option key={p.projectDir} value={p.projectDir}>
              {p.projectDir.split('/').slice(-2).join('/')} ({p.taskCount} tasks)
            </option>
          ))}
        </select>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6">
        {(['agents', 'mcp', 'presets'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm rounded-lg transition-colors ${
              tab === t ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {t === 'agents' ? 'Agents' : t === 'mcp' ? 'MCP Servers' : 'Presets'}
          </button>
        ))}
      </div>

      {/* Agents Tab */}
      {tab === 'agents' && (
        <div className="space-y-3">
          {agents.map(agent => (
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
                    onClick={() => handleEdit(agent.role, agent.content)}
                    className="px-3 py-1 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors"
                  >
                    Edit
                  </button>
                  {agent.source !== 'default' && (
                    <button
                      onClick={() => handleReset(agent.role)}
                      className="px-3 py-1 text-xs text-red-400 hover:bg-red-900/20 rounded-lg transition-colors"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>
              <pre className="text-xs text-gray-400 max-h-32 overflow-y-auto whitespace-pre-wrap bg-gray-950 rounded-lg p-3">
                {agent.content.slice(0, 500)}{agent.content.length > 500 ? '...' : ''}
              </pre>
              {agent.filePath && (
                <p className="text-[10px] text-gray-600 mt-2">{agent.filePath}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* MCP Tab */}
      {tab === 'mcp' && (
        <div className="space-y-3">
          {mcpServers.length === 0 ? (
            <p className="text-gray-500 text-sm p-4 bg-gray-900 rounded-lg border border-gray-800">
              No MCP servers configured.
            </p>
          ) : (
            mcpServers.map(server => (
              <div key={server.id} className="bg-gray-900/50 border border-gray-800 rounded-xl p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className={`w-2 h-2 rounded-full ${server.enabled ? 'bg-emerald-400' : 'bg-gray-600'}`} />
                    <h3 className="text-sm font-semibold">{server.id}</h3>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-800 text-gray-400">
                      {server.type}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {server.stages.map(s => (
                      <span key={s} className="text-[10px] px-2 py-0.5 rounded-full bg-blue-900/30 text-blue-400">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="mt-2 text-xs text-gray-500">
                  {server.url && <span>{server.url}</span>}
                  {server.command && <span>{server.command} {server.args?.join(' ')}</span>}
                </div>
              </div>
            ))
          )}
          <p className="text-xs text-gray-600 mt-4">
            MCP 설정을 변경하려면 ~/.autodev/mcp/config.json 또는 프로젝트/.autodev/mcp/config.json을 편집하세요.
          </p>
        </div>
      )}

      {/* Presets Tab */}
      {tab === 'presets' && (
        <div className="space-y-3">
          {['default', 'sniper', 'artisan', 'guardian', 'speed', 'experimental'].map(name => (
            <div key={name} className="bg-gray-900/50 border border-gray-800 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold capitalize">{name}</h3>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-800 text-gray-400">
                  built-in
                </span>
              </div>
            </div>
          ))}
          <p className="text-xs text-gray-600 mt-4">
            커스텀 프리셋을 추가하려면 ~/.autodev/presets/{'{name}'}.md 파일을 생성하세요.
          </p>
        </div>
      )}

      {/* Edit Modal */}
      {editingRole && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-8">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-3xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-800">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">{editingRole}.md</h3>
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                  selectedScope !== 'global' ? 'text-teal-400 bg-teal-900/30' : 'text-purple-400 bg-purple-900/30'
                }`}>
                  → {selectedScope !== 'global' ? 'project' : 'global'}
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setEditingRole(null)}
                  className="px-3 py-1 text-xs text-gray-400 hover:text-gray-200"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-1 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg disabled:opacity-50"
                >
                  {saving ? 'Saving...' : selectedScope !== 'global' ? 'Save to Project' : 'Save'}
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
  );
}
