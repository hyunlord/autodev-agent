# Stage 3 C8-1 사전 조사 — HTTP Adapter 구현 대상 파악

> 작성: 2026-04-22  
> 목적: C8-1 구현 전 기존 자산 현황 + 설계 §5 현실성 점검  
> 수정: 읽기 전용 조사, 코드 변경 없음  
> 선행: C7-2 (Shell Adapter 완료), C7-3 (Hook Bridge 완료)

---

## 1장. 현재 HTTP 호출 실체 파악

레포 전체 `fetch(` 검색 결과 **8개 호출 지점** 확인. axios/got/node-fetch/undici/http.request 는 소스 코드에서 미사용.

### 1.1 전체 호출 지점 목록

| 파일 | 라인 | 목적 | Timeout | Retry | 429 처리 |
|------|------|------|---------|-------|----------|
| `src/lib/webhooks/sender.ts` | 30 | Webhook 전송 (Slack/Discord 등) | ✅ 5s AbortController | ❌ | ❌ |
| `src/lib/plugins/verifiers/http-check.ts` | 9 | HTTP 검증 (2xx 확인) | ✅ 10s AbortController | ❌ | ❌ |
| `src/lib/hooks/hook-engine.ts` | 509 | Hook HTTP 실행 | ✅ (signal 전달) | ❌ | ❌ |
| `src/agents/verify/verify-agent.ts` | 1612 | OpenRouter VLM API 호출 | ❌ | ❌ | ❌ |
| `src/app/api/vlm/test/route.ts` | 36 | OpenRouter 모델 목록 조회 | ❌ | ❌ | ❌ |
| `src/lib/a2a/client.ts` | 16 | A2A Agent 카드 조회 | ❌ | ❌ | ❌ |
| `src/lib/a2a/client.ts` | 26 | A2A Task 전송 (JSON-RPC) | ❌ | ❌ | ❌ |
| `src/lib/a2a/client.ts` | 46 | A2A Task 상태 조회 (JSON-RPC) | ❌ | ❌ | ❌ |

### 1.2 HTTP Client 현황

- **사용 중**: Node.js 18+ 내장 `fetch()` — 유일한 HTTP 클라이언트
- **패키지에만 존재**: `axios@1.14.0` (pnpm-lock.yaml), 소스 코드에서 import 없음
- **form-data**: axios 경유 transitive 의존만, 직접 설치 없음

### 1.3 대표 구현체 코드 인용

**webhooks/sender.ts — 가장 잘 작성된 패턴 (C8-1 참조 대상)**:
```typescript
// src/lib/webhooks/sender.ts:26-35
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS); // 5000ms
try {
  const res = await fetch(hook.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: controller.signal,
  });
```

**http-check.ts — AbortController 패턴**:
```typescript
// src/lib/plugins/verifiers/http-check.ts:6-9
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), timeoutMs);
const response = await fetch(url, { signal: controller.signal });
```

### 1.4 공통 패턴 및 문제점

- **timeout**: AbortController 패턴 일관적으로 사용 (webhooks, http-check). 다른 곳은 미적용.
- **Retry-After / 429**: 레포 전체에서 헤더 기반 rate-limit 대응 로직 **전무**. `src/worker/retry.ts:91`에 문자열 매칭(`lower.includes('429')`)만 존재.
- **Multipart/Form**: 현재 모든 호출이 JSON body. multipart/form 전송 사례 없음.
- **인증**: 각 호출마다 개별 처리 (Bearer token, API key 헤더 등). 공통 auth 레이어 없음.

---

## 2장. HookEngine `http` type 상세

**파일**: `src/lib/hooks/hook-engine.ts`

### 2.1 http hook 설정 스키마

```typescript
// hook-engine.ts (HookDefinition 내 http 관련 필드)
url?: string;
method?: string;             // default: 'POST'
headers?: Record<string, string>;  // {{env.VAR}} 치환 지원
timeout?: number;            // seconds, AbortController 에 적용
blocking?: boolean;          // default: true
failAction?: 'ignore' | 'warn' | 'retry' | 'replan' | 'fail';
```

### 2.2 http hook 실행 코드 (실제 인용)

