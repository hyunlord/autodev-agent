# C9-1 사전 조사 — Facade 구현 대상 파악

> 작성: 2026-04-22  
> 목적: C9-1 (Facade) 구현 전 pipeline.ts 구조 + pipelineMode 분기 지점 + legacy/Phase P 경로 합류 전략 파악  
> 수정 금지: 이 문서는 조사 전용. 코드/테스트 변경 없음.

---

## 주요 발견사항 요약 (읽기 전에)

| 항목 | 예상 | 실제 |
|------|------|------|
| 파일 위치 | `src/lib/pipeline.ts` | **`src/worker/pipeline.ts`** |
| 라우팅 필드 | `executionMode` 또는 `projects.execution_mode` | **`tasks.pipelineMode`** (text, enum 없음) |
| `executionMode` | 파이프라인 라우팅용 | **레거시 사이클 모드** (`single/auto-cycle/interview/arena`), 무관 |
| projects 테이블 execution_mode | 설계 §7.2에 명시 | **스키마에 없음** — 미구현 |
| 호출자 수 | 다수 예상 | **단 1곳** (`src/worker/index.ts:101`) |
| 파일 줄 수 | 설계 문서에 ~1400줄 | **1,275줄** |

---

## 1장. pipeline.ts 구조 지도

### 1.1 파일 위치

설계 6 문서(28_PhaseP_design6…)는 `src/lib/pipeline.ts`라고 명시했으나, **실제 파일은 `src/worker/pipeline.ts`** 이다.

```
src/worker/
├── pipeline.ts          ← 1,275줄, 핵심 대상
├── pipeline-types.ts    ← EmitFn, SingleCycleResult 등 타입
├── pipeline-planning.ts ← executePlanning() 위임
├── pipeline-verify.ts   ← 검증 단계
├── pipeline-arena.ts    ← Arena 모드
├── index.ts             ← Worker 프로세스 진입점, runPipeline 호출자
└── retry.ts, escalation.ts, ...
```

### 1.2 export 함수 목록

```typescript
// src/worker/pipeline.ts — export 목록
export async function runPipeline(
  taskId: string,
  rawEmit: EmitFn,
  signal?: AbortSignal,
): Promise<void>
```

**공개 export는 `runPipeline` 하나뿐**. 나머지(`runSingleCycle`, `runAutoCycle`, `resolveProjectDir`, `updateTaskStatus`, `escalate` 등)는 모두 internal.

### 1.3 진입점 호출자 (grep 결과)

```typescript
// src/worker/index.ts:101
runPipeline(taskId, emit, abortController.signal)
```

```typescript
// src/worker/index.ts:80-101 (호출 컨텍스트)
function startPipeline(taskId: string): void {
  const abortController = new AbortController();
  activeTasks.set(taskId, abortController);
  // ...
  runPipeline(taskId, emit, abortController.signal)
    .catch((err) => { /* 에러 처리 */ })
    .finally(() => {
      activeTasks.delete(taskId);
      processQueue();
    });
}
```

이 `startPipeline`은 Worker 프로세스의 IPC 메시지 핸들러에서 호출된다. **API route나 CLI에서 직접 호출하는 경로는 없다.** 전부 Worker IPC 경유.

### 1.4 함수 규모 (행 수 상위 5개 추정)

| 함수 | 위치(추정) | 규모 |
|------|-----------|------|
| `runPipeline` | L22-441 | ~420줄 (전체 흐름 + 모드 분기) |
| `runSingleCycle` | L446-800+ | ~370줄 (Plan→Review→Code→Verify) |
| `runAutoCycle` | 이후 | ~200줄 |
| `resolveProjectDir` | 후미 | ~30줄 |
| `updateTaskStatus` / `escalate` | 후미 | ~20줄씩 |

### 1.5 사이드 이펙트 식별

| 유형 | 상세 |
|------|------|
| **DB 읽기** | `db.select().from(tasks).where(eq(tasks.id, taskId)).get()` — 작업 조회 |
| **DB 쓰기** | `db.update(tasks).set({...}).where(...).run()` — 상태/결과 저장, events insert |
| **파일시스템** | `mkdirSync(join(projectDir, '.autodev'), ...)`, `writeFileSync(nameFile, ...)` |
| **Worker IPC** | `process.send?.({ taskId, event })` — emit 래퍼 |
| **Hook emit** | `HookEngine.execute({ event: 'SessionStart'/'TaskStart'/'TaskComplete'/'TaskFail'/'SessionEnd' })` |
| **MCP 연결** | `mcpManager.connectAll(emit)`, `mcpManager.shutdown()` — finally 블록 |
| **Git** | `git add -A` + `git commit` (single 모드 성공 시), `git rev-parse HEAD` |
| **외부 프로세스** | `runPlanningAgent`, `runCodingAgent`, `VerifyAgent` 호출 (pipeline-planning/pipeline-verify 위임) |

