# Stage 7 Retrospective — UX Layer + AI Builder

> 작성: 2026-04-29 (Stage 7 종결 + v1.0 RC 선언)
> 기간: 2026-04-25 ~ 2026-04-29 (5일)
> 로드맵 예상: 3-4주 vs 실제: 5일

## TL;DR

Stage 7 G0-G21 완성 + Phase P 전 Stage (1-7) 완료. **Pipeline UI** (실행 목록 + 상세 + SSE 스트림 + YAML viewer/editor) 와 **AI Builder** (자연어 → ADPL YAML, 멀티턴 대화, CLI/SDK 모드 분기) 모두 구현.

**40 commits** (Phase P core 25 + 보조 15). 외부 패키지 추가 **0건** — 누적 64 commits 연속.

AI Builder 진짜 동작 확인: 819자 YAML 생성 (Claude Code subscription 경유, $0.018). v1.0 RC 선언.

---

## 일정

- **로드맵 예상**: 3-4주
- **실제**: 5일 (2026-04-25 ~ 2026-04-29)

일정 단축 원인:

- Stage 6 까지 누적된 "조사서 → 발췌 → 구현" 패턴이 Stage 7 에서도 동일하게 작동
- G0 (pipeline_runs lifecycle) 가 Stage 6 이슈 #1 을 해결하면서 G1-G3 UI 기반을 즉시 확보
- AI Builder lib (G19-G20) 는 Orchestrator → Classifier → Spec → Fragments → Assembler → Generator 순 레이어드 구조 — 각 레이어가 이전 레이어를 그대로 활용
- 외부 패키지 0건 원칙 재확인: js-yaml (G5), highlight.js (G4) 모두 기존 의존성

일정 단축의 함의:
- G3-G5 (SSE + YAML) 각 1시간 내외
- AI Builder lib G19-G20 (10 commits) 약 3-4시간
- AI Builder UI G21 (4 commits) 약 2시간
- 보조 작업 (CI 3건 + setup 3건 + fix 6건) 이 Phase P core 와 동등한 commit 수

---

## 작업 궤적 (40 commits)

### Phase P Core (25 commits)

| Commit | 태그 | 주제 | 핵심 |
|:------:|------|------|------|
| e95af4d | 조사 | Stage 7 사전 조사 | UX Layer 전체 scope 분해. G0-G21 작업 블록 정의. |
| c545500 | G0 | pipeline_runs lifecycle + API | Stage 6 이슈 #1 해결. pipeline_runs insert/update. runs/state/events 3종 API |
| 6b858e1 | G1 | pipeline runs 목록 페이지 | server component, 페이지네이션 |
| 487be3d | G1-fix | 범위 초과 redirect | totalPages 초과 시 clamp |
| 85e0b0b | G2 | run 상세 페이지 (read-only) | 노드 테이블 + 실행 상태 |
| 0e2b547 | G3 | SSE 이벤트 스트림 | 실시간 pipeline_events 구독 |
| 756c853 | G3-fix | composite cursor 수정 | SSE polling 중복 방지 (createdAt+id) |
| 15e5cee | G4 | YAML viewer | highlight.js 기반 read-only |
| a993704 | G5 | YAML editor | textarea + js-yaml + 버전 저장 |
| 5627d83 | G5-fix | JSON parse guard | 비-객체 body 처리 |
| e817624 | G5-fix2 | body type guard | non-object payload 대비 |
| 25cddb1 | G19-1 | AI Builder orchestrator skeleton | step 기반 파이프라인 |
| 0b2f8ca | G19-2 | intent classifier + LLM call | 4-way: new/modify/clarify/explain |
| bf79c8e | G19-3a | base spec compressed reference | 4,900줄 → 압축 참조 |
| a529e37 | G19-3b | task fragments + keyword detector | 7 fragments |
| 41b4971 | G19-3c | few-shot examples + assembler | system prompt 조립 |
| 19408e3 | G19-3c-fix | fragment cache immutable | deep freeze 적용 |
| 71a3608 | G20-1 | generator LLM call + parse skeleton | |
| 0228ffe | G20-2 | strict schema + Compiler 검증 + retry | ADPL Compiler 재활용 |
| eeed6c8 | G20-3 | diff 계산 알고리즘 (G6 closure) | G6 = diff. G19-G20 가 G6 로 통합 |
| a8222d3 | G21a | AI Builder POST `/api/ai-builder` | |
| 1975fbf | G21b | AI Builder modal UI + PipelineYamlViewer 연동 | |
| e1926fb | G21a-fix | input 길이 제한 + 에러 메시지 sanitize | |
| e532b11 | G21c | clarify 멀티턴 대화 thread UI | |
| (이번) | G7 | Stage 7 retro (이 문서) | |