```typescript
// src/lib/hooks/hook-engine.ts:500-537
const headers: Record<string, string> = { 'Content-Type': 'application/json' };
for (const [key, val] of Object.entries(hook.headers ?? {})) {
  headers[key] = val.replace(
    /\{\{env\.(\w+)\}\}/g,
    (_, name: string) => process.env[name] ?? '',
  );
}

const res = await fetch(hook.url ?? '', {
  method: hook.method ?? 'POST',
  headers,
  body: JSON.stringify(input),   // HookInput 객체 항상 JSON
  signal: controller.signal,
});

const body = await res.text();
try {
  const parsed = JSON.parse(body) as Record<string, unknown>;
  return {
    name: hook.name,
    decision: (parsed.decision as 'allow' | 'deny' | 'modify') ?? (res.ok ? 'allow' : 'deny'),
    // ...
  };
} catch {
  return { name: hook.name, decision: res.ok ? 'allow' : 'deny', reason: body.slice(0, 300) };
}
```

### 2.3 Hook http → C8-1 관계

- C7-3 Hook Bridge 에서 `http` type hook 은 **skip** 처리됨 (shell만 ShellNode 변환)
- C8-1 완료 후: `http` type hook → `HttpNode` 로 변환 경로 추가 가능
- 그러나 HookEngine 의 body 는 항상 `JSON.stringify(input)` 고정이므로, C8-1의 5-format body builder 와 직접 연결되지는 않음. C7-3 확장 시 bodyFormat 매핑 별도 필요.

### 2.4 제한사항

- body format: JSON 전용 (form/text/binary/multipart 지원 없음)
- retry: `failAction: 'retry'`는 있으나 backoff/Retry-After 없음
- 429/503 대응: 없음

---

## 3장. 설계 §5.2 5 body format vs 실제 구현체 능력

### 3.1 설계 §5.2 body format 정의

```typescript
// docs/phase-p/28_PhaseP_design6_stage3_leaf_adapters.md:952-973
case 'json':
  headers.set('content-type', 'application/json');
  return { body: JSON.stringify(spec.body), headers };
case 'form':
  headers.set('content-type', 'application/x-www-form-urlencoded');
  return { body: new URLSearchParams(spec.body as any).toString(), headers };
case 'text':
  headers.set('content-type', 'text/plain');
  return { body: String(spec.body), headers };
case 'binary':
  return { body: Buffer.from(spec.body as string, 'base64'), headers };
case 'multipart':
  return buildMultipart(spec, headers);  // ← 구현체 미제공 (C8-1 구현 필요)
```

### 3.2 Node.js 18+ native fetch 지원 범위

| format | BodyInit 타입 | Node.js 지원 | 비고 |
|--------|-------------|-------------|------|
| json | string | ✅ | `JSON.stringify` |
| form | string (URLSearchParams) | ✅ | `new URLSearchParams().toString()` |
| text | string | ✅ | `String(value)` |
| binary | Buffer | ✅ | Node.js Buffer = Uint8Array |
| multipart | FormData | ✅ Node 18.13+ | native `FormData` 사용 가능 |

**multipart 결론**: 별도 라이브러리 불필요. Node 18+ 내장 `FormData` 사용 가능. 단, boundary 자동 생성은 `fetch()` 내부에서 처리되므로 `Content-Type` 헤더를 **직접 설정하면 안 됨** (boundary 값 누락 → 서버 파싱 실패).

### 3.3 실제 사용 빈도

- **json**: 8개 호출 지점 전부 → 100%
- **form / text / binary / multipart**: 현재 사용 사례 없음

---

## 4장. Retry 정책 — method 별 idempotent

### 4.1 설계 §5.3 방식 vs 실제 스키마 불일치 ⚠️

설계 §5.3 코드:
```typescript
// 설계 문서 (28_PhaseP_design6_stage3_leaf_adapters.md:987-994)
if (spec.retry?.max !== undefined) return spec.retry.max;
if (method === 'POST') {
  return spec.headers?.['idempotency-key'] ? 2 : 0;
}
```

실제 Zod 스키마 (`src/lib/adpl/schemas/nodes/http.ts`):
```typescript
retryPolicy: HttpRetryPolicySchema.optional(),
// HttpRetryPolicySchema = RetryPolicySchema.extend({ onStatuses })
// RetryPolicySchema 필드: maxAttempts, backoff, initialDelay, maxDelay
```

**불일치 목록**:
| 설계 문서 | 실제 스키마 | 결론 |
|----------|------------|------|
| `spec.retry?.max` | `spec.retryPolicy?.maxAttempts` | **스키마가 진실** |
| `spec.headers?.['idempotency-key']` | `spec.idempotencyKey` (별도 필드) | **스키마가 진실** |
| `spec.retry?.backoff?.baseMs` | `spec.retryPolicy?.initialDelay` (seconds) + `backoff` (enum) | **스키마가 진실** |