### 1.6 프로젝트별 설정 읽는 지점

```typescript
// L55: AutoDevConfig (hooks, maxAttempts 등 전역 설정)
const config = await loadConfig(projectDir);

// L55-98: MCP 설정 + pipeline_mapping
const mcpManager = new McpManager(projectDir);
const mcpConfig = mcpManager.getConfig();

// L147: task 레벨 config (per-task 재정의)
const taskConfig = task.config
  ? (typeof task.config === 'string' ? JSON.parse(task.config) : task.config)
  : {};
```

---

## 2장. executionMode 필드 현황

### 2.1 실제 컬럼명과 위치

**`tasks` 테이블에 두 개의 별도 필드가 있고, 역할이 완전히 다르다.**

```typescript
// src/lib/db/schema.ts:19-27
executionMode: text('execution_mode', {
  enum: ['single', 'auto-cycle', 'interview', 'arena'],
}).notNull().default('single'),
// ↑ 레거시 사이클 모드. pipeline 라우팅과 무관.

pipelineMode: text('pipeline_mode').notNull().default('legacy'),
// ↑ Pipeline 라우팅 필드. enum 없음 → 어떤 문자열 값도 가능.
```

### 2.2 값 종류

| 필드 | 정의된 값 | 출처 |
|------|----------|------|
| `executionMode` | `'single'` `'auto-cycle'` `'interview'` `'arena'` | schema.ts enum |
| `pipelineMode` | `'legacy'` (기본값), `'pipeline'` | schema.ts default + types/context.ts |

`TaskContext.pipelineMode: 'pipeline' | 'legacy'` (src/lib/adpl/types/context.ts:9) 에서 Phase P 엔진이 읽는 값은 `'pipeline'` 또는 `'legacy'`다.

**`phase_p`나 `phase-p` 값은 현재 어디에도 정의되지 않았다.** 설계 문서가 혼용하고 있으므로 구현 전 확정 필요.

### 2.3 저장 위치 — `tasks` 행별 vs `projects` 설정

설계 6 §7.2는 `projects.execution_mode = 'phase-p'`로 전환 조건을 명시했으나, **실제 `projects` 테이블에는 `execution_mode` 컬럼이 없다**:

```typescript
// src/lib/db/schema.ts:103-114
export const projects = sqliteTable('projects', {
  id:          text('id').primaryKey(),
  name:        text('name').notNull(),
  path:        text('path').notNull(),
  description: text('description'),
  icon:        text('icon'),
  createdAt:   text('created_at').notNull(),
  updatedAt:   text('updated_at').notNull(),
});
// execution_mode 없음
```

현재 라우팅 필드는 **`tasks.pipeline_mode`** (행별). 프로젝트 레벨 설정이 필요하다면 `projects` 테이블 컬럼 추가 또는 `tasks` 기본값 방식 중 C9-1 설계 전에 결정해야 한다.

### 2.4 pipeline.ts에서 이 필드를 읽는 지점

현재 `runPipeline` 내부에서 `task.pipelineMode`를 읽는 코드는 **없다**. L226에서 읽는 것은 별개의 `executionMode`:

```typescript
// src/worker/pipeline.ts:226
const executionMode = (task as any).executionMode ?? 'single';
// → 'single' | 'auto-cycle' | 'interview' | 'arena' 분기용
```

### 2.5 UI에서 이 값을 설정하는 곳

별도 grep 결과 없음. 현재 UI에서 `pipelineMode`를 직접 설정하는 경로는 확인되지 않았다.

---

## 3장. 구조적 분기 삽입 지점 사상

### 전제 확인

현재 `src/worker/pipeline.ts`의 export 함수가 이미 `runPipeline`이다. 설계 문서 §7.1의 목표 구조:

```typescript
// 설계 문서 목표 (src/lib/pipeline.ts — 실제는 src/worker/pipeline.ts)
export async function runPipeline(task: Task): Promise<PipelineResult> {
  if (task.executionMode === 'phase-p') {
    const yaml = await loadPipelineYaml(task.projectId);
    return phaseP.runPipeline(yaml, task);
  }
  return runLegacyPipeline(task);
}
```

### 후보 A — runPipeline() 상단에 즉시 분기

```typescript
export async function runPipeline(taskId: string, rawEmit: EmitFn, signal?: AbortSignal): Promise<void> {
  // DB에서 task 조회 (최소 읽기)
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) { /* emit error */ return; }

  if (task.pipelineMode === 'phase_p') {
    return runPhasePPipeline(taskId, rawEmit, signal, task);
  }

  // 기존 로직 전부 여기서 계속 (건드리지 않음)
  // ...
}
```

| 항목 | 평가 |
|------|------|
| 수정 범위 | 최소 (L22 직후 5줄 삽입 + task 조회 이동) |
| legacy 회귀 리스크 | 낮음 — 분기가 상단이라 legacy 코드 미접촉 |
| 테스트 용이성 | 우수 — 분기 로직이 완전히 분리됨 |
| 공통 preprocessing | ❌ **중복** — emit 래퍼, MCP 초기화 등을 Phase P 경로에서도 재구현해야 함 |
| **추천** | 2순위 (preprocessing 중복이 초기에는 오히려 격리를 보장) |

### 후보 B — preprocessing 후 코어 실행 직전

현재 L225 부근의 "4. Determine execution mode" 블록 직전에 `pipelineMode` 분기를 삽입:

```typescript
// L225 직전
if (task.pipelineMode === 'phase_p') {
  // emit 래퍼, config, MCP 등 공통 preprocessing은 이미 완료
  return runPhasePPipeline(taskId, emit, signal, { projectDir, config, mcpManager });
}

// 기존 executionMode 분기 계속
const executionMode = (task as any).executionMode ?? 'single';
```

| 항목 | 평가 |
|------|------|
| 수정 범위 | 중간 — L225 부근 수정, 공통 preprocessing 경로 공유 |
| legacy 회귀 리스크 | 중간 — 공통 블록(MCP, config, hookEngine)을 Phase P 경로가 공유하므로 그 블록 수정 시 양쪽 영향 |
| 테스트 용이성 | 중간 — "preprocessing 이후" 상태를 모킹해야 함 |
| 공통 preprocessing | ✅ **공유** — 코드 중복 없음 |
| **추천** | 3순위 (MCP shutdown이 finally에 있어서 Phase P 완료 후에도 mcpManager.shutdown() 호출 — 부작용 가능성) |

### 후보 C — 기존 runPipeline을 runLegacyPipeline으로 rename, 새 facade 추가

```typescript
// src/worker/pipeline.ts

// 새 public entry (80줄)
export async function runPipeline(taskId: string, rawEmit: EmitFn, signal?: AbortSignal): Promise<void> {
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) { rawEmit({ type: 'log', level: 'error', message: `Task ${taskId} not found` }); return; }

  if (task.pipelineMode === 'phase_p') {
    return runPhasePPipeline(taskId, rawEmit, signal, task);
  }
  if (task.pipelineMode === 'shadow') {
    return runShadowPipeline(taskId, rawEmit, signal, task);  // C9-3 stub
  }
  return runLegacyPipeline(taskId, rawEmit, signal);
}

// 기존 코드 그대로 (이름만 변경)
async function runLegacyPipeline(taskId: string, rawEmit: EmitFn, signal?: AbortSignal): Promise<void> {
  // 현재 runPipeline 내용 1,240줄 그대로
}
```

| 항목 | 평가 |
|------|------|
| 수정 범위 | 최소 — 함수 rename 1건 + 새 함수 추가 |
| legacy 회귀 리스크 | **최저** — 기존 코드를 한 줄도 변경하지 않음, rename만 |
| 테스트 용이성 | **최우수** — facade는 얇고, runLegacyPipeline은 독립 mock 가능 |
| 공통 preprocessing | ❌ 중복 (Phase P 경로는 별도 preprocessing). 하지만 초기에는 이것이 안전함 |
| shadow hook 여지 | ✅ `pipelineMode === 'shadow'` 분기를 지금 추가해두면 C9-3에서 stub 채우기만 하면 됨 |
| **추천** | ✅ **1순위** |