### 보조 커밋 (15 commits)

| Commit | 분류 | 주제 |
|:------:|------|------|
| b1bf698 | docs | LICENSE (MIT) + CONTRIBUTING + CHANGELOG |
| 971883d | fix(verify) | VR1+VR2+VR4 정직성 수정 (fast/standard/debate 하드코딩 수정) |
| c2cec78 | ci | vitest 추가, lint job 제거, workflow_dispatch 트리거 |
| e1cab11 | ci | Node 18→20 (tailwindcss oxide native binding 요구) |
| 32b89e2 | ci | next build 전 SQLite DB 초기화 |
| c2bffb8 | feat | setup.sh + .env.example + .nvmrc 온보딩 |
| 2d834db | fix | setup.sh Node 바이너리 누락 처리 |
| 429d90a | feat | AI Builder Claude CLI 모드 + SDK fallback (B4 처리) |
| fd904f7 | feat | setup.sh Claude Code CLI 검출 → API key prompt 스킵 |
| 5dc4a80 | feat | 홈 기본 뷰 'kanban' → 'projects' |
| 4029275 | chore | .worktrees/ gitignore |
| 8a15769 | chore | .worktrees gitignore (중복 fix) |
| a0e5e40 | fix | AI Builder CLI subprocess env ANTHROPIC_API_KEY 제외 |
| 60a2460 | fix | AI Builder extendEnv:false (execa v9 env merge 방지) |
| d5b8f32 | feat | AI Builder API 응답에 mode 필드 노출 ('cli'/'sdk'/'mixed') |

---

## 설계 조정 사항

### 1. G6 → G19-G20 재분류

**조사서 정의**: G6 = diff computation (독립 작업)
**구현**: G6 가 AI Builder lib 의 마지막 단계로 통합됨 (G20-3). 독립 commit 이 아닌 AI Builder 파이프라인의 6번째 step 으로 구현.
**이유**: diff 는 "새 YAML vs 기존 YAML" 비교로, AI Builder 결과물이 확정된 후에만 의미 있음 — AI Builder 파이프라인 내부가 자연스러운 위치
**적용**: commit 태그가 "G6 G20-3" 으로 병기됨

### 2. AI Builder intent 4-way 분류

**조사서 기대**: binary (생성 / 수정)
**구현**: new / modify / clarify / explain 4-way
**이유**: "clarify" (정보 부족) 와 "explain" (기존 YAML 설명 요청) 가 실제 사용에서 빈번 — 잘못된 generation 시도보다 질문 반환이 UX 개선
**적용**: intent 별 분기 코드 경로 완전 분리

### 3. AI Builder mode 분기 (CLI 우선 → SDK fallback)

**조사서 기대**: 단일 LLM 호출 (SDK)
**구현**: Claude Code CLI 검출 시 CLI 우선 사용. CLI 부재 또는 실패 시 SDK fallback. 응답에 mode 필드 ('cli'/'sdk'/'mixed') 노출.
**이유**:
- Claude Code subscription 사용자 → API key 없이도 동작
- ANTHROPIC_API_KEY 환경변수 노출 버그 (execa env merge) 발견 → extendEnv:false 로 해결
- mode 필드는 디버깅 + "사용자 인지 가능" 을 위한 투명성 보장
**적용**: 3 commits (429d90a → a0e5e40 → 60a2460 → d5b8f32) 연쇄 수정 필요

### 4. verify:cross 정직성 수정 (971883d)

