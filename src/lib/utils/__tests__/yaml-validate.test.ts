import { describe, it, expect } from 'vitest';
import { validateYaml } from '../yaml-validate';

const VALID_YAML = `adplVersion: 1
name: hello-world
pipeline:
  - id: greet
    type: shell
    command: "echo hello"`;

describe('validateYaml', () => {
  it('valid yaml + valid ADPL → ok=true, parsed present', () => {
    const result = validateYaml(VALID_YAML);
    expect(result.ok).toBe(true);
    expect(result.parsed).toBeDefined();
    expect(result.error).toBeUndefined();
  });

  it('invalid yaml syntax → ok=false, error contains YAML 파싱 실패', () => {
    const result = validateYaml('key: [unclosed');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('YAML 파싱 실패');
  });

  it('valid yaml + invalid ADPL schema → ok=false, error contains 스키마 일치 실패', () => {
    // empty pipeline array fails min(1) check
    const result = validateYaml('adplVersion: 1\nname: hello-world\npipeline: []\n');
    expect(result.ok).toBe(false);
    expect(result.error).toContain('스키마 일치 실패');
  });

  it('empty string → ok=false', () => {
    const result = validateYaml('');
    expect(result.ok).toBe(false);
  });
});