**추천 이유**: 기존 `runPipeline` 내부를 전혀 건드리지 않으므로 legacy 회귀 리스크가 0에 가깝다. `runPipeline` → `runLegacyPipeline` rename은 IDE의 리팩토링 기능 또는 sed 한 줄로 가능하다. 테스트에서 `runLegacyPipeline`과 `PipelineExecutor.run()`을 각각 mock하면 분기 로직만 순수하게 검증 가능하다.

---

## 4장. 기존 pipeline 호출자들

### 4.1 전체 호출자 (grep 결과)

```
src/worker/index.ts:2:  import { runPipeline } from './pipeline';
src/worker/index.ts:101: runPipeline(taskId, emit, abortController.signal)
```

**호출자는 단 1곳**. 직접 import하는 곳도 `src/worker/index.ts` 하나뿐이다.

### 4.2 호출 컨텍스트

```typescript
// src/worker/index.ts:80-101
function startPipeline(taskId: string): void {
  const abortController = new AbortController();
  activeTasks.set(taskId, abortController);
  // IPC로 event 즉시 전송
  process.send?.({ taskId, event: { type: 'log', ... } });

  const emit = (event: PipelineEvent) => {
    try { process.send?.({ taskId, event }); } catch { /* IPC 닫힘 무시 */ }
  };

  runPipeline(taskId, emit, abortController.signal)  // ← 여기
    .catch(...)
    .finally(() => {
      activeTasks.delete(taskId);
      processQueue();
    });
}
```

- **분류**: Worker 프로세스 IPC (Node.js child_process fork)
- **인자**: `taskId: string`, `emit: EmitFn`, `signal: AbortSignal`
- **return**: `Promise<void>` — 결과는 emit 이벤트로만 전달, return value 미사용

### 4.3 C9-1 후 호출자 전환 방침

**기존 호출자는 그대로 놓아둔다 (추천).** 이유:
- 호출자가 1개뿐이고 signature가 변경되지 않는다 (후보 C에서도 `runPipeline`의 signature는 동일 유지)
- Facade를 새 entry point로 추가하는 것이 목적이지, 기존 Worker 인프라를 바꾸는 것이 아니다
- 향후 Phase P 전용 Worker를 분리할 경우에는 그때 별도 entry 추가

---

## 5장. Phase P 엔진 진입점 확인

### 5.1 import 경로

```typescript
import { PipelineExecutor } from '@/lib/adpl/engine/executor';
// 또는
import { PipelineExecutor } from '../lib/adpl/engine/executor';
```

파일: `src/lib/adpl/engine/executor.ts` (209줄)

### 5.2 `run()` signature (실제 코드 인용)

```typescript
// src/lib/adpl/engine/executor.ts:15-46
export interface RunInput {
  pipelineYaml: string;
  projectId: string;
  pipelineVersionId: string;
  taskId: string;
  triggerContext: TriggerContext;
  /** Absolute path to the worktree root for this run. Required for adapters that perform side effects. */
  worktreeRoot: string;
}

export interface RunOptions {
  env?: Record<string, string>;
  scheduler?: SchedulerOptions;
  worker?: WorkerOptions;
  useCompileCache?: boolean;
}

export interface RunResult {
  runId: string;
  pipelineVersionId: string;
  status: 'completed' | 'failed' | 'cancelled';
  completedNodes: number;
  failedNodes: number;
  skippedNodes: number;
  cancelledNodes: number;
  totalDurationMs: number;
  compileDurationMs: number;
  executionDurationMs: number;
  state: PipelineRunState;
  plan: ExecutionPlan;
}

// src/lib/adpl/engine/executor.ts:85
async run(input: RunInput, options: RunOptions = {}): Promise<RunResult>
```

### 5.3 사전 준비 필요 항목

```typescript
// PipelineExecutor 생성자 — src/lib/adpl/engine/executor.ts:78-83
constructor(
  private readonly compiler: PipelineCompiler,
  private readonly registry: AdapterRegistry,
  private readonly store: StateStore,
  private readonly bus: EventBus,
)
```

Facade에서 `PipelineExecutor`를 사용하려면:
1. `PipelineCompiler` 인스턴스 생성
2. `AdapterRegistry` 인스턴스 생성 + 어댑터 등록 (agent/shell/http/webhook_out)
3. `StateStore` 인스턴스 생성
4. `EventBus` 인스턴스 생성
5. `RunInput` 조립: `pipelineYaml` (DB에서 로드), `worktreeRoot` (task.projectDir), `triggerContext` (task_created 타입)