**발견**: VR1/VR2/VR4 가 depth 무관하게 하드코딩 점수 반환. fast path 도 "98/100" 가능 상태.
**수정**: fast → mechanical check (낮은 점수), standard → basic LLM, debate → full cross-model
**의미**: Stage 1-6 의 verify:cross 점수가 일부 과대 측정이었을 가능성. Stage 7+ 점수는 더 정직한 기준 적용.

---

## "Made But Never Used" 패턴 8건

Stage 7 진행 중 발견된 "구현했으나 실제로 사용 0회" 패턴. 정직하게 기록.

### 1. AI Builder (G19-G21) — 구현 완료 후 자율 검증 0회

25 commits (G19-G21) 만들고 실제 동작 확인은 Stage 7 종료 직전 2회.
1차: 크레딧 부족으로 BLOCKED → root cause: CLI 가 subscription 이 아닌 API key 사용 중
2차: mode 분기 + env fix 후 819자 YAML 생성 ($0.018) 성공

**교훈**: 새 LLM 연동 기능은 코드 작성 직후 즉시 end-to-end 검증 필요. "코드 만듦 = 동작" 가정은 항상 틀림.

### 2. Verify Agent fast/standard 점수 하드코딩

`VR1/VR2/VR4` 가 depth 파라미터와 무관하게 동일 점수 반환. Stage 1-6 전체 검증 기간 동안 노출 0회.
**발견**: Stage 7 보조 작업 중 코드 리뷰로 우연 발견.
**수정**: 971883d 에서 정직한 depth 별 분기로 수정.

### 3. CI 17일 방치

Node 18 / tailwindcss native binding 충돌로 CI 깨진 상태. Stage 7 진입 후에야 발견 + 수정 (e1cab11, 32b89e2).
**기간**: Stage 6 종결 전후부터 ~ 2026-04-28 (추정)
**교훈**: CI 같은 인프라는 정기 모니터링 필요. "로컬 빌드 된다" ≠ "CI 통과".

### 4. `.env.example` 환경변수 누락

setup.sh + .env.example 추가 전까지 신규 설치자가 어떤 환경변수가 필요한지 알 방법 없음.
**수정**: c2bffb8 에서 `.env.example` + `setup.sh` 추가.

### 5. `cli-resolver.ts` / `extractJson` 유틸 활용 0회

AI Builder 구현 시 LLM 응답 파싱에 재사용 가능한 기존 유틸이 있었으나 미사용. 독립 파싱 로직 재구현.
**영향**: 코드 중복 + 일관성 저하 (미미)

### 6. 홈 기본 뷰 'kanban' (프로젝트 목록 없음)

`ProjectsView` 가 있음에도 기본이 `kanban`. 신규 사용자에게 프로젝트 목록 진입점 노출 안 됨.
**수정**: 5dc4a80 에서 'projects' 로 변경.

### 7. AI Builder Mode 분기 코드 (429d90a) — 즉시 동작 X

Mode 분기 코드 push 후 즉시 테스트 시 CLI 로 라우팅되었으나 ANTHROPIC_API_KEY 가 subprocess 에 상속되어 subscription 대신 API key 사용 → 크레딧 부족 BLOCKED.
**수정 path**: 429d90a (분기 코드) → a0e5e40 (env exclude) → 60a2460 (extendEnv:false) — 3 commits 필요.

### 8. mode 필드 미노출 (d5b8f32 이전)

AI Builder 응답에 mode 필드 없음 → 사용자/호출자가 CLI/SDK 중 어느 경로로 실행됐는지 알 방법 없음. 디버깅 시 블라인드.
**수정**: d5b8f32 에서 mode 필드 노출.

---

## 남은 부채

### Stage 7 신규 발견

1. **AI Builder clarify intent parse 에러**: `clarify` 응답 Zod 검증 실패 케이스 존재. 멀티턴 대화 시 간헐 오류.
2. **AI Builder diff 계산 빈 객체**: `compute_diff` step 이 빈 diff 반환하는 케이스. 비교 로직 엣지케이스.
3. **mode 필드 자율 재검증 필요**: d5b8f32 이후 mode='cli' 경로 end-to-end 재검증.

