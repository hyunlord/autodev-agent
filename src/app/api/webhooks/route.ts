import { NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { webhooks } from '@/lib/db/schema';
import { desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';

const VALID_EVENTS = new Set(['completed', 'failed', 'low_score']);

function validateUrlForPlatform(url: string, platform: 'slack' | 'discord'): string | null {
  try {
    const u = new URL(url);
    if (platform === 'slack' && !u.host.endsWith('slack.com')) {
      return 'Slack URL must be on hooks.slack.com';
    }
    if (platform === 'discord' && !u.host.endsWith('discord.com')) {
      return 'Discord URL must be on discord.com';
    }
  } catch {
    return 'Invalid URL';
  }
  return null;
}

export async function GET() {
  const rows = db.select().from(webhooks).orderBy(desc(webhooks.createdAt)).all();
  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, url, platform, events, enabled = true } = body ?? {};

    if (!name || !url || !platform) {
      return NextResponse.json({ error: 'name, url, platform required' }, { status: 400 });
    }
    if (platform !== 'slack' && platform !== 'discord') {
      return NextResponse.json({ error: 'platform must be slack or discord' }, { status: 400 });
    }
    if (!Array.isArray(events) || events.length === 0) {
      return NextResponse.json({ error: 'events must be a non-empty array' }, { status: 400 });
    }
    for (const e of events) {
      if (!VALID_EVENTS.has(e)) {
        return NextResponse.json({ error: `invalid event: ${e}` }, { status: 400 });
      }
    }
    const urlErr = validateUrlForPlatform(url, platform);
    if (urlErr) return NextResponse.json({ error: urlErr }, { status: 400 });

    const row = {
      id: nanoid(),
      name: String(name).slice(0, 100),
      url: String(url),
      platform,
      events,
      enabled: !!enabled,
      lastTriggeredAt: null,
      lastError: null,
      createdAt: new Date().toISOString(),
    };
    db.insert(webhooks).values(row).run();
    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