### 5.4 DB 연결 책임

**엔진 내부는 DB를 직접 사용하지 않는다.** `StateStore`는 in-memory 저장소(`Map`). DB 연결은 Facade에서 담당:
- `pipelineVersions` 테이블에서 `pipelineYaml` 읽기
- task 상태 업데이트 (`pipelineMode === 'phase_p'` 경로용)

### 5.5 legacy pipeline과의 preprocessing 차이

| preprocessing | legacy `runPipeline` | Phase P Facade |
|--------------|---------------------|----------------|
| emit 래퍼 (DB 저장) | L24-35 — events 테이블 insert | 동일하게 구현 필요 |
| task 조회 | L37 | L37 (공통 또는 재조회) |
| projectDir 결정 | `resolveProjectDir()` | 동일 로직 필요 |
| loadConfig | L55 | 필요 없을 수도 있음 (YAML에 모두 명시) |
| HookEngine | L58-62 | **skip** (Phase P에서 Hook은 shell 노드로 흡수) |
| McpManager | L87-124 | **skip** (AdapterRegistry가 담당) |
| projectHistory | L66-84 | **skip** (YAML에서 참조하면 됨) |
| YAML 로딩 | 해당 없음 | **신규** — pipelineVersions 조회 |
| TriggerContext 조립 | 해당 없음 | **신규** — `task_created` 타입으로 생성 |

---

## 6장. Shadow mode 사전 고려 (C9-3 연결)

### 6.1 설계 문서의 Shadow 계획

설계 6 §8.2에서 `src/lib/adpl/shadow/runner.ts`의 구조가 이미 정의되어 있다:

```typescript
export async function runWithShadow(task: Task): Promise<PipelineResult> {
  const primary = runLegacyPipeline(task);
  if (shouldShadow(task)) {
    const shadow = runPhaseP(task).catch(err => ({ ok: false, error: err }));
    shadow.then(shadowResult => primary.then(primaryResult => {
      compareAndStore(primaryResult, shadowResult, task);
    }));
  }
  return primary;
}
```

**현재 이 파일은 존재하지 않는다** (C9-3 구현 예정).

### 6.2 `shadow` 값 추가 시점

C9-1 Facade에서 `pipelineMode === 'shadow'` 분기를 **stub으로 미리 추가**하는 것이 추천이다. 이유:
- C9-3에서 shadow runner를 만들 때 facade를 다시 열지 않아도 됨
- `shadow` 분기 자리가 명시적으로 남아 있으면 C9-3 구현자가 context 재파악 불필요

```typescript
// C9-1에서 추가할 stub
if (task.pipelineMode === 'shadow') {
  // C9-3에서 구현 예정 — 현재는 legacy fallback
  return runLegacyPipeline(taskId, rawEmit, signal);
}
```

### 6.3 shadow worktree 문제

설계 §9.4 미결 질문 9번: "Primary와 shadow가 같은 worktree를 쓰면 race condition." — **C9-1 범위 아님**. C9-3에서 결정. C9-1 Facade는 이 문제를 건드리지 않는다.

### 6.4 결론

| 결정 사항 | C9-1 | C9-3 |
|----------|------|------|
| `'shadow'` 분기 자리 추가 | ✅ stub | 실구현 |
| shadow runner 로직 | ❌ | ✅ |
| comparator / report | ❌ | ✅ |

---

## 7장. 테스트 전략

### 7.1 기존 테스트 현황

`src/worker/__tests__/` 디렉토리가 **존재하지 않는다**. `src/worker/pipeline.ts`에 대한 테스트는 현재 전무하다.

### 7.2 테스트 옵션

**옵션 1 — Unit (분기 로직만, 완전 mock)**

```typescript
// pipeline.test.ts
import { runPipeline } from '@/worker/pipeline';
// runLegacyPipeline과 runPhasePPipeline을 jest.mock

test('pipelineMode=legacy → runLegacyPipeline 호출', async () => {
  mockDb.returns({ pipelineMode: 'legacy', ... });
  await runPipeline('task-1', emit, signal);
  expect(runLegacyPipeline).toHaveBeenCalledWith('task-1', ...);
  expect(runPhasePPipeline).not.toHaveBeenCalled();
});
```

- DB, MCP, 에이전트 등 전부 mock
- **분기 로직 자체의 정확성만** 검증
- 빠르고 안정적