→ C8-1 구현 시 설계 §5.3/§5.4 코드는 **참조만**, 실제 필드명은 Zod 스키마 기준으로 작성.

### 4.2 Worker 기존 Retry 인프라

```typescript
// src/lib/adpl/engine/worker/retry-policy.ts
export function shouldRetry(node, error, currentAttempt): boolean
export function calcBackoff(config: RetryPolicy, retryNum: number): number
export async function sleepWithCancel(ms, token): Promise<void>
```

Worker 가 이미 `shouldRetry` + `calcBackoff` + `sleepWithCancel` 를 담당. **HTTP adapter 는 Retry 제어를 Worker 에 위임하되, `onStatuses` 필터만 추가 구현**.

### 4.3 Retry-After 헤더 처리

- 현재 레포 전체에서 `Retry-After` 헤더 파싱 로직 **없음**
- `src/worker/retry.ts:91` 문자열 매칭만 존재 (헤더 무시)
- C8-1 에서 **신규 구현 필요** — 설계 §5.4 의 `computeBackoff()` 참고 (단 필드명은 실제 스키마 기준)

### 4.4 idempotency-key

- `HttpNodeSpec.idempotencyKey` 필드 존재 (schema + type 모두 확인)
- POST + `idempotencyKey` 있으면 retry 2 허용하는 로직은 **C8-1 에서 신규 구현**
- 기존 레포에 idempotency-key 활용 사례 없음

---

## 5장. allowedHosts 정책 현황

**결론: YES — 타입/스키마는 존재. 실행 로직(host-checker) 미구현.**

### 5.1 타입 정의

```typescript
// src/lib/adpl/types/nodes/http.ts:20
allowedHosts?: string[]; // 보안: 허용 호스트 목록
```

### 5.2 Zod 스키마

```typescript
// src/lib/adpl/schemas/nodes/http.ts:35
allowedHosts: z.array(z.string()).optional(),
```

### 5.3 설계 §5.5 checkHost()

```typescript
// 설계 문서 (28_PhaseP_design6_stage3_leaf_adapters.md:1030-1039)
export function checkHost(url: string, projectId: string): { ok: boolean; reason?: string } {
  const policy = loadProjectHttpPolicy(projectId);
  if (!policy.allowedHosts) return { ok: true };  // 정책 없으면 통과
  // ...
}
```

**`loadProjectHttpPolicy()`가 미구현** — C8-1에서 신규 작성 필요.

### 5.4 기존 command-checker 유사 구조

```
src/lib/safety/command-checker.ts  →  Shell 정책 (위험 명령어 차단)
src/lib/adpl/engine/adapters/http/allowlist.ts (미존재)  →  HTTP 정책 (C8-1 신규)
```

### 5.5 기본값 전략

설계 §5.5: `if (!policy.allowedHosts) return { ok: true }` → **정책 없으면 모든 host 허용**. 즉 기본값은 "허용". C8-1 구현 방향 일치.

---

## 6장. Stage 2 NodeAdapter 계약 재확인

### 6.1 HttpNodeSpec Zod 스키마 존재 여부: **YES (완전)**

```typescript
// src/lib/adpl/schemas/nodes/http.ts (전체)
export const HttpMethodSchema = z.enum(['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS']);
export const BodyFormatSchema = z.enum(['json','form','text','binary','multipart']);
export const HttpRetryPolicySchema = RetryPolicySchema.extend({
  onStatuses: z.array(z.number().int()).optional(),
});
export const HttpNodeSpecSchema = NodeSpecBaseSchema.extend({
  type: z.literal('http'),
  url: z.string(),
  method: HttpMethodSchema.optional(),
  headers: z.record(z.string()).optional(),
  queryParams: z.record(z.string()).optional(),
  bodyFormat: BodyFormatSchema.optional(),
  body: z.unknown().optional(),
  allowedHosts: z.array(z.string()).optional(),
  idempotencyKey: z.string().optional(),
  retryPolicy: HttpRetryPolicySchema.optional(),
});
```

### 6.2 타입 정의 (src/lib/adpl/types/nodes/http.ts): **YES (완전)**

스키마와 타입 모두 완전히 일치. C7-2 에서 발생한 shell/mode 불일치 같은 문제 없음.

