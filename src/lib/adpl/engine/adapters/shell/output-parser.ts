import type { ShellOutputFormat } from '@/lib/adpl/types/nodes/shell';

export const MAX_OUTPUT_BYTES = 10 * 1024 * 1024; // 10MB

export function parseOutput(raw: Buffer, format: ShellOutputFormat): unknown {
  switch (format) {
    case 'auto':
      return tryJsonElseText(raw);
    case 'text':
      return raw.toString('utf-8').trim();
    case 'json':
      return JSON.parse(raw.toString('utf-8'));
    case 'lines':
      return raw.toString('utf-8').split(/\r?\n/).filter(Boolean);
    case 'binary':
      return { encoding: 'base64', data: raw.toString('base64'), size: raw.length };
  }
}

function tryJsonElseText(raw: Buffer): unknown {
  const text = raw.toString('utf-8').trim();
  if (!text) return text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
