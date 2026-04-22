import { describe, it, expect } from 'vitest';
import { buildSlackPayload } from '../providers/slack';
import { buildDiscordPayload } from '../providers/discord';
import { buildTeamsPayload } from '../providers/teams';
import { buildGenericPayload } from '../providers/generic';

// ─── Slack ───────────────────────────────────────────
describe('buildSlackPayload', () => {
  it('string in message field → { text: message }', () => {
    expect(buildSlackPayload({ message: 'Hello Slack' })).toEqual({ text: 'Hello Slack' });
  });

  it('already has text field → pass-through', () => {
    const body = { text: 'Already formatted', username: 'Bot' };
    expect(buildSlackPayload(body)).toBe(body);
  });

  it('already has blocks field → pass-through', () => {
    const body = { blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'test' } }] };
    expect(buildSlackPayload(body)).toBe(body);
  });

  it('already has attachments field → pass-through', () => {
    const body = { attachments: [{ text: 'attachment' }] };
    expect(buildSlackPayload(body)).toBe(body);
  });

  it('arbitrary object without known fields → stringified text', () => {
    const result = buildSlackPayload({ custom: 'field', count: 3 });
    expect(result).toEqual({ text: JSON.stringify({ custom: 'field', count: 3 }) });
  });
});

// ─── Discord ─────────────────────────────────────────
describe('buildDiscordPayload', () => {
  it('message field → { content: message }', () => {
    expect(buildDiscordPayload({ message: 'Hello Discord' })).toEqual({ content: 'Hello Discord' });
  });

  it('text field → { content: text }', () => {
    expect(buildDiscordPayload({ text: 'from text' })).toEqual({ content: 'from text' });
  });

  it('already has content field → pass-through', () => {
    const body = { content: 'Direct content', username: 'Bot' };
    expect(buildDiscordPayload(body)).toBe(body);
  });

  it('already has embeds field → pass-through', () => {
    const body = { embeds: [{ title: 'embed', description: 'desc' }] };
    expect(buildDiscordPayload(body)).toBe(body);
  });

  it('arbitrary object without known fields → stringified content', () => {
    const result = buildDiscordPayload({ data: 42 });
    expect(result).toEqual({ content: JSON.stringify({ data: 42 }) });
  });
});

// ─── Teams ───────────────────────────────────────────
describe('buildTeamsPayload', () => {
  it('message field → { text: message }', () => {
    expect(buildTeamsPayload({ message: 'Hello Teams' })).toEqual({ text: 'Hello Teams' });
  });

  it('already has text field → pass-through', () => {
    const body = { text: 'Direct text' };
    expect(buildTeamsPayload(body)).toBe(body);
  });

  it('already has @type field (MessageCard) → pass-through', () => {
    const body = {
      '@type': 'MessageCard',
      '@context': 'https://schema.org/extensions',
      summary: 'Test',
      themeColor: '0076D7',
      text: 'Body text',
    };
    expect(buildTeamsPayload(body)).toBe(body);
  });

  it('arbitrary object without known fields → stringified text', () => {
    const result = buildTeamsPayload({ status: 'ok', code: 200 });
    expect(result).toEqual({ text: JSON.stringify({ status: 'ok', code: 200 }) });
  });
});

// ─── Generic ─────────────────────────────────────────
describe('buildGenericPayload', () => {
  it('returns body as-is (reference equality)', () => {
    const body = { foo: 'bar', num: 42, nested: { a: 1 } };
    expect(buildGenericPayload(body)).toBe(body);
  });

  it('empty object → empty object', () => {
    const body = {};
    expect(buildGenericPayload(body)).toBe(body);
  });
});
