# Phase P 설계 문서 업데이트 필요 사항

작성: 2026-04-20 (Stage 1 A2-4 회고)
상태: **설계 문서 소스가 프로젝트 외부에 있어 여기에 반영 권고사항 기록**

Stage 1 구현 중 발견된 설계-코드 불일치 6건.
설계 문서 소유자가 아래 내용을 반영해야 함.

---

## 업데이트 대상 파일

1. `14_PhaseP_design3_data_model.md`
2. `26_PhaseP_design5_migration.md`
3. `16_PhaseP_design4b1_agent_node.md`
4. `17_PhaseP_design4b2_flow_control.md`

---

## 블로커 #1: projects 테이블 (설계 3)

**대상**: `14_PhaseP_design3_data_model.md` §2  
**구현 근거**: A1-2 commit `f4b25b2`

### 문제

설계 3 에서 projects 테이블이 정의되지 않았음.
기존 AutoDev 는 `tasks.project_dir` (free text path) 만 사용하여 독립적인
projects 테이블이 없었음. Stage 1 A1-2 에서 신규 생성 필요를 확인하고 추가.

### 반영 내용

`§2` 에 다음 테이블 정의 추가:

```markdown
### 2.X projects 테이블 (신규 — A1-2 에서 추가됨)

Phase P 의 project 개념. 기존 AutoDev 는 tasks.project_dir (free text path)
만 사용하여 projects 테이블이 없었음. Stage 1 A1-2 에서 신규 생성.

\`\`\`typescript
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  path: text('path').notNull(),          // tasks.project_dir 와 매핑
  description: text('description'),
  icon: text('icon'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => ({
  pathIdx: index('projects_path_idx').on(t.path),
  nameIdx: index('projects_name_idx').on(t.name),
}));
\`\`\`

**데이터 마이그레이션**: 기존 tasks.project_dir 는 그대로 유지.
Stage 3 Facade 도입 시 점진적으로 projects 테이블로 이전.
```

---

## 블로커 #2: 타임스탬프 컨벤션 (설계 3)

**대상**: `14_PhaseP_design3_data_model.md` §2 시작 부분  
**구현 근거**: A1-2 commit `f4b25b2`

### 문제

설계 초안에서 일부 컬럼이 `integer('...', { mode: 'timestamp' })` 로 정의됨.
기존 AutoDev 스키마 (`tasks`, `attempts`, `events`) 는 모두 `text ISO 8601` 사용.
불일치 발견 → text 로 통일.

### 반영 내용

`§2` 상단에 컨벤션 섹션 추가:

```markdown
### 2.0 타임스탬프 컨벤션 (중요)

Phase P 의 모든 타임스탬프 컬럼은 **text ISO 8601 string** 사용.
기존 AutoDev 스키마 컨벤션 따름.

\`\`\`typescript
// ✅ 올바름
createdAt: text('created_at').notNull(),  // "2026-04-19T13:45:06.123Z"

// ❌ 사용 금지 (스펙 초안 실수)
createdAt: integer('created_at', { mode: 'timestamp' }),
\`\`\`

**근거**:
- 기존 tasks/attempts/events 테이블이 text ISO 로 통일
- SQLite 에서 text 비교 가능 (ISO 8601 는 사전식 정렬 = 시간순)
- Drizzle `mode: 'timestamp'` 은 integer 저장 → 기존과 불일치

모든 §2.X 테이블 정의의 timestamp 필드는 text 사용.
```

또한 §2.X 테이블 정의 전체에서 `integer('...', { mode: 'timestamp' })` 를
`text('...')` 로 일괄 변경.

---

## 블로커 #3: pipeline_mode 컬럼명 (설계 5)

**대상**: `26_PhaseP_design5_migration.md` §2.3, §5.1  
**구현 근거**: A1-3 commit `33e78f9`

### 문제

설계 5 초안에서 `executionMode` 컬럼을 Phase P 파이프라인 세대 구분용으로 사용하려 했음.
그러나 기존 AutoDev `tasks.executionMode` 가 이미 존재하여 의미가 다름 (실행 방식 구분).
컬럼명 충돌 발견 → `pipelineMode` 로 분리.

### 반영 내용

파일 전체에서 `executionMode` → `pipelineMode` 교체 (Phase P 파이프라인 세대 언급 맥락만):

```diff
- task.executionMode === 'phase-p'
+ task.pipelineMode === 'phase-p'
```

그리고 혼동 방지를 위한 설명 추가:

```markdown
### 주의: executionMode vs pipelineMode

기존 AutoDev `tasks.executionMode` 는 Task 실행 방식
(single/auto-cycle/interview/arena) 을 나타내는 별도 축.

Phase P 는 **별도 컬럼** `tasks.pipelineMode` (legacy/phase-p) 추가.
두 축은 독립적:
- executionMode: 어떻게 실행하는가 (single, auto-cycle 등)
- pipelineMode:  어떤 파이프라인 세대인가 (legacy, phase-p)

A1-3 에서 컬럼명 충돌 발견 → pipelineMode 로 분리.
```

