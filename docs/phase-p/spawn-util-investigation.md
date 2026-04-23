# spawn 공통 유틸 추출 조사

> 작성: 2026-04-23
> 목적: Stage 3 retro 이월 항목 — spawn + process group + SIGKILL 중복 3곳 공통화 실현 가능성 판단

---

## 1장. 중복 지점 목록 확인

### Stage 3 retro 에서 언급한 3곳

| # | 파일 | 패턴 | 실제 spawn 종류 |
|---|------|------|----------------|
| ① | `src/lib/adpl/engine/adapters/shell/spawner.ts` | `spawn + detached + killGroup + Buffer` | `child_process.spawn` |
| ② | `src/agents/verify/verify-agent.ts:915` | `spawn + detached + process.kill(-pid) + string` | `child_process.spawn` |
| ③ | `src/lib/worker-manager.ts:32` | `fork + IPC + restart` | `child_process.fork` |

### 판정: 실질 중복은 2곳

**worker-manager 제외 근거**:
- `child_process.fork` 는 `spawn` 의 특수형이나 **IPC 채널** + **Worker 프로세스 생명 주기 관리** 목적
- `detached: false`, SIGKILL 없음, process group 없음, timeout 없음
- 재시작 로직(`setTimeout(() => this.spawn(), 3000)`)이 핵심 — "CLI 실행 후 결과 수집" 패턴 아님
- 공통화해도 얻는 것 없음, 오히려 오용 위험 증가

**agent backends 추가 확인**:
- `claude-code.ts`, `codex-cli.ts`, `gemini-cli.ts`, `autodev.ts` 모두 직접 `spawn` 사용 안 함
- 상위 agent 클래스(`PlanningAgent`, `CodingAgentWrapper`, `ClaudeCodeAgent`) 에 위임
- 이들은 `src/lib/execa.ts` 래퍼 또는 SDK 사용 — spawner.ts 패턴 아님

**결론**: 공통화 대상 spawn 지점은 정확히 **2곳**.

---

## 2장. 각 사용처 시그니처 비교

### 2.1 spawner.ts (`runSpawn`)

```typescript
// src/lib/adpl/engine/adapters/shell/spawner.ts:38-48
const child = spawn(
  spec.command,
  isShellMode ? [] : (spec.args ?? []),
  {
    shell: isShellMode,      // shell 모드 지원
    cwd,                     // spec.cwd ?? ctx.worktreeRoot
    env: env as NodeJS.ProcessEnv,
    detached: true,
    stdio: 'pipe',
  },
) as ChildProcess;

const killGroup = () => {
  if (child.pid != null) {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { }
  }
  try { child.kill('SIGKILL'); } catch { }
};
```

### 2.2 verify-agent.ts (`runCliWithTimeout`)

```typescript
// src/agents/verify/verify-agent.ts:915-935
const child = spawn(cmd, args, {
  cwd: opts.cwd,
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],   // stdin ignore
  env: { ...process.env },
});

// ...
try { process.kill(-child.pid!, 'SIGKILL'); } catch {}
try { child.kill('SIGKILL'); } catch {}
```

### 2.3 차이점 표

| 항목 | spawner.ts | verify-agent.ts |
|------|-----------|-----------------|
| **command 형태** | `spec.command` + shell 모드 분기 | CLI 경로 + args 배열 직접 |
| **shell 옵션** | 있음 (`shell: isShellMode`) | 없음 |
| **cwd** | `spec.cwd ?? ctx.worktreeRoot` | `opts.cwd` |
| **env** | `env` 파라미터 (선별 주입) | `{ ...process.env }` (전체) |
| **stdin** | Buffer 주입 지원 (`injectStdin`) | `'ignore'` (없음) |
| **stdout 수집** | `Buffer[]` 청크 누적 + EventBus emit | `string` 단순 누적 |
| **stderr 수집** | `Buffer[]` 청크 누적 + EventBus emit | `string` 으로 stdout 에 합침 |
| **출력 한도** | `MAX_OUTPUT_BYTES` truncation 적용 | 없음 |
| **timeout** | `setTimeout(killGroup, timeoutMs)` | `setTimeout(killGroup, opts.timeoutMs)` |
| **CancellationToken** | 있음 (`onCancel(killGroup)`) | 없음 |
| **timedOut 플래그** | 반환 (`SpawnResult.timedOut`) | 반환 (`{ timedOut }`) |
| **outputTruncated 플래그** | 있음 | 없음 |
| **exit code 반환** | 있음 (`exitCode: code ?? ...`) | 없음 (close 이벤트만) |
| **killGroup 패턴** | `process.kill(-pid)` + `child.kill('SIGKILL')` | 동일 |

### 2.4 공통화 가능한 부분

- `spawn(cmd, args, { detached: true, ... })` 기본 설정
- `killGroup()` 패턴: `process.kill(-pid, 'SIGKILL')` + `child.kill('SIGKILL')` (완전 동일)
- `setTimeout(killGroup, timeoutMs)` + `clearTimeout` on finish (거의 동일)
- `child.on('close', ...)` + `child.on('error', ...)` 종료 처리

### 2.5 공통화 불가/불권장 부분

