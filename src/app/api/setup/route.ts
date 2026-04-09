import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { NextResponse } from 'next/server';

const DATA_DIR = join(process.cwd(), '.autodev');
const ENV_PATH = join(DATA_DIR, '.env');

export async function POST(req: Request) {
  const body = await req.json();
  const { openaiKey } = body;

  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  let envContent = '';
  if (openaiKey) {
    envContent += `OPENAI_API_KEY=${openaiKey}\n`;
  }

  writeFileSync(ENV_PATH, envContent);

  return NextResponse.json({ success: true });
}