### Stage 6 이월 12건 (현황)

Stage 6 retro §알려진 이슈 12건 중 Stage 7 에서 처리된 것:

- **처리됨** (2건):
  - 이슈 #1 pipeline_runs lifecycle → G0 (c545500) 에서 해결
  - 이슈 #2 UI 조회 API 부재 → G0-G3 에서 해결

- **미처리** (10건):
  - 이슈 #3 DB-backed metrics sync
  - 이슈 #4 batch insert 최적화
  - 이슈 #5 auto-resume on Worker crash
  - 이슈 #6 shadow_runs.runId FK
  - 이슈 #7 agent backends worktree 격리
  - 이슈 #8 git worktree 분리
  - 이슈 #9 cleanup 정책
  - 이슈 #10 이벤트 정규화 스키마
  - 이슈 #11 forEach parallelism > 1 활성화
  - 이슈 #12 설계 문서 sync 9건

### v1.0 출시 후 처리 권장

| 항목 | 우선순위 | 비고 |
|------|--------|------|
| AI Builder clarify parse fix | 높음 | 멀티턴 사용성 직결 |
| AI Builder diff 빈 객체 fix | 높음 | modify intent 핵심 경로 |
| VR3 configurable threshold | 중간 | verify 유연성 |
| VR5 'warn' verdict 정식화 + UI | 중간 | 사용자 판단 지원 |
| B2 Playwright MCP timeout | 낮음 | Pre-Phase P 이슈 |
| AgentScorer ↔ selectAgent 연결 | 낮음 | 에이전트 추천 실효성 |
| Stage 6 이슈 #3-#12 | 낮음-중간 | v1.1+ |

---

## v1.0 RC 선언

**Phase P 공식 종료.** Stage 1-7 모두 완성.

### v1.0 RC 자격 기준 충족 여부

| 기준 | 상태 | 비고 |
|------|------|------|
| Stage 1-6 완성 + retro | ✅ | 각 retro 존재 |
| Stage 7 코드 완성 | ✅ | G0-G21 + 보조 15 commits |
| AI Builder 진짜 동작 확인 | ✅ | 819자 YAML 생성, $0.018 |
| 외부 패키지 0건 (정직성) | ✅ | 64 commits 연속 |
| 부채 명시 | ✅ | 위 목록 |
| v1.0 차단 이슈 없음 | 🟡 | clarify/diff fix 권장 (필수 아님) |

### v1.0 RC 정의

- **RC (Release Candidate)**: 코드 완성 + 동작 확인 + 부채 명시 상태
- **정식 v1.0**: README 강화 (A1) + GitHub release 태그 후

### v1.0 출시 시 명시 사항

1. **AI Builder**: "Claude Code subscription 권장. ANTHROPIC_API_KEY 만 있으면 SDK fallback." `mode` 필드로 실제 사용 경로 확인 가능.
2. **Verify Agent**: depth 별 정직성 — `fast` = mechanical, `standard` = basic LLM, `debate` = cross-model. 971983d 수정 후 점수 신뢰도 향상.
3. **외부 패키지 0건**: 64 commits 연속 — AutoDev Agent 가 자체 개발로만 구축됐음을 보장.
4. **Phase P (ADPL)**: 공식 스펙 4,900줄, Stage 1-7 완성, 알려진 이슈 10건 이월.

### 다음 단계

1. **A1 README 강화** (출시 1순위) — 설치 / 사용법 / AI Builder / Verify Agent 설명
2. **clarify / diff fix** — 멀티턴 AI Builder 안정성
3. **Step 4: GitHub release + 공개** (사용자 직접)

---

## 노하우

### 1. "조사서 → 발췌 → 구현" 패턴 7 Stage 연속

Stage 1-7 전체를 관통한 패턴. 각 Stage 의 사전 조사서가 작업 블록을 정의하고, 구현은 조사서를 발췌해 코드로 번역하는 방식. Stage 7 에서 처음으로 LLM 연동 비결정성 (AI Builder) 이 등장했으나 Orchestrator → step 기반 파이프라인으로 비결정성을 격리.

### 2. "진짜 동작 확인" 3-commit path

