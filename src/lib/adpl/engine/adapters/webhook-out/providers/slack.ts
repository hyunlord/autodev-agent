export function buildSlackPayload(body: Record<string, unknown>): Record<string, unknown> {
  // Already Slack-shaped
  if ('text' in body || 'blocks' in body || 'attachments' in body) return body;
  // Simple message shorthand
  if ('message' in body) return { text: String(body.message) };
  // Fallback
  return { text: JSON.stringify(body) };
}
