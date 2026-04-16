import { NextResponse } from 'next/server';
import { HealthMonitor } from '@/agents/health-monitor';

export async function GET() {
  try {
    const healths = await HealthMonitor.checkAll();
    return NextResponse.json({ healths });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message, healths: [] }, { status: 500 });
  }
}