**옵션 2 — 축소 E2E (실제 PipelineExecutor + fake YAML)**

```typescript
// pipeline-e2e.test.ts
test('pipelineMode=phase_p → PipelineExecutor.run 완주', async () => {
  // DB에 test task + pipelineVersions(fake yaml) 삽입
  // 실제 PipelineExecutor 사용, AdapterRegistry에 MockAdapter만 등록
  await runPipeline('task-1', emit, undefined);
  expect(emittedEvents).toContainEqual({ type: 'task_complete', success: true });
});
```

- 실제 DB(in-memory SQLite), 실제 Executor, 에이전트만 mock
- 전체 경로 통합 검증

**추천: 옵션 1 + 옵션 2 둘 다**

분기 로직이 명확해야 안전하고 (옵션 1), 실제 호출 경로도 1번은 통과해봐야 한다 (옵션 2). C8-1 HTTP 테스트 패턴(mock-first + integration 두 레이어)과 동일.

---

## 8장. 호출 체계 호환성

### 8.1 Signature 비교표

| 항목 | `runPipeline` (legacy) | `PipelineExecutor.run()` |
|------|----------------------|------------------------|
| **식별자** | `taskId: string` | `input.taskId: string` |
| **YAML** | 없음 (내부에서 에이전트가 생성) | `input.pipelineYaml: string` 필수 |
| **projectId** | DB `task.projectId` 에서 취득 | `input.projectId: string` 명시적 필요 |
| **triggerContext** | 없음 | `input.triggerContext: TriggerContext` 필수 |
| **worktreeRoot** | 내부 `resolveProjectDir()` | `input.worktreeRoot: string` 명시적 필요 |
| **emit** | `rawEmit: EmitFn` 파라미터 | `EventBus` 내부 — 외부에서 subscriber 등록 필요 |
| **signal** | `signal?: AbortSignal` | `options.scheduler/worker` 내부 — 직접 연결 없음 |
| **return** | `Promise<void>` (emit으로만 결과 전달) | `Promise<RunResult>` (결과 직접 반환) |
| **에러 전달** | try/catch + emit + updateTaskStatus | `RunResult.status === 'failed'` + throw |

### 8.2 Adapter 함수 설계 방향

불일치가 많으므로 Facade 내부에 **변환 함수**가 필요하다. 제안:

```typescript
// C9-1 Facade 내부 헬퍼 (src/worker/pipeline.ts의 runPhasePPipeline)

async function runPhasePPipeline(
  taskId: string,
  rawEmit: EmitFn,
  signal: AbortSignal | undefined,
  task: TaskRow,
): Promise<void> {
  // 1. emit 래퍼 (legacy와 동일 — DB 저장)
  const emit: EmitFn = wrapEmitWithDb(taskId, rawEmit);

  // 2. pipelineYaml 조회
  const version = db.select().from(pipelineVersions)
    .where(eq(pipelineVersions.id, task.pipelineVersionId!)).get();
  if (!version) {
    emit({ type: 'log', level: 'error', message: 'No pipeline version found' });
    return;
  }

  // 3. worktreeRoot 결정
  const worktreeRoot = await resolveProjectDir(taskId, task.projectDir);

  // 4. TriggerContext 조립 (task_created 타입)
  const triggerContext: TriggerContext = {
    triggerId: nanoid(),
    type: 'task_created',
    firedAt: new Date().toISOString(),
  };

  // 5. PipelineExecutor 조립 (Singleton 또는 per-run)
  const executor = buildExecutor();  // AdapterRegistry에 실제 adapter 등록

  // 6. EventBus → emit 연결
  executor.bus.subscribe((event) => emit(translateBusEvent(event)));

  // 7. 실행
  const result = await executor.run({
    pipelineYaml: version.pipelineYaml,
    projectId: task.projectId ?? '',
    pipelineVersionId: task.pipelineVersionId!,
    taskId,
    triggerContext,
    worktreeRoot,
  });

  // 8. 결과 → task 상태 업데이트
  updateTaskStatus(taskId, result.status === 'completed' ? 'completed' : 'failed', {
    summary: `Phase P: ${result.status} (${result.completedNodes} nodes)`,
  });
  emit({ type: 'task_complete', success: result.status === 'completed' });
}
```

**의견 요청**: EventBus 이벤트를 `EmitFn`(PipelineEvent) 으로 변환하는 `translateBusEvent()` 함수의 설계가 핵심 난이도다. `bus.subscribe()`가 공개 API인지 확인 필요. 현재 `EventBus`의 subscribe 인터페이스를 먼저 확인하고 진행 추천.