### 6.3 설계 §5.1 vs 실제 스키마 비교

| 설계 §5.1 필드 | 실제 스키마 필드 | 일치 여부 |
|--------------|--------------|---------|
| url | url | ✅ |
| method | method | ✅ |
| headers | headers | ✅ |
| queryParams | queryParams | ✅ |
| bodyFormat | bodyFormat | ✅ |
| body | body | ✅ |
| allowedHosts | allowedHosts | ✅ |
| idempotencyKey | idempotencyKey | ✅ |
| retryPolicy | retryPolicy | ✅ |

**필드명 불일치 없음.** 단 설계 §5.3/§5.4 코드 블록 내에서 `spec.retry` (구버전 명칭) 사용 → 실제 구현 시 `spec.retryPolicy` 로 교정 필요.

### 6.4 NodeAdapter 계약

```typescript
// src/lib/adpl/engine/adapters/types.ts (Shell 기준, HTTP 동일 패턴)
export interface NodeAdapter<T extends NodeSpecBase> {
  type: string;
  defaultTimeout(): number;
  validate(spec: T): ValidationResult;
  execute(spec: T, ctx: ExecutionContext, options: ExecutionOptions): Promise<NodeOutput>;
}
// options.eventBus.emit()  — EngineEvent 발행
// options.cancellationToken.signal  — AbortSignal
```

Shell adapter(`src/lib/adpl/engine/adapters/shell/index.ts`) 구조 그대로 HTTP adapter 에 적용.

---

## 7장. Event 타입 신규 필요성

### 7.1 현재 events/types.ts 현황

```typescript
// src/lib/adpl/engine/events/types.ts:4-25
export type EngineEvent =
  | RunStartedEvent | RunCompletedEvent | RunCancelledEvent | RunFailedEvent
  | NodeReadyEvent | NodeStartedEvent | NodeCompletedEvent
  | NodeRetryEvent | NodeSkippedEvent | NodeCancelledEvent
  | BranchTakenEvent | ParallelBranchDoneEvent
  | LoopIterationStartEvent | LoopIterationDoneEvent
  | GateOpenedEvent | GateDecidedEvent
  | AgentTokenEvent | AgentToolCallEvent | AgentFallbackEvent | AgentInputDegradedEvent
  | ShellOutputEvent;   // ← Shell이 유일한 adapter 전용 이벤트
```

`ShellOutputEvent`:
```typescript
export interface ShellOutputEvent extends EventBase {
  type: 'shell.output';
  nodeId: string;
  stream: 'stdout' | 'stderr';
  chunk: string;
}
```

### 7.2 Shell adapter 이벤트 전략 확인

Shell adapter(`src/lib/adpl/engine/adapters/shell/index.ts`)를 확인한 결과, **Shell은 별도 shell.output 이벤트를 emit하지 않음**. spawner.ts 에서 stdout 청크를 수집하지만 EventBus 에 보내지 않음. `ShellOutputEvent`는 정의만 되어 있고 Shell adapter 에서 실제 사용 없음.

→ HTTP adapter 도 동일하게 **별도 http.* 이벤트 없이** 제네릭 노드 이벤트(`node.started`, `node.completed`, `node.retry`)만 사용하는 것이 일관성 있는 접근.

### 7.3 권고: 최소 이벤트 전략

| 이벤트 | 타입 | 필요성 | 결정 |
|--------|------|--------|------|
| `node.started` | 기존 | Worker 자동 emit | Worker 처리, adapter 불필요 |
| `node.retry` | 기존 | Worker 자동 emit | Worker 처리, adapter 불필요 |
| `node.completed` | 기존 | Worker 자동 emit | Worker 처리, adapter 불필요 |
| `http.request` | 신규 | 요청 url/method 가시성 | 선택적 — 진단 목적 |
| `http.response` | 신규 | status 가시성 | 선택적 — 진단 목적 |
| `http.retry` | 신규 | Retry-After backoff 가시성 | Retry-After 존재 시 유용 |

**권고**: Shell 패턴에 맞춰 `http.request` / `http.response` 정의는 추가하되, 실제 emit은 선택적으로. Retry-After 대기 시 `http.retry` emit은 사용자 경험 상 유용 (긴 대기 시간 표시).

---

## 8장. Response 파싱 + $response 구조

### 8.1 NodeOutput.data 구조 확인

