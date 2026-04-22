export function buildDiscordPayload(body: Record<string, unknown>): Record<string, unknown> {
  // Already Discord-shaped
  if ('content' in body || 'embeds' in body) return body;
  // Simple message shorthand
  if ('message' in body) return { content: String(body.message) };
  if ('text' in body) return { content: String(body.text) };
  // Fallback
  return { content: JSON.stringify(body) };
}
