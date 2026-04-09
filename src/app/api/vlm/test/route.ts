import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CONFIG_PATH = join(homedir(), '.autodev', 'vlm-config.json');

interface VlmConfig {
  enabled: boolean;
  provider: 'openrouter';
  apiKey: string;
  model: string;
}

function loadConfig(): VlmConfig {
  const defaults: VlmConfig = {
    enabled: false,
    provider: 'openrouter',
    apiKey: '',
    model: 'google/gemini-3.1-flash-lite-preview',
  };
  if (!existsSync(CONFIG_PATH)) return defaults;
  try {
    return { ...defaults, ...JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) };
  } catch { return defaults; }
}

export async function POST() {
  const config = loadConfig();
  if (!config.apiKey) {
    return NextResponse.json({ status: 'error', message: 'No API key configured' });
  }

  try {
    if (config.provider === 'openrouter') {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { 'Authorization': `Bearer ${config.apiKey}` },
      });
      if (res.ok) {
        return NextResponse.json({ status: 'ok', message: 'OpenRouter connected' });
      }
      return NextResponse.json({ status: 'error', message: `HTTP ${res.status}` });
    }

    return NextResponse.json({ status: 'error', message: `HTTP unknown provider` });
  } catch (err) {
    return NextResponse.json({ status: 'error', message: String(err) });
  }
}