- **EventBus 스트리밍** (`shell.output` 이벤트): spawner.ts 전용 기능, verify-agent에 주입 불가
- **stdin 주입** (`injectStdin`): spawner.ts 전용
- **CancellationToken**: spawner.ts 전용, verify-agent는 timeout만 사용
- **shell 모드 분기**: spawner.ts 전용 (`shell: isShellMode`)
- **출력 한도 truncation**: spawner.ts 전용 비즈니스 규칙

---

## 3장. 공통화되는 부분

### 반복 코드

#### killGroup 패턴 (완전 동일)

```typescript
// spawner.ts:50-55 와 verify-agent.ts:929-931 이 동일
const killGroup = () => {
  if (child.pid != null) {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { }
  }
  try { child.kill('SIGKILL'); } catch { }
};
```

#### timeout + clearTimeout 패턴 (거의 동일)

```typescript
// 두 곳 모두
const timer = setTimeout(() => {
  timedOut = true;
  killGroup();
}, timeoutMs);
// ... child.on('close', () => clearTimeout(timer))
```

#### close/error 핸들러 기본 구조

```typescript
// 두 곳 모두
child.on('close', (code) => { clearTimeout(timer); resolve(...) });
child.on('error', () => { clearTimeout(timer); resolve(...) });
```

### 공통화하면 안 되는 부분

- **EventBus 스트리밍**: ADPL 엔진 전용 인프라, verify-agent에 주입하면 레이어 위반
- **CancellationToken**: ADPL 엔진 전용 취소 추상화, verify-agent는 이 의존성 없어야 함
- **stdout 수집 방식 강제**: spawner는 Buffer+한도, verify-agent는 string 합산 — 두 요구사항이 다름

---

## 4장. 인터페이스 디자인 제안

### 아이디어 1: 함수형 (추천)

```typescript
// src/lib/process/spawn-util.ts

export interface SpawnWithKillGroupOptions {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: Buffer | null;
  timeoutMs?: number;
  /** stdout 청크 수신 콜백 (스트리밍 필요 시) */
  onStdout?: (chunk: Buffer) => void;
  /** stderr 청크 수신 콜백 (스트리밍 필요 시) */
  onStderr?: (chunk: Buffer) => void;
  /** shell 모드로 실행 (sh -c) */
  shell?: boolean;
}

export interface SpawnWithKillGroupResult {
  stdout: Buffer;
  stderr: Buffer;
  exitCode: number;
  timedOut: boolean;
}

export async function spawnWithKillGroup(
  opts: SpawnWithKillGroupOptions,
): Promise<SpawnWithKillGroupResult>;
```

**spawner.ts 사용 예**:
```typescript
const result = await spawnWithKillGroup({
  command: spec.command,
  args: isShellMode ? [] : (spec.args ?? []),
  cwd, env, input: stdin, timeoutMs,
  shell: isShellMode,
  onStdout: (chunk) => eventBus.emit({ type: 'shell.output', stream: 'stdout', chunk: ... }),
  onStderr: (chunk) => eventBus.emit({ type: 'shell.output', stream: 'stderr', chunk: ... }),
});
```

**verify-agent.ts 사용 예**:
```typescript
const { stdout, timedOut } = await spawnWithKillGroup({
  command: cmd,
  args,
  cwd: opts.cwd,
  env: process.env as NodeJS.ProcessEnv,
  timeoutMs: opts.timeoutMs,
});
return { stdout: stdout.toString(), timedOut };
```

### 아이디어 2: SpawnRunner 클래스

```typescript
const runner = new SpawnRunner({ command, args, cwd, env });
runner.onStdout = (chunk) => ...;
const result = await runner.run(timeoutMs);
```

- 더 유연하지만 불필요하게 복잡
- 일회성 실행에 클래스 인스턴스 생성은 과잉

### 아이디어 3: Builder 패턴

```typescript
await spawn(cmd)
  .args(args)
  .cwd(cwd)
  .timeout(ms)
  .onStdout(cb)
  .run();
```

- API 오용 가능성 낮음 (빌더 체인)
- 현재 2곳만 사용하는 유틸에 과잉 설계

### 1순위 추천: **아이디어 1 (함수형)**

이유:
- 두 사용처가 요구하는 모든 차이점(`onStdout`, `shell`)을 옵션으로 흡수
- CancellationToken은 함수 외부에서 `onCancel(() => killGroup())` 으로 연결 — 유틸 내부에 의존 안 함
- TypeScript 오버로드 없이 단일 시그니처로 처리 가능
- 클래스/빌더보다 테스트 쉬움 (순수 함수 형태)
- MAX_OUTPUT_BYTES 같은 비즈니스 규칙은 호출자(spawner.ts)가 `onStdout` 안에서 처리 → 유틸은 단순 유지

---

## 5장. 마이그레이션 난이도

### 테스트 커버리지 현황