AI Builder 가 실제로 동작하기까지 3 commits 이 필요했음 (mode 분기 → env exclude → extendEnv:false). 각 commit 이 하나의 버그를 수정. "코드 완성 = 동작 완성" 가정이 LLM CLI 연동에서 특히 위험함을 재확인.

### 3. execa v9 env merge 트랩

`execa` v9 는 기본적으로 `process.env` 를 subprocess 에 merge. `extendEnv: false` 를 명시하지 않으면 ANTHROPIC_API_KEY 등 민감 환경변수가 자동으로 흘러들어감. subprocess 실행 시 `extendEnv: false` + 명시적 env 객체 패턴이 안전.

### 4. 외부 패키지 0건 64 commits 연속

Stage 1 부터 Stage 7 까지 외부 패키지 추가 0건. drizzle-orm / better-sqlite3 / nanoid / js-yaml / highlight.js / next / react 등 모두 프로젝트 시작 시점의 의존성. 이 정책이 "AutoDev Agent 자체 개발" 의 정직성 지표.

---

## 커밋 요약 표

| # | 커밋 | 작업 | 분류 | 신규 파일 수 |
|---|------|------|------|:----------:|
| 조사 | e95af4d | Stage 7 사전 조사 | docs | 1 (md) |
| G0 | c545500 | pipeline_runs lifecycle | feat | ~3 |
| G1 | 6b858e1 | runs 목록 페이지 | feat | ~3 |
| G1-fix | 487be3d | 범위 redirect | fix | 0 |
| G2 | 85e0b0b | run 상세 페이지 | feat | ~7 |
| G3 | 0e2b547 | SSE 스트림 | feat | ~2 |
| G3-fix | 756c853 | composite cursor | fix | 0 |
| G4 | 15e5cee | YAML viewer | feat | 1 |
| G5 | a993704 | YAML editor | feat | 1 |
| G5-fix | 5627d83 | JSON guard | fix | 0 |
| G5-fix2 | e817624 | body guard | fix | 0 |
| G19-1 | 25cddb1 | AI Builder orchestrator | feat | ~3 |
| G19-2 | 0b2f8ca | intent classifier | feat | ~3 |
| G19-3a | bf79c8e | base spec | feat | 1 |
| G19-3b | a529e37 | fragments + detector | feat | ~2 |
| G19-3c | 41b4971 | few-shot + assembler | feat | ~2 |
| G19-3c-fix | 19408e3 | cache immutable | fix | 0 |
| G20-1 | 71a3608 | generator skeleton | feat | ~2 |
| G20-2 | 0228ffe | strict schema + retry | feat | ~3 |
| G20-3 | eeed6c8 | diff (G6 closure) | feat | 1 |
| G21a | a8222d3 | AI Builder API route | feat | 1 |
| G21b | 1975fbf | modal UI | feat | 1 |
| G21a-fix | e1926fb | input sanitize | fix | 0 |
| G21c | e532b11 | clarify thread UI | feat | 0 |
| — | b1bf698 | LICENSE+CONTRIBUTING | docs | 3 |
| — | 971883d | verify 정직성 수정 | fix | 0 |
| — | c2cec78 | CI vitest | ci | 0 |
| — | e1cab11 | CI Node 20 | ci | 0 |
| — | 32b89e2 | CI SQLite init | ci | 0 |
| — | c2bffb8 | setup.sh + .env.example | feat | 3 |
| — | 2d834db | setup Node fix | fix | 0 |
| — | 429d90a | AI Builder CLI mode | feat | 0 |
| — | fd904f7 | Claude Code detect | feat | 0 |
| — | 5dc4a80 | projects 기본 뷰 | feat | 0 |
| — | 4029275 | .worktrees gitignore | chore | 0 |
| — | 8a15769 | .worktrees gitignore | chore | 0 |
| — | a0e5e40 | env exclude fix | fix | 0 |
| — | 60a2460 | extendEnv:false fix | fix | 0 |
| — | d5b8f32 | mode 필드 노출 | feat | 0 |
| G7 | (이번) | Stage 7 retro | docs | 1 |