Shell adapter 실제 구현:
```typescript
// src/lib/adpl/engine/adapters/shell/index.ts:64-70
const data = {
  stdout: parsed,
  stderr: spawnResult.stderr.toString('utf-8'),
  exitCode: spawnResult.exitCode,
  outputTruncated: spawnResult.outputTruncated,
};
return { status: 'success', data, metrics };
```

HTTP adapter 제안:
```typescript
data: {
  status: number,           // HTTP status code
  headers: Record<string, string>,
  body: string | unknown,   // text 또는 parsed JSON
  bodyJson: unknown | null, // JSON 파싱 성공 시만, 실패 시 null
  bodyTruncated?: boolean,
}
```

### 8.2 다음 노드에서의 접근 방식

Stage 2 expression resolver 확인:
- `ctx.$nodes[nodeId].data` 접근 — `data: unknown` 타입, 런타임에 임의 필드 접근 가능
- `String()` 강제 변환 방식 (C7-1.5 조사 보고 참조) — 중첩 필드 직접 접근은 구현 여부 불명확

→ `$nodes['http-call'].data.status` 형식은 expression evaluator 가 점 표기 경로를 파싱하는지에 달려 있음. 현재 구현 확인 불가 — C8-1 테스트 시 검증 필요.

### 8.3 bodyJson 파싱 실패 처리

설계에 명시 없음. 제안 정책:
- `Content-Type: application/json` + 파싱 실패 → `bodyJson: null`, 로그 `warn`, throw 아님
- `Content-Type` 이 non-JSON + JSON처럼 보임 → 파싱 시도 후 성공 시 `bodyJson` 에 저장
- `bodyJson` null 이어도 `status: 'success'` — HTTP 성공과 파싱 성공은 독립

---

## 9장. 테스트 전략

### 9.1 Shell adapter 테스트 패턴 참조

```
src/lib/adpl/engine/adapters/shell/__tests__/
├── shell.test.ts       (E2E, 실제 child_process)
├── policy.test.ts      (명령어 차단 정책)
├── output-parser.test.ts
├── env-builder.test.ts
└── stdin-injector.test.ts
```

Shell 은 실제 프로세스(`echo hello`, `node -e "..."`) 로 E2E 테스트. HTTP 는 실제 외부 호출 불가 → **Mock HTTP 서버** 필요.

### 9.2 현재 Mock HTTP 인프라

레포 전체 검색 결과 MSW/nock/http.createServer 기반 mock 패턴 **없음**.

**권고: `http.createServer`(Node.js 내장) 사용**

