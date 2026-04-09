'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function SetupPage() {
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  // VLM settings
  const [vlmEnabled, setVlmEnabled] = useState(false);
  const [vlmProvider, setVlmProvider] = useState<'openrouter'>('openrouter');
  const [vlmApiKey, setVlmApiKey] = useState('');
  const [vlmModel, setVlmModel] = useState('google/gemini-3.1-flash-lite-preview');
  const [vlmStatus, setVlmStatus] = useState<'idle' | 'ok' | 'error' | 'testing'>('idle');

  useEffect(() => {
    fetch('/api/vlm').then(r => r.json()).then(data => {
      setVlmEnabled(data.enabled);
      setVlmProvider(data.provider);
      setVlmModel(data.model);
      if (data.hasKey) setVlmApiKey(data.apiKey);
    }).catch(() => {});
  }, []);

  const testVlm = async () => {
    setVlmStatus('testing');
    // 먼저 현재 설정 저장
    await fetch('/api/vlm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: vlmEnabled, provider: vlmProvider, apiKey: vlmApiKey, model: vlmModel }),
    });
    const res = await fetch('/api/vlm/test', { method: 'POST' });
    const data = await res.json();
    setVlmStatus(data.status === 'ok' ? 'ok' : 'error');
  };

  const handleSave = async () => {
    setSaving(true);
    await Promise.all([
      fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      fetch('/api/vlm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: vlmEnabled, provider: vlmProvider, apiKey: vlmApiKey, model: vlmModel }),
      }),
    ]);
    router.push('/');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 text-gray-100">
      <div className="w-full max-w-md p-8 space-y-6">
        <h1 className="text-2xl font-bold">AutoDev Setup</h1>
        {/* VLM Settings */}
        <div className="bg-gray-900/50 rounded-xl border border-gray-800 p-4 space-y-3">
          <h3 className="text-sm font-semibold">Visual Analysis (VLM)</h3>
          <p className="text-xs text-gray-500">
            Verification 시 스크린샷을 Vision LLM으로 분석하여 디자인 품질을 자동 채점합니다.
          </p>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={vlmEnabled}
              onChange={(e) => setVlmEnabled(e.target.checked)}
              className="rounded border-gray-700 bg-gray-800 text-indigo-600"
            />
            <span className="text-sm text-gray-300">VLM 시각 분석 활성화</span>
          </label>

          {vlmEnabled && (
            <>
              <div>
                <label className="block text-xs text-gray-500 mb-1">API Provider</label>
                <div className="flex gap-1">
                  <button
                    onClick={() => setVlmProvider('openrouter')}
                    className="px-2.5 py-1 text-xs rounded-lg transition-colors bg-indigo-600 text-white"
                  >
                    OpenRouter
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">API Key</label>
                <input
                  type="password"
                  value={vlmApiKey}
                  onChange={(e) => setVlmApiKey(e.target.value)}
                  placeholder="sk-or-..."
                  className="w-full px-3 py-2 text-xs bg-gray-800 border border-gray-700 rounded-lg text-gray-300 placeholder-gray-600 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1">Model</label>
                <input
                  type="text"
                  value={vlmModel}
                  onChange={(e) => setVlmModel(e.target.value)}
                  placeholder="google/gemini-3.1-flash-lite-preview"
                  className="w-full px-3 py-2 text-xs bg-gray-800 border border-gray-700 rounded-lg text-gray-300 placeholder-gray-600 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${
                  vlmStatus === 'ok' ? 'bg-green-500' :
                  vlmStatus === 'error' ? 'bg-red-500' :
                  vlmStatus === 'testing' ? 'bg-yellow-500 animate-pulse' : 'bg-gray-600'
                }`} />
                <span className="text-xs text-gray-500">
                  {vlmStatus === 'ok' ? 'Connected' :
                   vlmStatus === 'error' ? 'Connection failed' :
                   vlmStatus === 'testing' ? 'Testing...' : 'Not tested'}
                </span>
                <button
                  onClick={testVlm}
                  disabled={vlmStatus === 'testing'}
                  className="text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-40"
                >
                  Test
                </button>
              </div>
            </>
          )}
        </div>

        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded-lg font-medium transition-colors"
        >
          {saving ? 'Saving...' : 'Save & Continue'}
        </button>
        <a href="/" className="block text-center text-sm text-gray-500 hover:text-gray-300 mt-3">
          Skip — I&apos;ll use Auto or Manual planning mode
        </a>
      </div>
    </div>
  );
}