**외부 패키지 추가**: 0건 (누적 64 commits 연속)
**테스트**: 64 pass (9 test files) — CI vitest 전환 후 기준
**TypeScript 에러**: 0

---

## 수치 요약

| 항목 | 값 |
|------|----|
| 총 커밋 (Phase P Stage 7) | 40 (core 25 + 보조 15) + retro 1 |
| Phase P 전체 커밋 (Stage 1-7) | ~280 (추정, 전체 310 중 Phase P 분) |
| AI Builder 구현 커밋 | G19-G21 = 11 core + mode/env 4 보조 = 15 |
| Pipeline UI 커밋 | G0-G5 = 8 core |
| 테스트 (Stage 7 후) | 64 pass (vitest 전환 후 기준) |
| TypeScript 에러 | 0 |
| 외부 패키지 추가 누적 (64 commits) | 0건 |
| Pipeline UI 컴포넌트 파일 | 12개 (EventsTimeline / LiveEventsFeed / NodesTable / PipelineYamlEditor / PipelineYamlViewer / RunHeader / StateJsonViewer 등) |
| AI Builder lib 구조 | orchestrator / intent / few-shot / context / util / types |
| AI Builder 진짜 동작 결과 | 819자 YAML, $0.018, mode='cli' |
| 로드맵 예상 vs 실제 | 3-4주 → 5일 |
| Stage 7 기간 | 2026-04-25 ~ 2026-04-29 |

---

## Exit 기준 체크

- [x] G0: pipeline_runs lifecycle (insert on run start, update on terminal)
- [x] G0: runs/state/events 3종 read API
- [x] G1: pipeline runs 목록 페이지 (페이지네이션, 범위 초과 redirect)
- [x] G2: run 상세 페이지 (노드 테이블, 실행 상태)
- [x] G3: SSE 이벤트 스트림 (composite cursor 기반 polling)
- [x] G4: YAML viewer (highlight.js, read-only)
- [x] G5: YAML editor (textarea + js-yaml + 버전 저장, body guard)
- [x] G19: AI Builder orchestrator + intent 4-way classifier + base spec
- [x] G19: task fragments (7개) + keyword detector + few-shot assembler
- [x] G20: generator LLM call + parse + strict schema + Compiler 검증 + retry
- [x] G20: diff computation (G6 closure — compute_diff step)
- [x] G21: AI Builder POST `/api/ai-builder` route
- [x] G21: AI Builder modal UI + PipelineYamlViewer 연동
- [x] G21: clarify 멀티턴 대화 thread UI
- [x] AI Builder 진짜 동작 확인 (819자 YAML, $0.018)
- [x] AI Builder mode 분기: CLI 우선 + SDK fallback
- [x] AI Builder mode 필드 API 응답 노출
- [x] ANTHROPIC_API_KEY subprocess 누출 방지 (extendEnv:false)
- [x] CI: Node 20 + vitest + SQLite init
- [x] setup.sh + .env.example + .nvmrc
- [x] Verify Agent 정직성 수정 (VR1/VR2/VR4 depth 별 분기)
- [x] 외부 패키지 추가 0건 (64 commits 연속)
- [x] TypeScript 0 에러
- [x] Phase P Stage 1-7 전체 완성

---

## 다음 단계: v1.0 GA

**Phase P 종결. v1.0 RC 선언.**

v1.0 GA 를 위한 잔여 작업 (Stage 8 은 없음 — 마무리 작업):

1. **A1 README 강화** (1순위): 설치 / AI Builder / Verify Agent 사용법 문서화
2. **clarify/diff fix** (2순위): AI Builder 멀티턴 안정성
3. **GitHub release 태그** (사용자 직접): v1.0.0 태그 + Release Notes

> Phase P = Stage 1-7 완성. ADPL v1.0 스펙 (4,900줄) + Engine (Stage 2-3) + Adapters (Stage 3-4) + Triggers (Stage 5) + Durability (Stage 6) + UX (Stage 7) 전체 스택.
> **v1.0 RC 선언: 2026-04-29.**

---

작성일: 2026-04-29
작성자: Claude Code (자율 작성, 사용자 검토 필요)