```typescript
// __tests__/helpers/mock-server.ts (신규)
import { createServer, IncomingMessage, ServerResponse } from 'http';

export function startMockServer(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const server = createServer(handler);
  server.listen(0);  // 랜덤 포트
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://localhost:${port}`, close: () => server.close() };
}
```

이유: MSW/nock 추가 의존성 없음. Shell 테스트처럼 "실제 동작" 검증 원칙 유지.

### 9.3 목표 테스트 커버리지

| 시나리오 | 방법 |
|---------|------|
| GET → 200 + JSON 파싱 | mock server, JSON 응답 |
| POST + idempotencyKey → retry 2 | mock server, 500 x2 후 200 |
| 429 + `Retry-After: 1` → 1초 대기 후 재시도 | mock server, 429 응답 헤더 |
| 500 + GET(idempotent) → retry | mock server |
| 500 + POST(non-idempotent) → retry 0 | mock server |
| timeout → AbortSignal | mock server, 응답 지연 |
| allowedHosts 미매칭 → validate 거부 | 단위 테스트 (서버 불필요) |
| json/form/text/binary/multipart Content-Type | mock server, 요청 헤더 검사 |
| bodyJson 파싱 실패 → null (not throw) | mock server, 깨진 JSON |

---

## 10장. 예상 소요 시간 + 범위 재조정

### 10.1 Shell Adapter 캘리브레이션

| 파일 | 라인 수 |
|------|--------|
| `shell/index.ts` | 88 |
| `shell/spawner.ts` | 137 |
| `shell/policy.ts` | 27 |
| `shell/output-parser.ts` | 28 |
| `shell/env-builder.ts` | ~25 |
| `shell/stdin-injector.ts` | 29 |
| **소계 (소스)** | **~334** |
| 테스트 5파일 | ~538 |
| **총계** | **~872** |

Shell 실소요: **8.5h** (C7-2 기준)

### 10.2 HTTP Adapter 예상 복잡도

| 파일 | 예상 라인 | 비고 |
|------|----------|------|
| `http/index.ts` | 90-110 | shell/index.ts 대비 URL 파싱 + allowlist 추가 |
| `http/body-builder.ts` | 60-80 | 5-format 분기, multipart FormData |
| `http/retry.ts` | 60-80 | method별 기본값 + Retry-After 파싱 (신규) |
| `http/allowlist.ts` | 35-50 | host 패턴 매칭 (glob? exact?) |
| **소계 (소스)** | **245-320** | |
| `__tests__/helpers/mock-server.ts` | ~40 | 신규 test util |
| `__tests__/http.test.ts` | 200-250 | E2E + 주요 시나리오 |
| `__tests__/body-builder.test.ts` | 80-100 | 5 format 단위 |
| `__tests__/retry.test.ts` | 80-100 | method별 + Retry-After |
| `__tests__/allowlist.test.ts` | 40-60 | host 패턴 |
| **소계 (테스트)** | **440-550** | |
| **총계** | **685-870** | Shell 수준 |

### 10.3 예상 소요 시간

| 작업 | 시간 |
|------|------|
| body-builder.ts (5 format + multipart FormData) | 1.5h |
| retry.ts (method 기본값 + Retry-After + idempotencyKey) | 2.5h |
| allowlist.ts + loadProjectHttpPolicy stub | 1.0h |
| index.ts (main adapter, queryParams URL 인코딩 포함) | 1.5h |
| 테스트 (mock server 포함) | 2.5h |
| **합계** | **9.0h** |

→ 로드맵 v7 §4.3 C8-1 "2일" 예상과 일치. C7-2 (8.5h) 대비 **+0.5h** (Retry-After 신규 + mock server 구축).

### 10.4 예상 밖 복잡도 요인

1. **multipart 경계(boundary) 처리**: Node.js native `FormData`를 `fetch()`와 함께 쓸 때 Content-Type 헤더를 덮어쓰면 안 됨. body-builder에서 `headers.delete('content-type')` 필요 — 미검증 동작.

2. **Retry-After 날짜 형식**: HTTP 헤더의 `Retry-After`는 정수(초) 또는 HTTP-date 두 형식 가능. 날짜 파싱(`new Date(value)`) 브라우저/Node.js 간 일관성 주의.

3. **`loadProjectHttpPolicy()`**: allowlist 체크가 project-level 정책을 어디서 로드할지 미정. DB 조회? config 파일? → C8-1 범위에서 **인메모리 Map 또는 ExecutionContext 에서 주입** 방식으로 단순화 권고.

---

## 발견사항 요약 / 리스크

### 설계 대비 실제 불일치 (구현 주의)

| 설계 §5 표현 | 실제 스키마 | 처리 방향 |
|------------|-----------|---------|
| `spec.retry?.max` | `spec.retryPolicy?.maxAttempts` | 스키마 기준 구현 |
| `spec.headers?.['idempotency-key']` | `spec.idempotencyKey` | 스키마 기준 구현 |
| `spec.retry?.backoff?.baseMs` | `spec.retryPolicy?.initialDelay` (seconds) | 스키마 기준 구현 |
| `computeBackoff(attempt, response, spec)` 독립 함수 | Worker의 `calcBackoff()` 이미 존재 | Worker 기존 함수 활용, Retry-After 오버라이드만 추가 |

### 리스크

- **낮음**: `HttpNodeSpec` 스키마/타입 완전히 정의됨, C7-2 패턴 재사용 가능
- **중간**: Retry-After 신규 구현 + multipart FormData 경계 처리 미경험 영역
- **중간**: `loadProjectHttpPolicy()` 설계 미확정 → ExecutionContext 주입 방식으로 단순화 필요
- **없음**: 설계 §5.1 필드명 불일치 없음 (C7-2 shell/mode 사태 재발 없음)

### 구현 전 결정 필요 사항

1. **allowedHosts 정책 로드 방식**: DB 조회 vs `ExecutionContext` 주입 vs config 파일
2. **http.* 이벤트 추가 여부**: `events/types.ts` 에 `http.request` / `http.response` / `http.retry` 추가할지, 제네릭 이벤트만 사용할지
3. **Retry-After 최대 대기 상한**: 서버가 `Retry-After: 3600` 을 돌려주면 1시간 block — 상한 설정(예: 60초) 필요

---

*이상으로 C8-1 구현을 위한 10개 조사 항목 완료.*
