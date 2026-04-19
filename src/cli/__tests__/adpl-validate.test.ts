import { describe, it, expect } from 'vitest';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { validateFile } from '../commands/adpl-validate';

function writeTmp(name: string, content: string): string {
  const path = join(tmpdir(), name);
  writeFileSync(path, content, 'utf-8');
  return path;
}

function cleanTmp(path: string): void {
  try {
    unlinkSync(path);
  } catch {}
}

const MINIMAL_YAML = `
adplVersion: 1
name: hello-world
triggers:
  - type: task_created
pipeline:
  - id: p1
    type: agent
    role: planner
`;

describe('adpl validate — valid', () => {
  it('valid YAML → valid: true, 메트릭 정확', async () => {
    const path = writeTmp('adpl-valid-test.yaml', MINIMAL_YAML);
    try {
      const result = await validateFile(path);
      expect(result.valid).toBe(true);
      expect(result.metrics?.pipelineName).toBe('hello-world');
      expect(result.metrics?.nodeCount).toBe(1);
      expect(result.metrics?.nodeTypes).toEqual({ agent: 1 });
      expect(result.metrics?.triggerCount).toBe(1);
      expect(result.metrics?.triggerTypes).toEqual(['task_created']);
      expect(result.fileError).toBeUndefined();
    } finally {
      cleanTmp(path);
    }
  });

  it('settings 포함 파이프라인 → hasSettings true', async () => {
    const yaml = `
adplVersion: 1
name: with-settings
settings:
  maxParallel: 4
  onNodeFailure: continue
pipeline:
  - id: s1
    type: shell
    command: echo hello
`;
    const path = writeTmp('adpl-settings-test.yaml', yaml);
    try {
      const result = await validateFile(path);
      expect(result.valid).toBe(true);
      expect(result.metrics?.hasSettings).toBe(true);
      expect(result.metrics?.nodeTypes).toEqual({ shell: 1 });
    } finally {
      cleanTmp(path);
    }
  });
});

describe('adpl validate — invalid', () => {
  it('enum typo (plannr) → invalid + planner 제안', async () => {
    const yaml = `
adplVersion: 1
name: typo-test
pipeline:
  - id: p1
    type: agent
    role: plannr
`;
    const path = writeTmp('adpl-typo-test.yaml', yaml);
    try {
      const result = await validateFile(path);
      expect(result.valid).toBe(false);
      const suggestions = (result.errors ?? []).map((e) => e.suggestion).filter(Boolean);
      expect(suggestions.some((s) => s?.includes('planner'))).toBe(true);
    } finally {
      cleanTmp(path);
    }
  });

  it('노드 id 중복 + role=custom 미prompt → 2개 이상 에러', async () => {
    const yaml = `
adplVersion: 1
name: multi-error
pipeline:
  - id: dup
    type: agent
    role: planner
  - id: dup
    type: shell
    command: ls
  - id: custom-no-prompt
    type: agent
    role: custom
`;
    const path = writeTmp('adpl-multi-error-test.yaml', yaml);
    try {
      const result = await validateFile(path);
      expect(result.valid).toBe(false);
      expect((result.errors ?? []).length).toBeGreaterThanOrEqual(2);
      const messages = (result.errors ?? []).map((e) => e.message).join(' ');
      expect(messages).toMatch(/중복|custom/);
    } finally {
      cleanTmp(path);
    }
  });

  it('http node url 누락 → url 에러', async () => {
    const yaml = `
adplVersion: 1
name: missing-url
pipeline:
  - id: fetch
    type: http
`;
    const path = writeTmp('adpl-missing-url.yaml', yaml);
    try {
      const result = await validateFile(path);
      expect(result.valid).toBe(false);
      expect((result.errors ?? []).some((e) => e.path.includes('url'))).toBe(true);
    } finally {
      cleanTmp(path);
    }
  });

  it('adplVersion 문자열 → invalid', async () => {
    const yaml = `
adplVersion: "1.0"
name: wrong-version
pipeline:
  - id: p1
    type: agent
    role: planner
`;
    const path = writeTmp('adpl-wrong-version.yaml', yaml);
    try {
      const result = await validateFile(path);
      expect(result.valid).toBe(false);
    } finally {
      cleanTmp(path);
    }
  });
});

describe('adpl validate — 파일 오류', () => {
  it('존재하지 않는 파일 → fileError', async () => {
    const result = await validateFile('/tmp/__adpl_nonexistent_xyz_12345.yaml');
    expect(result.valid).toBe(false);
    expect(result.fileError).toMatch(/파일을 찾을 수 없습니다/);
  });

  it('잘못된 YAML 문법 → fileError (YAML 파싱 실패)', async () => {
    const path = writeTmp('adpl-syntax-error.yaml', '{ unclosed: [');
    try {
      const result = await validateFile(path);
      expect(result.valid).toBe(false);
      expect(result.fileError).toMatch(/YAML 파싱 실패/);
    } finally {
      cleanTmp(path);
    }
  });
});
