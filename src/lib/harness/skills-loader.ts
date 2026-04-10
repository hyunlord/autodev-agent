import { existsSync, readdirSync, readFileSync } from 'fs';
import { join, extname } from 'path';
import yaml from 'js-yaml';

export interface SkillTrigger {
  projectType?: string;   // "react", "node", "python"
  taskCategory?: string;  // "frontend", "backend", "fullstack"
  filePattern?: string;   // "*.tsx", "*.py"
}

export interface Skill {
  id: string;
  name: string;
  version: string;
  triggers: SkillTrigger[];
  mcp?: { enable: string[] };
  promptModules?: {
    planning?: string;  // relative path to prompt file
    coding?: string;
    verify?: string;
  };
  verification?: {
    gates?: string[];     // commands to execute
    default?: string;
  };
  /** Whether prompt content has been loaded */
  _loaded: boolean;
  /** Loaded prompt content (only populated after activation) */
  _prompts?: { planning?: string; coding?: string; verify?: string };
}

/**
 * Stage 1: Load skill index — only id/name/triggers from all .yaml files.
 * Project skills override global skills with the same id.
 */
export function loadSkillIndex(projectDir: string): Skill[] {
  const projectSkills = loadSkillsFromDir(join(projectDir, '.autodev', 'skills'));

  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? '';
  const globalSkills = loadSkillsFromDir(join(homeDir, '.autodev', 'skills'));

  // Project skills take precedence over global skills with the same id
  const projectIds = new Set(projectSkills.map(s => s.id));
  const merged = [
    ...projectSkills,
    ...globalSkills.filter(s => !projectIds.has(s.id)),
  ];

  return merged;
}

/**
 * Stage 2: Activate skills whose triggers match the current context.
 * Loads prompt module content for activated skills.
 */
export function activateSkills(
  skills: Skill[],
  context: { projectType?: string; taskCategory?: string; files?: string[] },
  projectDir: string,
): Skill[] {
  return skills.map(skill => {
    if (skill.triggers.length === 0) return skill;

    const matches = skill.triggers.some(trigger => {
      if (trigger.projectType && trigger.projectType !== context.projectType) return false;
      if (trigger.taskCategory && trigger.taskCategory !== context.taskCategory) return false;
      if (trigger.filePattern && context.files) {
        const suffix = trigger.filePattern.replace('*', '');
        return context.files.some(f => f.endsWith(suffix));
      }
      // If no conditions specified on the trigger, it matches everything
      if (!trigger.projectType && !trigger.taskCategory && !trigger.filePattern) return false;
      return true;
    });

    if (!matches) return skill;

    // Load prompt content for activated skill
    const loaded: Skill = { ...skill, _loaded: true, _prompts: {} };
    const skillsDir = join(projectDir, '.autodev', 'skills');

    if (skill.promptModules?.planning) {
      const path = join(skillsDir, skill.promptModules.planning);
      if (existsSync(path)) loaded._prompts!.planning = readFileSync(path, 'utf-8').trim();
    }
    if (skill.promptModules?.coding) {
      const path = join(skillsDir, skill.promptModules.coding);
      if (existsSync(path)) loaded._prompts!.coding = readFileSync(path, 'utf-8').trim();
    }
    if (skill.promptModules?.verify) {
      const path = join(skillsDir, skill.promptModules.verify);
      if (existsSync(path)) loaded._prompts!.verify = readFileSync(path, 'utf-8').trim();
    }

    return loaded;
  });
}

/**
 * Stage 3: Get activated skill prompts for a specific pipeline stage.
 */
export function getSkillPromptsForStage(
  skills: Skill[],
  stage: 'planning' | 'coding' | 'verify',
): string {
  const active = skills.filter(s => s._loaded && s._prompts?.[stage]);
  if (active.length === 0) return '';

  return '\n\n## Active Skills\n' +
    active.map(s => `### Skill: ${s.name} (v${s.version})\n${s._prompts![stage]}`).join('\n\n');
}

/**
 * Get verification gates from activated skills.
 */
export function getSkillVerificationGates(skills: Skill[]): string[] {
  return skills
    .filter(s => s._loaded && s.verification?.gates)
    .flatMap(s => s.verification!.gates!);
}

/**
 * Get MCP servers to enable from activated skills.
 */
export function getSkillMcpServers(skills: Skill[]): string[] {
  return [...new Set(
    skills
      .filter(s => s._loaded && s.mcp?.enable)
      .flatMap(s => s.mcp!.enable),
  )];
}

// ─── Internal helpers ────────────────────────────────────

function loadSkillsFromDir(dir: string): Skill[] {
  const skills: Skill[] = [];

  if (!existsSync(dir)) return skills;

  try {
    const files = readdirSync(dir).filter(f =>
      extname(f) === '.yaml' || extname(f) === '.yml',
    );

    for (const file of files) {
      try {
        const content = readFileSync(join(dir, file), 'utf-8');
        const parsed = yaml.load(content) as Record<string, any> | null;
        if (!parsed || typeof parsed !== 'object') continue;

        skills.push({
          id: parsed.id ?? file.replace(/\.ya?ml$/, ''),
          name: parsed.name ?? file.replace(/\.ya?ml$/, ''),
          version: parsed.version ?? '0.0.0',
          triggers: normalizeTriggers(parsed.triggers),
          mcp: parsed.mcp ? { enable: Array.isArray(parsed.mcp.enable) ? parsed.mcp.enable : [] } : undefined,
          promptModules: parsed.promptModules ?? parsed.prompt_modules ?? undefined,
          verification: parsed.verification ?? undefined,
          _loaded: false,
        });
      } catch { /* skip invalid yaml */ }
    }
  } catch { /* dir read error */ }

  return skills;
}

function normalizeTriggers(raw: unknown): SkillTrigger[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(item => {
    if (typeof item !== 'object' || !item) return {};
    return {
      projectType: (item as any).projectType ?? (item as any).project_type,
      taskCategory: (item as any).taskCategory ?? (item as any).task_category,
      filePattern: (item as any).filePattern ?? (item as any).file_pattern,
    };
  }).filter(t => t.projectType || t.taskCategory || t.filePattern);
}