---

## 9장. Phase P YAML 로딩 전략

### 9.1 DB 컬럼 확인

`pipelineVersions` 테이블에 `pipelineYaml` 컬럼이 있다:

```typescript
// src/lib/db/schema.ts:116-140
export const pipelineVersions = sqliteTable('pipeline_versions', {
  id:          text('id').primaryKey(),
  projectId:   text('project_id').notNull().references(() => projects.id, ...),
  versionNumber: integer('version_number').notNull(),
  pipelineYaml: text('pipeline_yaml').notNull(),    // ← 여기
  adplVersion:  text('adpl_version').notNull().default('1.0'),
  // ...
});
```

`tasks.pipelineVersionId`가 `pipelineVersions.id`를 참조(FK):

```typescript
// src/lib/db/schema.ts:28
pipelineVersionId: text('pipeline_version_id').references(() => pipelineVersions.id),
```

### 9.2 Stage 2 테스트의 YAML 로딩 방식

Stage 2 엔진 테스트들 (`src/lib/adpl/engine/__tests__/e2e.test.ts` 등)은 **인라인 YAML 문자열**을 직접 `PipelineExecutor.run()`에 전달했다. DB를 거치지 않는다.

### 9.3 C9-1 YAML 로딩 결론

| 옵션 | 설명 | C9-1 포함 여부 |
|------|------|---------------|
| **옵션 A — DB 조회** | `tasks.pipelineVersionId` → `pipelineVersions.pipelineYaml` | ✅ C9-1 포함 |
| 옵션 B — 파일시스템 | `.autodev/pipelines/{id}.yaml` | ❌ 현재 구조에 없음 |
| 옵션 C — C9-2 생성기 | `pipeline-generator.ts`로 기본 YAML 생성 | C9-2 범위 |

**추천**: 옵션 A를 C9-1에 포함한다. `pipelineVersionId`가 null이면 에러 emit + 조기 return. C9-2에서 `pipelineVersionId`를 자동 populate하는 로직을 추가하면 연결이 자연스럽다.

**단, C9-1 테스트를 위해** test fixture에서 `pipelineVersions`에 row를 직접 insert하는 방식으로 C9-2 의존성 없이 검증 가능.

---

## 10장. 예상 소요 시간 + 범위 재산정

### 10.1 로드맵 v7 원래 예상

```
Stage 3 전체: 2-3주
C9 (Facade + Shadow) 개별 시간: 로드맵 v7에 기재 없음
```

설계 6 문서에서 구체적인 C9-1 시간 추정 없음. C8-1(HTTP Adapter)이 9시간 소요됨.

### 10.2 작업 단위별 추정

| 작업 항목 | 추정 시간 | 근거 |
|-----------|---------|------|
| `runPipeline` → `runLegacyPipeline` rename (1건) | 0.5h | IDE 리팩토링 또는 sed |
| 새 facade `runPipeline` 스켈레톤 + `pipelineMode` 분기 | 1h | 분기 로직 단순, 타입 맞추기가 주 작업 |
| `runPhasePPipeline` 헬퍼 (YAML 조회 + TriggerContext + Executor 조립) | 4h | EventBus 연결, signature 불일치 해소 |
| `shadow` stub 분기 추가 (C9-3 준비) | 0.5h | 단순 legacy fallback |
| Unit 테스트 (분기 로직 mock) | 2h | mock 설계 + 케이스 3-5개 |
| 축소 E2E 테스트 (in-memory DB + MockAdapter) | 3h | DB fixture + EventBus 연결 검증 |
| `pnpm ship` 통과 | 1h | 빌드 + typecheck + verify:cross |
| **합계** | **12h** | |

### 10.3 불확실성 요소

- **EventBus subscribe API**: 공개 subscribe 메서드가 없거나 다른 패턴이면 +2h
- **TriggerContext 타입 확장 필요 여부**: `task_created` 타입이 현재 TriggerContext union에 없을 경우 +1h
- **AdapterRegistry singleton 설계**: Worker 프로세스 당 1개를 유지할지 run 당 새로 만들지 결정 필요 +1-2h

**C8-1 HTTP(9h) 대비**: C9-1은 기존 파일을 건드리는 최초 작업이므로 **12-14h** 추정이 현실적이다.

---

