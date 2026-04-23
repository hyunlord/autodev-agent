import { describe, it, expect } from 'vitest';
import { AdplPipelineSchema } from '../pipeline';

const MINIMAL_VALID = {
  adplVersion: 1,
  name: 'hello-world',
  triggers: [{ type: 'task_created' }],
  pipeline: [{ id: 'p1', type: 'agent', role: 'planner' }],
} as const;

describe('ADPL Zod 스키마 — valid', () => {
  it('최소 파이프라인 (agent + task_created)', () => {
    expect(() => AdplPipelineSchema.parse(MINIMAL_VALID)).not.toThrow();
  });

  it('shell + http + webhook_out 조합', () => {
    const valid = {
      adplVersion: 1,
      name: 'multi-node',
      pipeline: [
        { id: 'fetch', type: 'http', url: 'https://api.example.com/data', method: 'GET' },
        { id: 'process', type: 'shell', command: 'echo done' },
        {
          id: 'notify',
          type: 'webhook_out',
          url: 'https://hooks.slack.com/x',
          body: { text: 'done' },
        },
      ],
    };
    expect(() => AdplPipelineSchema.parse(valid)).not.toThrow();
  });

  it('branch + loop 중첩 재귀 구조', () => {
    const valid = {
      adplVersion: 1,
      name: 'nested',
      pipeline: [
        {
          id: 'route',
          type: 'branch',
          cases: [
            {
              when: { field: '$nodes.score.output.data.value', gte: 80 },
              then: [{ id: 'pass', type: 'shell', command: 'echo pass' }],
            },
            { default: true, then: [{ id: 'fail', type: 'shell', command: 'echo fail' }] },
          ],
        },
      ],
    };
    expect(() => AdplPipelineSchema.parse(valid)).not.toThrow();
  });

  it('gate 노드 포함 파이프라인', () => {
    const valid = {
      adplVersion: 1,
      name: 'deploy-gate',
      triggers: [{ type: 'manual' }],
      pipeline: [
        { id: 'build', type: 'shell', command: 'pnpm build' },
        {
          id: 'approval',
          type: 'gate',
          condition: { field: '$nodes.build.data.exitCode', truthy: false },
          onFail: 'fail_node',
          message: '빌드 실패 — 배포 차단',
        },
      ],
    };
    expect(() => AdplPipelineSchema.parse(valid)).not.toThrow();
  });

  it('loop forEach + parallel + settings', () => {
    const valid = {
      adplVersion: 1,
      name: 'loop-parallel',
      settings: { maxParallel: 4, totalTimeout: 3600, onNodeFailure: 'continue' },
      pipeline: [
        {
          id: 'iter',
          type: 'loop',
          mode: 'forEach',
          over: '$nodes.fetch.output.data.items',
          as: 'item',
          do: [{ id: 'proc', type: 'mcp', server: 'linear', tool: 'create_issue' }],
        },
      ],
    };
    expect(() => AdplPipelineSchema.parse(valid)).not.toThrow();
  });
});

describe('ADPL Zod 스키마 — invalid', () => {
  it('노드 id 중복 → 에러', () => {
    const invalid = {
      ...MINIMAL_VALID,
      pipeline: [
        { id: 'dup', type: 'agent', role: 'planner' },
        { id: 'dup', type: 'shell', command: 'ls' },
      ],
    };
    const result = AdplPipelineSchema.safeParse(invalid);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(' ');
      expect(messages).toMatch(/중복/);
    }
  });

  it('role=custom인데 prompt 없음 → 에러', () => {
    const invalid = {
      ...MINIMAL_VALID,
      pipeline: [{ id: 'p1', type: 'agent', role: 'custom' }],
    };
    const result = AdplPipelineSchema.safeParse(invalid);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(' ');
      expect(messages).toMatch(/custom/);
    }
  });

  it('pipeline 빈 배열 → 에러', () => {
    const invalid = { ...MINIMAL_VALID, pipeline: [] };
    const result = AdplPipelineSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('알 수 없는 node type → 에러', () => {
    const invalid = {
      ...MINIMAL_VALID,
      pipeline: [{ id: 'p1', type: 'unknown_type_xyz' }],
    };
    const result = AdplPipelineSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('adplVersion이 문자열 → 에러', () => {
    const invalid = { ...MINIMAL_VALID, adplVersion: '1.0' };
    const result = AdplPipelineSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('name 패턴 위반 (대문자) → 에러', () => {
    const invalid = { ...MINIMAL_VALID, name: 'Hello-World' };
    const result = AdplPipelineSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('트리거 id 중복 → 에러', () => {
    const invalid = {
      ...MINIMAL_VALID,
      triggers: [
        { id: 'tid', type: 'task_created' },
        { id: 'tid', type: 'manual' },
      ],
    };
    const result = AdplPipelineSchema.safeParse(invalid);
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(' ');
      expect(messages).toMatch(/중복/);
    }
  });

  it('schedule trigger — 필수 필드 누락 (type만)', () => {
    const valid = {
      ...MINIMAL_VALID,
      triggers: [{ type: 'schedule', mode: 'cron', cron: '0 * * * *' }],
    };
    // mode는 필수이므로 포함 — 통과해야 함
    expect(() => AdplPipelineSchema.parse(valid)).not.toThrow();
  });

  it('http node — url 누락 → 에러', () => {
    const invalid = {
      ...MINIMAL_VALID,
      pipeline: [{ id: 'h1', type: 'http' }],
    };
    const result = AdplPipelineSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});
