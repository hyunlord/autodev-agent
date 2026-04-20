import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseYaml, YamlParseError } from '../yaml-parser';

function readSample(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf-8');
}

describe('parseYaml', () => {
  it('유효한 YAML + 유효한 스키마 → ParsedPipeline 반환', async () => {
    const yamlStr = readSample('examples/adpl/01-hello-world.yaml');
    const result = await parseYaml({ yaml: yamlStr, sourcePath: '01-hello-world.yaml' });

    expect(result.raw.name).toBe('hello-world');
    expect(result.raw.adplVersion).toBe(1);
    expect(result.raw.pipeline).toHaveLength(1);
    expect(result.sourceYaml).toBe(yamlStr);
    expect(result.parsedAt).toBeInstanceOf(Date);
  });

  it('parsedAt 은 Date 인스턴스', async () => {
    const yamlStr = readSample('examples/adpl/01-hello-world.yaml');
    const before = new Date();
    const result = await parseYaml({ yaml: yamlStr });
    const after = new Date();

    expect(result.parsedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(result.parsedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('빈 문자열 → empty_content 에러', async () => {
    await expect(parseYaml({ yaml: '' })).rejects.toThrow(YamlParseError);

    try {
      await parseYaml({ yaml: '' });
    } catch (err) {
      expect(err).toBeInstanceOf(YamlParseError);
      expect((err as YamlParseError).code).toBe('empty_content');
    }
  });

  it('공백만 있는 문자열 → empty_content 에러', async () => {
    try {
      await parseYaml({ yaml: '   \n\t  ' });
    } catch (err) {
      expect(err).toBeInstanceOf(YamlParseError);
      expect((err as YamlParseError).code).toBe('empty_content');
    }
  });

  it('잘못된 YAML 구문 → yaml_syntax 에러', async () => {
    const badYaml = 'key: [unclosed bracket';
    try {
      await parseYaml({ yaml: badYaml });
    } catch (err) {
      expect(err).toBeInstanceOf(YamlParseError);
      expect((err as YamlParseError).code).toBe('yaml_syntax');
    }
  });

  it('유효한 YAML이지만 스키마 불일치 → schema_error 에러', async () => {
    // pipeline 필드 없음 → 스키마 검증 실패
    const missingPipeline = `adplVersion: 1\nname: test-pipe\n`;
    try {
      await parseYaml({ yaml: missingPipeline });
    } catch (err) {
      expect(err).toBeInstanceOf(YamlParseError);
      expect((err as YamlParseError).code).toBe('schema_error');
      expect((err as YamlParseError).zodIssues).toBeDefined();
    }
  });

  it('sourcePath 가 에러에 보존됨', async () => {
    const path = 'some/path/to/file.yaml';
    try {
      await parseYaml({ yaml: '', sourcePath: path });
    } catch (err) {
      expect((err as YamlParseError).sourcePath).toBe(path);
    }
  });

  it('sourcePath 없으면 에러에서 undefined', async () => {
    try {
      await parseYaml({ yaml: '' });
    } catch (err) {
      expect((err as YamlParseError).sourcePath).toBeUndefined();
    }
  });

  it('schema_error 에 zodIssues 포함', async () => {
    const noVersion = `name: test-pipe\npipeline:\n  - id: n1\n    type: shell\n    command: echo hi\n`;
    try {
      await parseYaml({ yaml: noVersion });
    } catch (err) {
      expect(err).toBeInstanceOf(YamlParseError);
      expect((err as YamlParseError).code).toBe('schema_error');
      const issues = (err as YamlParseError).zodIssues as unknown[];
      expect(Array.isArray(issues)).toBe(true);
      expect(issues.length).toBeGreaterThan(0);
    }
  });
});
