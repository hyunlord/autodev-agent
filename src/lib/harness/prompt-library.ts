import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, extname, basename } from 'path';

export interface PromptFile {
  name: string;          // 파일명 (확장자 제외)
  stage: 'planning' | 'coding' | 'verification' | 'all';  // 적용 단계
  content: string;       // 프롬프트 내용
  source: string;        // 파일 경로
}

/**
 * .autodev/prompts/ 폴더에서 프롬프트 파일 로드.
 *
 * 파일명 규칙:
 *   planning-*.md  → Planning Agent에 주입
 *   coding-*.md    → Coding Agent에 주입
 *   verify-*.md    → Verify Agent에 주입
 *   *.md (접두사 없음) → 모든 단계에 주입
 *
 * 예시:
 *   .autodev/prompts/planning-react-patterns.md
 *   .autodev/prompts/coding-no-any.md
 *   .autodev/prompts/verify-accessibility.md
 *   .autodev/prompts/always-korean.md  (모든 단계)
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
 * 특정 단계의 프롬프트만 가져오기
 */
export function getPromptsForStage(
  prompts: PromptFile[],
  stage: 'planning' | 'coding' | 'verification',
): string {
  const matching = prompts.filter(p => p.stage === stage || p.stage === 'all');
  if (matching.length === 0) return '';

  return '\n\n## Custom Prompts\n' +
    matching.map(p => `### ${p.name}\n${p.content}`).join('\n\n');
}

function loadFromDir(dir: string): PromptFile[] {
  const files: PromptFile[] = [];

  try {
    const entries = readdirSync(dir).filter(f => extname(f) === '.md');

    for (const entry of entries) {
      const filePath = join(dir, entry);
      const name = basename(entry, '.md');
      const content = readFileSync(filePath, 'utf-8').trim();

      if (!content) continue;

      // 파일명으로 단계 결정
      let stage: PromptFile['stage'] = 'all';
      if (name.startsWith('planning-')) stage = 'planning';
      else if (name.startsWith('coding-')) stage = 'coding';
      else if (name.startsWith('verify-')) stage = 'verification';

      // frontmatter 파싱 (있으면)
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (frontmatterMatch) {
        const meta = frontmatterMatch[1];
        const body = frontmatterMatch[2].trim();
        const stageMatch = meta.match(/stage:\s*(\w+)/);
        if (stageMatch) stage = stageMatch[1] as PromptFile['stage'];
        files.push({ name, stage, content: body, source: filePath });
      } else {
        files.push({ name, stage, content, source: filePath });
      }
    }
  } catch { /* dir read error — skip */ }

  return files;
}
