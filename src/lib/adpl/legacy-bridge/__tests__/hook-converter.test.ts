import { describe, it, expect } from 'vitest';
import { convertLegacyHooks } from '../hook-converter';

describe('convertLegacyHooks', () => {
  it('1. 단일 command hook을 ShellNodeSpec으로 변환', () => {
    const result = convertLegacyHooks([
      { event: 'PreVerify', type: 'command', command: 'pnpm lint' },
    ]);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({
      id: 'pre-verify',
      type: 'shell',
      mode: 'shell',
      command: 'pnpm lint',
    });
    expect(result.skipped).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('2. 단일 script hook을 ShellNodeSpec으로 변환 (인라인 스크립트)', () => {
    const result = convertLegacyHooks([
      { event: 'PostCode', type: 'script', script: 'echo done && date' },
    ]);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({
      id: 'post-code',
      type: 'shell',
      mode: 'shell',
      command: 'echo done && date',
    });
    expect(result.warnings).toHaveLength(0);
  });

  it('2b. script hook path 기반 변환', () => {
    const result = convertLegacyHooks([
      { event: 'PreCode', type: 'script', path: '/scripts/pre-code.sh' },
    ]);
    expect(result.nodes[0].command).toBe('/scripts/pre-code.sh');
  });

  it('3. 동일 phase에 command hook 2개 → id 접미사 -0, -1', () => {
    const result = convertLegacyHooks([
      { event: 'PostCode', type: 'command', command: 'echo first' },
      { event: 'PostCode', type: 'command', command: 'echo second' },
    ]);
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0].id).toBe('post-code-0');
    expect(result.nodes[1].id).toBe('post-code-1');
    expect(result.nodes[0].command).toBe('echo first');
    expect(result.nodes[1].command).toBe('echo second');
  });

  it('4. agent type hook → skipped 기록, nodes에 미포함', () => {
    const result = convertLegacyHooks([
      { event: 'PreVerify', type: 'agent', prompt: 'check quality' },
    ]);
    expect(result.nodes).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({
      event: 'PreVerify',
      type: 'agent',
    });
    expect(result.skipped[0].reason).toBeTruthy();
    expect(result.warnings).toHaveLength(0);
  });

  it('5. http type hook → skipped 기록, nodes에 미포함', () => {
    const result = convertLegacyHooks([
      { event: 'TaskComplete', type: 'http', url: 'https://example.com/webhook' },
    ]);
    expect(result.nodes).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({
      event: 'TaskComplete',
      type: 'http',
    });
  });

  it('6. cwd/env 옵션이 ShellNodeSpec 필드로 전달', () => {
    const result = convertLegacyHooks([
      {
        event: 'PreCode',
        type: 'command',
        command: 'npm test',
        cwd: '/workspace/project',
        env: { NODE_ENV: 'test', CI: 'true' },
      },
    ]);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({
      cwd: '/workspace/project',
      env: { NODE_ENV: 'test', CI: 'true' },
    });
  });

  it('7. 미지의 옵션 → warning 추가, 노드는 변환 계속', () => {
    const result = convertLegacyHooks([
      { event: 'PostCode', type: 'command', command: 'echo hi', unknownField: 'value', anotherUnknown: 42 },
    ]);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].command).toBe('echo hi');
    // unknown 필드 2개 각각 warning
    const unknownWarnings = result.warnings.filter(w => w.includes('unknown option'));
    expect(unknownWarnings).toHaveLength(2);
    expect(result.warnings.some(w => w.includes('unknownField'))).toBe(true);
    expect(result.warnings.some(w => w.includes('anotherUnknown'))).toBe(true);
    // 노드에 unknown 필드 미포함
    expect(result.nodes[0]).not.toHaveProperty('unknownField');
    expect(result.nodes[0]).not.toHaveProperty('anotherUnknown');
  });

  it('8. 빈 배열 입력 → 빈 ConvertResult', () => {
    const result = convertLegacyHooks([]);
    expect(result).toEqual({ nodes: [], skipped: [], warnings: [] });
  });

  it('9. "after" 배치 이벤트 → dependsOn 설정', () => {
    const result = convertLegacyHooks([
      { event: 'PostCode', type: 'command', command: 'pnpm format' },
    ]);
    expect(result.nodes[0].dependsOn).toEqual(['code']);
  });

  it('10. "before" 배치 이벤트 → dependsOn 미설정', () => {
    const result = convertLegacyHooks([
      { event: 'PreVerify', type: 'command', command: 'pnpm lint' },
    ]);
    expect(result.nodes[0].dependsOn).toBeUndefined();
  });

  it('11. timeout 옵션이 ShellNodeSpec으로 전달', () => {
    const result = convertLegacyHooks([
      { event: 'PostCode', type: 'command', command: 'npm run build', timeout: 120 },
    ]);
    expect(result.nodes[0].timeout).toBe(120);
  });

  it('12. agent/http 혼합 + command → skipped에 2건, nodes에 1건', () => {
    const result = convertLegacyHooks([
      { event: 'PreVerify', type: 'command', command: 'pnpm lint' },
      { event: 'PostVerify', type: 'agent', prompt: 'review' },
      { event: 'TaskComplete', type: 'http', url: 'https://notify.example.com' },
    ]);
    expect(result.nodes).toHaveLength(1);
    expect(result.skipped).toHaveLength(2);
    expect(result.nodes[0].id).toBe('pre-verify');
  });

  it('13. script type: inline script과 path 모두 있으면 script(inline) 우선', () => {
    const result = convertLegacyHooks([
      { event: 'PostPlan', type: 'script', script: 'echo inline', path: '/scripts/other.sh' },
    ]);
    expect(result.nodes[0].command).toBe('echo inline');
  });
});
