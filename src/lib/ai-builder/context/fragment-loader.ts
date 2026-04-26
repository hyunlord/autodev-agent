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

function freezeFragment(f: Fragment): Readonly<Fragment> {
  Object.freeze(f.keywords);
  return Object.freeze(f);
}

export function loadFragment(name: string): Readonly<Fragment> {
  const filePath = join(FRAGMENTS_DIR, `${name}.md`);
  if (!existsSync(filePath)) {
    throw new Error(`Fragment '${name}' not found at ${filePath}`);
  }
  return freezeFragment(parseFragmentFile(filePath, name));
}

let cached: ReadonlyArray<Readonly<Fragment>> | null = null;

export function loadAllFragments(): ReadonlyArray<Readonly<Fragment>> {
  if (cached) return cached;
  if (!existsSync(FRAGMENTS_DIR)) {
    cached = Object.freeze([]);
    return cached;
  }
  const result = readdirSync(FRAGMENTS_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => parseFragmentFile(join(FRAGMENTS_DIR, f), f.replace(/\.md$/, '')))
    .map(freezeFragment);
  cached = Object.freeze(result);
  return cached;
}

/** Test-only — clears the in-memory fragment cache. */
export function __resetFragmentCache(): void {
  cached = null;
}