## 최종 섹션 — 발견사항 / 리스크 / 사전 결정 필요 사항

### 발견사항

1. **파일 위치 불일치**: 설계 문서는 `src/lib/pipeline.ts`이나 실제는 `src/worker/pipeline.ts`. C9-1은 `src/worker/pipeline.ts`를 수정한다.

2. **라우팅 필드 불일치**: 설계 문서 §7.2는 `projects.execution_mode`와 `task.executionMode === 'phase-p'`를 언급하나, 실제 라우팅 필드는 `tasks.pipeline_mode` (default `'legacy'`). `executionMode`는 완전히 별개의 레거시 사이클 모드.

3. **`projects.execution_mode` 미구현**: 설계 문서 7.2의 전환 조건 중 하나가 현재 스키마에 없다. 프로젝트 레벨 전환 UI가 필요하다면 `projects` 테이블 컬럼 추가가 선행 필요.

4. **호출자 단 1곳**: `src/worker/index.ts:101`. 호출자 전환 불필요.

5. **기존 pipeline.ts 테스트 전무**: 위험 요소. C9-1이 최초로 테스트를 도입하는 기회.

6. **EventBus → EmitFn 변환 미정의**: 가장 큰 설계 공백. C9-1의 핵심 난이도.

### 리스크

| 리스크 | 심각도 | 완화 방안 |
|--------|-------|---------|
| `pipelineMode` 값 불일치 (`'phase_p'` vs `'phase-p'` vs `'pipeline'`) | 높음 | C9-1 시작 전 값 확정 (이 문서에서 결정 요청) |
| EventBus subscribe API가 내부용으로 제한됨 | 중간 | executor.ts 먼저 읽어 bus 접근 방식 확인 |
| `worktreeRoot`가 null인 task (projectDir 없음) | 중간 | `resolveProjectDir()` 공유 또는 재구현 |
| Worker 재시작 없이 rename 후 타입 오류 | 낮음 | `pnpm build`로 즉시 확인 |

### 구현 전 판단 필요 사항 (최소 2건)

**판단 1 — `pipelineMode` 값 확정**

현재 혼용:
- `tasks.pipeline_mode` default `'legacy'` → Phase P용 값이 `'phase_p'`? `'phase-p'`? `'pipeline'`?
- `TaskContext.pipelineMode: 'pipeline' | 'legacy'` (context.ts)
- 설계 §7.2: `task.executionMode === 'phase-p'`

추천: **`'pipeline'`** (context.ts와 일치, 언더스코어/하이픈 혼용 제거)

결정 필요 이유: Facade의 분기 조건이 이 값에 직접 의존하며, DB의 기존 row 업데이트 필요 여부도 이에 달려 있다.

---

**판단 2 — `pipelineVersionId`가 null인 task 처리 방침**

현재 `tasks.pipeline_version_id`는 nullable FK. Phase P 경로(`pipelineMode === 'pipeline'`)인데 `pipelineVersionId`가 null이면?

옵션 A — C9-1에서 에러 emit 후 즉시 return (C9-2에서 자동 populate 예정)  
옵션 B — C9-1에서 기본 YAML 하드코딩 fallback 포함 (C9-2 불필요)  
옵션 C — C9-2를 C9-1과 묶어서 동시 구현

추천: **옵션 A** — C9-1 범위를 분기 로직으로 한정하고, null 시 에러 처리. C9-2에서 자동 populate.

---

**판단 3 — AdapterRegistry 수명 주기**

`PipelineExecutor`의 생성자 인자 중 `AdapterRegistry`가 있다. Worker 프로세스 시작 시 한 번 생성(singleton)할지, run마다 새로 생성할지 결정 필요.

추천: **Worker 레벨 singleton** — `src/worker/index.ts`에서 초기화 후 Facade에 주입.

---

**판단 4 (추가) — `projects.execution_mode` 컬럼 추가 여부**

설계 §7.2는 프로젝트 레벨 전환 토글을 명시했으나 스키마에 없다. C9-1 범위에 이 컬럼 추가를 포함할지, task 레벨(`pipelineMode`)만으로 충분히 할지 결정 필요.

추천: **task 레벨만으로 C9-1 구현**. 프로젝트 레벨 토글은 UI와 함께 별도 커밋(Stage 3 후반 또는 Stage 7).

---

*조사 완료. 코드/테스트 수정 없음. 수락 기준 10장 모두 충족.*