---

## 블로커 #4: agent role 기본값 (설계 4B1)

**대상**: `16_PhaseP_design4b1_agent_node.md` §2 또는 §3  
**구현 근거**: A1-4b-fix commit `5a21412`

### 문제

설계 초안에서 `role` 기본값이 `'custom'` 으로 정의됨.
그러나 `custom` role 은 `prompt` 필드를 필수로 요구함 (§5).
기본값만으로는 valid pipeline 을 만들 수 없는 상태.
실제 AutoDev 주 사용 패턴인 `'planner'` 가 기본값으로 적절.

### 반영 내용

```diff
- role: text('role').default('custom'),
+ role: text('role').default('planner'),
```

설명 추가:

```markdown
### role 기본값: planner

`role` 필드의 기본값은 **'planner'**.

근거:
- Legacy AutoDev 의 주 사용 패턴은 Plan → Code → Verify
- 'planner' 가 가장 흔한 첫 노드
- 'custom' 을 기본값으로 하면 `prompt` 필수 (§5) 라서 기본값만으로 invalid

`custom` role 은 명시적으로 선택하는 특수 케이스.
그때는 `prompt` 필드도 반드시 함께 제공.
```

---

## 블로커 #5: $loop.<as> 접근 표기 (설계 4B2 §4)

**대상**: `17_PhaseP_design4b2_flow_control.md` §4  
**구현 근거**: A1-4c-fix commit `91aba9f`

### 문제

설계 초안에서 loop `as` 변수의 접근 표기가 불명확함.
`${issue.title}` 처럼 직접 참조하는 것처럼 읽힐 여지가 있었음.
실제 구현에서는 `$loop` 네임스페이스를 통해서만 접근 가능.

### 반영 내용

§4 에 명시적 소절 추가:

```markdown
### 4.X loop iteration 변수 접근

forEach 모드에서 `as: <name>` 으로 지정한 iteration 변수는
**반드시 `$loop.<name>` 로 접근**. 직접 `${<name>}` 사용 불가.

예시:
\`\`\`yaml
- id: issue-loop
  type: loop
  mode: forEach
  over: "${$nodes.verify.output.data.issues}"
  as: issue
  do:
    - type: mcp
      args:
        title: "${$loop.issue.title}"     # ✅
        # title: "${issue.title}"        # ❌ 에러: issue 직접 참조 불가
\`\`\`

`$loop` 네임스페이스에 추가로 제공:
- `$loop.index`   (0-based)
- `$loop.total`
- `$loop.isFirst`
- `$loop.isLast`
```

---

## 블로커 #6: while 의미론 (설계 4B2 §4)

**대상**: `17_PhaseP_design4b2_flow_control.md` §4  
**구현 근거**: A1-4c-fix commit `91aba9f`

### 문제

설계 초안에서 `while` 모드의 실행 순서가 명시되지 않음.
표준 programming 의 while (pre-test) 과 헷갈릴 수 있음.
ADPL 의 `while` 은 do 먼저 실행 후 condition 평가 (post-test/do-while).
구현 완료 후 의미론 확정.

### 반영 내용

§4 에 명시적 소절 추가:

```markdown
### 4.Y while 모드의 의미론 (중요)

ADPL 의 `while` 은 **post-test 동작** (do-while 과 동일).
표준 programming 의 while (pre-test) 과 다름.

실행 순서:
1. `do` 배열의 노드가 **먼저 실행** (첫 iteration)
2. iteration 완료 후 `condition` 평가
3. `condition` true 면 다음 iteration (maxIterations 도달 전까지)
4. false 면 loop 종료

이 동작의 이점:
- condition 이 do 내부 노드 출력을 참조하는 경우 (polling, retry 등)
  자연스럽게 지원 — 첫 평가 시 참조할 값이 없는 문제 자동 해결
- 최소 1회 실행 보장

\`\`\`yaml
- id: wait-for-deploy
  type: loop
  mode: while
  condition: "$nodes.status-check.output.data.ready == false"
  maxIterations: 20
  do:
    - id: status-check
      type: http
      url: "${$env.DEPLOY_STATUS_URL}"
\`\`\`

> ⚠️  표준 `while` (pre-test, 0회 실행 가능) 이 필요하면
> 체크 노드 + `branch` 분기로 구현.
```

---

## 구현 근거 (감사 추적)

| 블로커 | 발견 commit | 내용 |
|:---:|---|---|
| #1, #2 | A1-2 `f4b25b2` | projects 테이블 신규 생성, 타임스탬프 text ISO 통일 |
| #3 | A1-3 `33e78f9` | executionMode 충돌 → pipelineMode 분리 |
| #4 | A1-4b-fix `5a21412` | agent role 기본값 custom → planner |
| #5, #6 | A1-4c-fix `91aba9f` | $loop 접근 표기 및 while post-test 의미론 확정 |

---

*이 파일은 Stage 1 A2-4 에서 작성됨. 설계 소스 소유자가 위 내용을 반영 후 삭제 또는 완료 표시.*
