import { describe, it, expect, beforeEach } from 'vitest';
import { gateHandler } from '../handlers/gate-handler';
import type { FlowNodeOptions, RunSubNodeFn } from '../flow-handler';
import type { GateNodeSpec } from '@/lib/adpl/types/nodes/gate';
import { EventBus } from '../../events/bus';
import { CancellationToken } from '../../cancel/token';

function makeOptions(bus: EventBus, token: CancellationToken): FlowNodeOptions {
  return { runId: 'run-gate-1', eventBus: bus, token };
}

// gate 는 sub-node 를 실행하지 않으므로 dummy runner 사용
const noopRunner: RunSubNodeFn = async (_pathId) => ({ status: 'success', data: null });

// ─────────────────────────────────────────────────────────────────────────────
describe('gateHandler', () => {
  let bus: EventBus;
  let token: CancellationToken;

  beforeEach(() => {
    bus = new EventBus();
    token = new CancellationToken();
  });

  // ─────────────────────────────────────────────
  // 1. condition true → passes (completed)
  // ─────────────────────────────────────────────
  it('1. condition true (truthy:false on undefined) → success with passed:true', async () => {
    // $nodes 가 빈 객체이므로 undefined → falsy → truthy:false → true (통과)
    const spec: GateNodeSpec = {
      id: 'quality-gate',
      type: 'gate',
      condition: { field: '$nodes.build.data.score', truthy: false },
      onFail: 'throw',
    };

    const output = await gateHandler.handle(spec, 'pipeline.0', noopRunner, makeOptions(bus, token));

    expect(output.status).toBe('success');
    const data = output.data as Record<string, unknown>;
    expect(data.passed).toBe(true);
    expect(data.gateId).toBe('quality-gate');
  });

  // ─────────────────────────────────────────────
  // 2. condition false + onFail=throw → throws
  // ─────────────────────────────────────────────
  it('2. condition false + onFail=throw → throws error', async () => {
    // truthy:true on undefined → false → gate fails
    const spec: GateNodeSpec = {
      id: 'must-pass-gate',
      type: 'gate',
      condition: { field: '$nodes.build.data.score', truthy: true },
      onFail: 'throw',
    };

    await expect(
      gateHandler.handle(spec, 'pipeline.0', noopRunner, makeOptions(bus, token)),
    ).rejects.toThrow();
  });

  // ─────────────────────────────────────────────
  // 3. condition false + onFail=fail_node → returns failure status
  // ─────────────────────────────────────────────
  it('3. condition false + onFail=fail_node → returns failure status', async () => {
    const spec: GateNodeSpec = {
      id: 'soft-gate',
      type: 'gate',
      condition: { field: '$nodes.build.data.score', truthy: true },
      onFail: 'fail_node',
    };

    const output = await gateHandler.handle(spec, 'pipeline.0', noopRunner, makeOptions(bus, token));

    expect(output.status).toBe('failure');
    expect(output.error?.code).toBe('GATE_CONDITION_FAILED');
  });

  // ─────────────────────────────────────────────
  // 4. custom message appears in error on failure
  // ─────────────────────────────────────────────
  it('4. custom message appears in failure output (fail_node)', async () => {
    const spec: GateNodeSpec = {
      id: 'msg-gate',
      type: 'gate',
      condition: { field: '$nodes.x.data.ok', truthy: true },
      onFail: 'fail_node',
      message: 'Quality threshold not met — aborting deploy',
    };

    const output = await gateHandler.handle(spec, 'pipeline.0', noopRunner, makeOptions(bus, token));

    expect(output.status).toBe('failure');
    expect(output.error?.message).toBe('Quality threshold not met — aborting deploy');
  });

  // ─────────────────────────────────────────────
  // 5. custom message appears in thrown error
  // ─────────────────────────────────────────────
  it('5. custom message appears in thrown error (onFail=throw)', async () => {
    const spec: GateNodeSpec = {
      id: 'throw-msg-gate',
      type: 'gate',
      condition: { field: '$nodes.x.data.ok', truthy: true },
      onFail: 'throw',
      message: 'Deploy blocked: tests not green',
    };

    await expect(
      gateHandler.handle(spec, 'pipeline.0', noopRunner, makeOptions(bus, token)),
    ).rejects.toThrow('Deploy blocked: tests not green');
  });

  // ─────────────────────────────────────────────
  // 6. cancellation → returns cancelled immediately
  // ─────────────────────────────────────────────
  it('6. token cancelled before execution → returns cancelled status', async () => {
    token.cancel('test cancel');

    const spec: GateNodeSpec = {
      id: 'cancel-gate',
      type: 'gate',
      condition: { field: '$nodes.x.data.ok', truthy: false },
    };

    const output = await gateHandler.handle(spec, 'pipeline.0', noopRunner, makeOptions(bus, token));

    expect(output.status).toBe('cancelled');
  });

  // ─────────────────────────────────────────────
  // 7. complex condition: all combinator → all true → passes
  // ─────────────────────────────────────────────
  it('7. all combinator with two truthy:false conditions (both undefined) → passes', async () => {
    const spec: GateNodeSpec = {
      id: 'multi-gate',
      type: 'gate',
      condition: {
        all: [
          { field: '$nodes.a.data.ok', truthy: false },
          { field: '$nodes.b.data.ok', truthy: false },
        ],
      },
      onFail: 'throw',
    };

    const output = await gateHandler.handle(spec, 'pipeline.0', noopRunner, makeOptions(bus, token));

    expect(output.status).toBe('success');
    const data = output.data as Record<string, unknown>;
    expect(data.passed).toBe(true);
  });

  // ─────────────────────────────────────────────
  // 8. any combinator → one fails, one passes → passes
  // ─────────────────────────────────────────────
  it('8. any combinator: first truthy:true (false), second truthy:false (true) → passes', async () => {
    const spec: GateNodeSpec = {
      id: 'any-gate',
      type: 'gate',
      condition: {
        any: [
          { field: '$nodes.a.data.ok', truthy: true },  // undefined → false
          { field: '$nodes.b.data.ok', truthy: false }, // undefined → true
        ],
      },
      onFail: 'fail_node',
    };

    const output = await gateHandler.handle(spec, 'pipeline.0', noopRunner, makeOptions(bus, token));

    expect(output.status).toBe('success');
  });

  // ─────────────────────────────────────────────
  // 9. flow.gate.opened + flow.gate.decided events emitted on pass
  // ─────────────────────────────────────────────
  it('9. flow.gate.opened and flow.gate.decided events emitted on pass', async () => {
    const openedEvents: Array<{ gateId: string; waitId: string }> = [];
    const decidedEvents: Array<{ gateId: string; decision: string; decidedBy: string }> = [];

    bus.on('flow.gate.opened', (e) => {
      openedEvents.push({
        gateId: (e as { gateId: string }).gateId,
        waitId: (e as { waitId: string }).waitId,
      });
    });
    bus.on('flow.gate.decided', (e) => {
      decidedEvents.push({
        gateId: (e as { gateId: string }).gateId,
        decision: (e as { decision: string }).decision,
        decidedBy: (e as { decidedBy: string }).decidedBy,
      });
    });

    const spec: GateNodeSpec = {
      id: 'event-gate',
      type: 'gate',
      condition: { field: '$nodes.x.data.ok', truthy: false },
    };

    await gateHandler.handle(spec, 'pipeline.2', noopRunner, makeOptions(bus, token));

    expect(openedEvents).toHaveLength(1);
    expect(openedEvents[0].gateId).toBe('pipeline.2');
    expect(openedEvents[0].waitId).toBe('event-gate');

    expect(decidedEvents).toHaveLength(1);
    expect(decidedEvents[0].decision).toBe('pass');
    expect(decidedEvents[0].decidedBy).toBe('condition');
  });

  // ─────────────────────────────────────────────
  // 10. flow.gate.decided with decision=fail emitted on fail_node
  // ─────────────────────────────────────────────
  it('10. flow.gate.decided with decision=fail emitted when condition false', async () => {
    const decidedEvents: Array<{ decision: string }> = [];
    bus.on('flow.gate.decided', (e) => {
      decidedEvents.push({ decision: (e as { decision: string }).decision });
    });

    const spec: GateNodeSpec = {
      id: 'fail-event-gate',
      type: 'gate',
      condition: { field: '$nodes.x.data.ok', truthy: true },
      onFail: 'fail_node',
    };

    await gateHandler.handle(spec, 'pipeline.0', noopRunner, makeOptions(bus, token));

    expect(decidedEvents).toHaveLength(1);
    expect(decidedEvents[0].decision).toBe('fail');
  });
});
