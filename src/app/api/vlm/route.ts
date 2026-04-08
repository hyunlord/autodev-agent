import { NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const CONFIG_PATH = join(homedir(), '.autodev', 'vlm-config.json');

interface VlmConfig {
  enabled: boolean;
  provider: 'openrouter' | 'anthropic';
  apiKey: string;
  model: string;
}

function loadConfig(): VlmConfig {
  const defaults: VlmConfig = {
    enabled: false,
    provider: 'openrouter',
    apiKey: '',
    model: 'google/gemini-2.5-flash',
  };
  if (!existsSync(CONFIG_PATH)) return defaults;
  try {
    return { ...defaults, ...JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) };
  } catch { return defaults; }
}

function saveConfig(config: VlmConfig): void {
  mkdirSync(join(homedir(), '.autodev'), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}

export async function GET() {
  const config = loadConfig();
  return NextResponse.json({
    enabled: config.enabled,
    provider: config.provider,
    model: config.model,
    apiKey: config.apiKey ? '***' + config.apiKey.slice(-4) : '',
    hasKey: !!config.apiKey,
  });
}

export async function POST(req: Request) {
  const body = await req.json();
  const current = loadConfig();

  const maskedCurrent = '***' + current.apiKey.slice(-4);
  const updated: VlmConfig = {
    enabled: body.enabled ?? current.enabled,
    provider: body.provider ?? current.provider,
    apiKey: body.apiKey && body.apiKey !== maskedCurrent ? body.apiKey : current.apiKey,
    model: body.model ?? current.model,
  };

  saveConfig(updated);

  return NextResponse.json({ success: true });
}