| 지점 | 테스트 파일 | 커버리지 | 방식 |
|------|------------|---------|------|
| **spawner.ts** (`runSpawn`) | `shell/__tests__/shell.test.ts` | **간접** | `shellAdapter.execute()` 통해 실제 프로세스 실행. `runSpawn` 직접 테스트 없음 |
| **verify-agent.ts** (`runCliWithTimeout`) | ❌ 없음 | **0%** | `src/agents/verify/__tests__/` 디렉토리 없음 |
| **worker-manager.ts** (`spawn`) | 미확인 (fork 패턴, 공통화 대상 아님) | — | — |

### 리팩토링 위험도

| 지점 | 위험도 | 이유 |
|------|--------|------|
| **spawner.ts** | 중간 | shell adapter 통합 테스트(실제 프로세스 실행)로 회귀 감지 가능. 단, `runSpawn` 단위 테스트 없어서 edge case 놓칠 수 있음 |
| **verify-agent.ts** | **높음** | `runCliWithTimeout` 테스트 전혀 없음. 리팩토링 후 기능 검증 불가. CLI 실제 호출 테스트도 없음 |

### 결론

- verify-agent.ts 는 리팩토링 전 **테스트 추가가 선행 조건**
- spawner.ts 는 간접 커버리지 있으나 `runSpawn` 단위 테스트 추가 권장
- 두 조건 미충족 시 옵션 A(전환 모두) 는 실질적 위험

---

## 6장. 작업 범위 제안

### 옵션 A: 전환 모두

- 공통 유틸 신규 (`src/lib/process/spawn-util.ts`)
- spawner.ts + verify-agent.ts 모두 유틸로 전환
- 테스트 추가 (spawn-util.ts 단위 테스트)
- 예상: 2-3h
- **위험**: verify-agent.ts 테스트 없음 → 리팩토링 후 회귀 감지 불가

### 옵션 B: 유틸 신규 + 새 코드에만 적용

- 공통 유틸 신규 + 단위 테스트
- **기존 spawner.ts / verify-agent.ts 는 수정하지 않음**
- 앞으로 새로 추가되는 spawn 코드에 유틸 사용 강제
- 예상: 1h

### 옵션 C: 부분 전환 (spawner.ts만)

- 공통 유틸 신규 + 단위 테스트
- spawner.ts 만 유틸로 전환 (shell adapter 통합 테스트가 안전망)
- verify-agent.ts 는 테스트 확보 후 별도 작업
- 예상: 1.5h

---

## 마지막 섹션 — 구현 전 판단 필요 사항

### 추천: **옵션 C** (부분 전환 — spawner.ts 만)

**근거**:

1. **verify-agent.ts 는 현재 테스트 없음** — 리팩토링은 테스트가 안전망 역할을 해야 함. 테스트 없이 `runCliWithTimeout` 을 건드리면 Verify Agent 전체 기능 회귀 가능성
2. **spawner.ts 는 shell adapter 통합 테스트가 안전망** — 실제 프로세스(`echo hello`, `node -e "process.exit(1)"` 등)를 실행하는 테스트가 있어 공통 유틸로 전환해도 동작 검증 가능
3. **옵션 B(신규만)보다 C가 더 가치 있음** — 공통 유틸을 실제로 써보는 검증이 됨. spawner.ts 전환으로 API 설계 검증 후 verify-agent.ts 전환 결정
4. **옵션 A(전환 모두)는 현재 불가** — verify-agent 테스트 없는 상황에서 과감한 전환 = verify:cross 위험

### 인터페이스 디자인

**아이디어 1 (함수형)** — `spawnWithKillGroup(opts)` 형태.

- `onStdout`/`onStderr` 콜백으로 스트리밍 vs 버퍼링 차이 흡수
- CancellationToken 은 호출자 책임 (유틸 내부에 ADPL 의존 없음)
- MAX_OUTPUT_BYTES truncation 은 spawner.ts 의 `onStdout` 에서 처리 → 유틸은 단순 유지

### stdout 스트림 vs 버퍼링 해소 방법

- `onStdout(chunk: Buffer)` 콜백 제공
- spawner.ts: 콜백에서 EventBus emit + Buffer 누적
- verify-agent.ts: 콜백 없이 사용 → 반환된 `result.stdout.toString()` 으로 문자열 변환
- 두 요구사항이 하나의 API 로 자연스럽게 처리됨

### 테스트 충분성 판단

| 단계 | 필요 테스트 |
|------|------------|
| 공통 유틸 신규 | `spawn-util.test.ts`: echo, exit code, timeout+SIGKILL, onStdout 콜백 4-5개 |
| spawner.ts 전환 | 기존 `shell.test.ts` 가 안전망 (추가 테스트 불필요) |
| verify-agent.ts 전환 (나중에) | `runCliWithTimeout` 단위 테스트 추가 후 진행 |

### 작업 순서 (옵션 C 기준)

1. `src/lib/process/spawn-util.ts` 신규 + `spawn-util.test.ts` 4-5개 테스트
2. `spawner.ts` 의 `runSpawn` 을 `spawnWithKillGroup` 으로 교체 (killGroup + timeout 코드 제거)
3. `pnpm test` 전수 통과 확인
4. `pnpm ship` (verify:cross A등급 확인)
5. verify-agent.ts 전환은 별도 PR — 테스트 추가 후 진행

**예상 소요**: 1-1.5h
