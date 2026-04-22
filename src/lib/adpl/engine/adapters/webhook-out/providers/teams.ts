export function buildTeamsPayload(body: Record<string, unknown>): Record<string, unknown> {
  // Already Teams-shaped (MessageCard or simple text)
  if ('@type' in body || 'text' in body) return body;
  // Simple message shorthand
  if ('message' in body) return { text: String(body.message) };
  // Fallback
  return { text: JSON.stringify(body) };
}
