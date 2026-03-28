'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function SetupPage() {
  const [anthropicKey, setAnthropicKey] = useState('');
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  const handleSave = async () => {
    setSaving(true);
    await fetch('/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anthropicKey }),
    });
    router.push('/');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 text-gray-100">
      <div className="w-full max-w-md p-8 space-y-6">
        <h1 className="text-2xl font-bold">AutoDev Setup</h1>
        <p className="text-gray-400">API key is optional — only needed for &apos;API&apos; planning mode.</p>
        <div>
          <label className="block text-sm text-gray-400 mb-1">Anthropic API Key *</label>
          <input
            type="password"
            value={anthropicKey}
            onChange={(e) => setAnthropicKey(e.target.value)}
            placeholder="sk-ant-..."
            className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-600 focus:outline-none focus:border-indigo-500"
          />
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
