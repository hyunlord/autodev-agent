import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { NextResponse } from 'next/server';

const DATA_DIR = join(process.cwd(), '.autodev');
const ENV_PATH = join(DATA_DIR, '.env');

export async function POST(req: Request) {
  const body = await req.json();
  const { anthropicKey, openaiKey } = body;

  if (!anthropicKey || typeof anthropicKey !== 'string') {
    return NextResponse.json({ error: 'anthropicKey is required' }, { status: 400 });
  }

  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  let envContent = `ANTHROPIC_API_KEY=${anthropicKey}\n`;
  if (openaiKey) {
    envContent += `OPENAI_API_KEY=${openaiKey}\n`;
  }

  writeFileSync(ENV_PATH, envContent);

  return NextResponse.json({ success: true });
}
