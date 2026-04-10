import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, extname, basename } from 'path';

export interface PromptFile {
  name: string;          // 파일명 (확장자 제외)
  stage: 'planning' | 'coding' | 'verification' | 'all';  // 적용 단계
  content: string;       // 프롬프트 내용 (lazy load 후에만 채워짐)
  source: string;        // 파일 경로
  /** Index-only fields (always loaded) */
  summary: string;       // frontmatter description 또는 첫 줄
  triggerKeywords: string[];  // frontmatter keywords
  /** Whether full content has been loaded */
  _contentLoaded: boolean;
}

/**
 * .autodev/prompts/ 폴더에서 프롬프트 파일 로드 (인덱스만).
 *
 * Stage 1: frontmatter + 첫 줄만 파싱 (content는 빈 문자열).
 * Stage 2: getPromptsForStage() 또는 loadPromptContent()로 전체 내용 로드.
 *
 * 파일명 규칙:
 *   planning-*.md  → Planning Agent에 주입
 *   coding-*.md    → Coding Agent에 주입
 *   verify-*.md    → Verify Agent에 주입
 *   *.md (접두사 없음) → 모든 단계에 주입
 */
export function loadPromptLibrary(projectDir: string): PromptFile[] {
  const prompts: PromptFile[] = [];

  // 프로젝트 .autodev/prompts/
  const projectPromptsDir = join(projectDir, '.autodev', 'prompts');
  if (existsSync(projectPromptsDir)) {
    prompts.push(...loadFromDir(projectPromptsDir));
  }

  // 글로벌 ~/.autodev/prompts/
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? '';
  const globalPromptsDir = join(homeDir, '.autodev', 'prompts');
  if (existsSync(globalPromptsDir)) {
    prompts.push(...loadFromDir(globalPromptsDir));
  }

  return prompts;
}

/**
 * 특정 단계의 프롬프트만 가져오기 (전체 내용 로드 포함 — 기존 호환)
 */
export function getPromptsForStage(
  prompts: PromptFile[],
  stage: 'planning' | 'coding' | 'verification',
): string {
  const matching = prompts.filter(p => p.stage === stage || p.stage === 'all');
  if (matching.length === 0) return '';

  // 전체 내용 로드
  const loaded = matching.map(loadPromptContent);

  return '\n\n## Custom Prompts\n' +
    loaded.map(p => `### ${p.name}\n${p.content}`).join('\n\n');
}

/**
 * 인덱스만 포함하는 컨텍스트 문자열 생성 (토큰 절감용).
 * Planning에서는 인덱스만 보여주고, 매칭 시 전체 내용 로드.
 */
export function getPromptIndex(
  prompts: PromptFile[],
  stage: 'planning' | 'coding' | 'verification',
): string {
  const matching = prompts.filter(p => p.stage === stage || p.stage === 'all');
  if (matching.length === 0) return '';

  return '\n\n## Available Prompt Library\n' +
    matching.map(p => `- ${p.name}: ${p.summary}`).join('\n') +
    '\n(Full content loaded on trigger match)';
}

/**
 * 필요할 때 전체 내용 로드 (lazy loading)
 */
export function loadPromptContent(prompt: PromptFile): PromptFile {
  if (prompt._contentLoaded) return prompt;

  try {
    const fullContent = readFileSync(prompt.source, 'utf-8').trim();
    const frontmatterMatch = fullContent.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    const content = frontmatterMatch ? frontmatterMatch[2].trim() : fullContent;

    return { ...prompt, content, _contentLoaded: true };
  } catch {
    return { ...prompt, content: '', _contentLoaded: true };
  }
}

function loadFromDir(dir: string): PromptFile[] {
  const files: PromptFile[] = [];

  try {
    const entries = readdirSync(dir).filter(f => extname(f) === '.md');

    for (const entry of entries) {
      const filePath = join(dir, entry);
      const name = basename(entry, '.md');

      try {
        const raw = readFileSync(filePath, 'utf-8').trim();
        if (!raw) continue;

        // 파일명으로 단계 결정
        let stage: PromptFile['stage'] = 'all';
        if (name.startsWith('planning-')) stage = 'planning';
        else if (name.startsWith('coding-')) stage = 'coding';
        else if (name.startsWith('verify-')) stage = 'verification';

        // frontmatter 파싱 (인덱스 정보만 추출)
        let summary = '';
        let triggerKeywords: string[] = [];
        const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

        if (frontmatterMatch) {
          const meta = frontmatterMatch[1];
          const body = frontmatterMatch[2].trim();

          // stage override from frontmatter
          const stageMatch = meta.match(/stage:\s*(\w+)/);
          if (stageMatch) stage = stageMatch[1] as PromptFile['stage'];

          // description for summary
          const descMatch = meta.match(/description:\s*(.+)/);
          summary = descMatch ? descMatch[1].trim() : (body.split('\n')[0] ?? '').slice(0, 120);

          // keywords
          const kwMatch = meta.match(/keywords:\s*\[([^\]]*)\]/);
          if (kwMatch) {
            triggerKeywords = kwMatch[1].split(',').map(s => s.trim()).filter(Boolean);
          }
        } else {
          summary = (raw.split('\n')[0] ?? '').slice(0, 120);
        }

        files.push({
          name,
          stage,
          content: '',  // lazy load
          source: filePath,
          summary,
          triggerKeywords,
          _contentLoaded: false,
        });
      } catch { /* skip unreadable file */ }
    }
  } catch { /* dir read error — skip */ }

  return files;
}
