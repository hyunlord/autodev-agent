'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from '@/i18n/context';

interface Webhook {
  id: string;
  name: string;
  url: string;
  platform: 'slack' | 'discord';
  events: Array<'completed' | 'failed' | 'low_score'>;
  enabled: boolean;
  lastTriggeredAt: string | null;
  lastError: string | null;
  createdAt: string;
}

const ALL_EVENTS: Array<'completed' | 'failed' | 'low_score'> = ['completed', 'failed', 'low_score'];

export default function WebhooksTab() {
  const t = useTranslations('webhooks');
  const [rows, setRows] = useState<Webhook[]>([]);
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  const [form, setForm] = useState<{
    name: string;
    url: string;
    platform: 'slack' | 'discord';
    events: Set<'completed' | 'failed' | 'low_score'>;
  }>({ name: '', url: '', platform: 'slack', events: new Set(['completed', 'failed']) });

  const reload = async () => {
    try {
      const r = await fetch('/api/webhooks');
      setRows(await r.json());
    } catch { /* silent */ }
  };

  useEffect(() => { reload(); }, []);

  const showToast = (type: 'ok' | 'err', msg: string) => {
    setToast({ type, msg });
    setTimeout(() => setToast(null), 3000);
  };

  const handleCreate = async () => {
    if (!form.name.trim() || !form.url.trim() || form.events.size === 0) {
      showToast('err', t('validation.eventsRequired'));
      return;
    }
    try {
      const res = await fetch('/api/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, events: [...form.events] }),
      });
      const body = await res.json();
      if (!res.ok) {
        showToast('err', body.error ?? 'Failed');
        return;
      }
      setAdding(false);
      setForm({ name: '', url: '', platform: 'slack', events: new Set(['completed', 'failed']) });
      showToast('ok', t('toast.saved'));
      await reload();
    } catch (err) {
      showToast('err', (err as Error).message);
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    await fetch(`/api/webhooks/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    await reload();
  };

  const handleDelete = async (id: string) => {
    if (!confirm(t('confirmDelete'))) return;
    await fetch(`/api/webhooks/${id}`, { method: 'DELETE' });
    showToast('ok', t('toast.deleted'));
    await reload();
  };

  const handleTest = async (id: string) => {
    try {
      const res = await fetch('/api/webhooks/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const body = await res.json();
      if (body.ok) {
        showToast('ok', t('toast.testSent'));
      } else {
        showToast('err', `${t('toast.testFailed')}: ${body.error ?? 'unknown'}`);
      }
      await reload();
    } catch (err) {
      showToast('err', (err as Error).message);
    }
  };

  const urlPlaceholder = form.platform === 'slack'
    ? 'https://hooks.slack.com/services/...'
    : 'https://discord.com/api/webhooks/...';

  return (
    <div className="space-y-3">
      {toast && (
        <div className={`px-3 py-2 rounded-lg text-xs ${toast.type === 'ok' ? 'bg-emerald-900/30 text-emerald-400' : 'bg-red-900/30 text-red-400'}`}>
          {toast.msg}
        </div>
      )}

      <div className="flex justify-between items-center">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('title')}</h3>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="px-3 py-1 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg transition-colors"
          >
            {t('addButton')}
          </button>
        )}
      </div>

      {adding && (
        <div className="border rounded-xl p-4 space-y-3" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
          <input
            type="text"
            placeholder="Team Slack"
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            className="w-full px-2 py-1 text-xs rounded border"
            style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
          />
          <div className="flex gap-3 text-xs" style={{ color: 'var(--text-primary)' }}>
            {(['slack', 'discord'] as const).map(p => (
              <label key={p} className="flex items-center gap-1">
                <input
                  type="radio"
                  checked={form.platform === p}
                  onChange={() => setForm({ ...form, platform: p })}
                />
                {t(`platform.${p}`)}
              </label>
            ))}
          </div>
          <input
            type="text"
            placeholder={urlPlaceholder}
            value={form.url}
            onChange={e => setForm({ ...form, url: e.target.value })}
            className="w-full px-2 py-1 text-xs rounded border font-mono"
            style={{ background: 'var(--bg-primary)', borderColor: 'var(--border-color)', color: 'var(--text-primary)' }}
          />
          <div className="flex gap-3 text-xs" style={{ color: 'var(--text-primary)' }}>
            {ALL_EVENTS.map(evt => (
              <label key={evt} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={form.events.has(evt)}
                  onChange={() => {
                    const next = new Set(form.events);
                    if (next.has(evt)) next.delete(evt); else next.add(evt);
                    setForm({ ...form, events: next });
                  }}
                />
                {t(`events.${evt === 'low_score' ? 'lowScore' : evt}`)}
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setAdding(false)}
              className="px-3 py-1 text-xs border rounded-lg"
              style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}
            >
              {t('actions.cancel')}
            </button>
            <button
              onClick={handleCreate}
              className="px-3 py-1 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg"
            >
              {t('actions.save')}
            </button>
          </div>
        </div>
      )}

      {rows.length === 0 && !adding && (
        <p className="text-xs p-4 rounded-lg border" style={{ color: 'var(--text-secondary)', background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
          {t('noWebhooks')}
        </p>
      )}

      {rows.map(w => (
        <div key={w.id} className="border rounded-xl p-4" style={{ background: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className={`w-2 h-2 rounded-full ${w.enabled ? 'bg-emerald-400' : 'bg-gray-500'}`} />
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{w.name}</h3>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-900/30 text-blue-400">
                {t(`platform.${w.platform}`)}
              </span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => handleTest(w.id)}
                className="px-3 py-1 text-xs border border-indigo-600 text-indigo-400 hover:bg-indigo-600 hover:text-white rounded-lg"
              >
                {t('actions.test')}
              </button>
              <button
                onClick={() => handleToggle(w.id, !w.enabled)}
                className="px-3 py-1 text-xs border rounded-lg"
                style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}
              >
                {w.enabled ? t('actions.disable') : t('actions.enable')}
              </button>
              <button
                onClick={() => handleDelete(w.id)}
                className="px-3 py-1 text-xs border border-red-600 text-red-400 hover:bg-red-600 hover:text-white rounded-lg"
              >
                {t('actions.delete')}
              </button>
            </div>
          </div>
          <div className="mt-2 flex gap-2 flex-wrap">
            {w.events.map(evt => (
              <span key={evt} className="text-[10px] px-2 py-0.5 rounded-full bg-purple-900/30 text-purple-400">
                {t(`events.${evt === 'low_score' ? 'lowScore' : evt}`)}
              </span>
            ))}
          </div>
          {w.lastTriggeredAt && (
            <div className="mt-2 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
              Last: {new Date(w.lastTriggeredAt).toLocaleString()}
              {w.lastError && <span className="ml-2 text-red-400">⚠ {w.lastError.slice(0, 100)}</span>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
