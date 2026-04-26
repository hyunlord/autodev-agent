import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import { estimateTokens } from '../util/estimate-tokens';

export interface Fragment {
  name: string;
  description: string;
  keywords: string[];
  body: string;
  estimatedTokens: number;
}

const FRAGMENTS_DIR = join(process.cwd(), '.autodev', 'agents', 'ai-builder-fragments');

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;

function parseFragmentFile(filePath: string, name: string): Fragment {
  const raw = readFileSync(filePath, 'utf-8');
  const match = raw.match(FRONTMATTER_RE);
  if (!match) {
    throw new Error(`Fragment '${name}' is missing frontmatter at ${filePath}`);
  }
  const fm = (yaml.load(match[1]) ?? {}) as Record<string, unknown>;
  const body = match[2].trim();
  const description = typeof fm.description === 'string' ? fm.description : '';
  const keywords = Array.isArray(fm.keywords)
    ? (fm.keywords as unknown[]).map((k) => String(k))
    : [];
  return { name, description, keywords, body, estimatedTokens: estimateTokens(body) };
}

export function loadFragment(name: string): Fragment {
  const filePath = join(FRAGMENTS_DIR, `${name}.md`);
  if (!existsSync(filePath)) {
    throw new Error(`Fragment '${name}' not found at ${filePath}`);
  }
  return parseFragmentFile(filePath, name);
}

export function loadAllFragments(): Fragment[] {
  if (!existsSync(FRAGMENTS_DIR)) return [];
  return readdirSync(FRAGMENTS_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => parseFragmentFile(join(FRAGMENTS_DIR, f), f.replace(/\.md$/, '')));
}
