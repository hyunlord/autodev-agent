# Phase P Stage 1 Retrospective

기간: 2026-04-19 ~ 2026-04-20 (집중 진행)
Commits: 12 (c27bc1e ~ 454a3e4)
총 분량: ~8,000+ 줄 (스펙 4,900 + 타입/스키마/CLI/샘플)
평균 verify:cross: 97.5 / 100 (A)

---

## 목표 vs 실제

| 작업 | 계획 | 실제 | 비고 |
|------|:----:|:----:|------|
| A1-1 DB 백업/복구 | 0.5일 | ✅ | 제시간 |
| A1-2 Phase P 테이블 | 1일 | ✅ | projects 블로커 발견 + 해결 |
| A1-3 tasks 컬럼 확장 | 0.5일 | ✅ | pipeline_mode 블로커 + 해결 |
| A1-4 ADPL 스펙 문서 | 2일 | ✅ (3 commits + 2 fix) | 분할 3 Part, 의미론 2회 수정 |
| A1-5 CLI validate | 1일 | ✅ | 10분만에 완료 (A2-2 Zod 덕분) |
| A2-1 Core types | 1.5일 | ✅ | |
| A2-2 Zod schemas | 2일 | ✅ | |
| A2-3 샘플 YAML 10개 | 1-1.5일 | ✅ | 스펙 불일치 5건 발견 |
| A2-4 통합 테스트 + 회고 | 0.5일 | ✅ | 현재 |

**총 계획**: Week 1-2 (약 2주)
**실제**: Day 1-2 집중 진행 → Stage 1 완전 종료

---

## 잘 된 점

### 1. 사전 조사 → 블로커 발견 → 판단 패턴

구현 전 기존 스키마/컨벤션 조사를 통해 설계 불일치를 먼저 발견하고
사용자 판단을 받은 뒤 진행. A1-2, A1-3, A1-4b, A1-4c 모두 적용.

**"설계는 가이드, 코드베이스가 진실"** 원칙이 Stage 1 전체를 관통함.

### 2. Verify Agent 자율 수정 루프

감점 발견 시 즉시 fix. A1-4b (95 → 98), A1-4c (95 → 98) 모두 fix 후 A 회복.
verify:cross 점수는 품질 게이트로서 기능을 충실히 수행함.

### 3. 실전 검증의 가치

A2-3 샘플 YAML 작성 중 스펙 불일치 5건이 드러남.
문서 리뷰만으로는 잡기 어려운 문제들이 실제 사용에서 발견됨.
이는 A1-4c-fix 반영 근거가 됨.

### 4. 타입-스키마-CLI 삼각 체계

A2-1(Core types) → A2-2(Zod schemas) → A1-5(CLI) 순서로 쌓인 레이어가
A2-3(샘플)에서 즉시 활용됨. 추상화 레이어 투자가 빠르게 회수.

---

## 어려웠던 점

### 1. 문서 작업 감점 빈도

코드 작업 (A1-1~A1-3): 첫 시도 98점
문서 작업 (A1-4 계열): 첫 시도 95점 (2회)

원인: Verify Agent 의 논리적 일관성/의미론 검증이 코드보다 문서에서
더 세밀하게 작동. 스펙 문서의 내부 일관성 유지가 코드보다 어려움.

### 2. pnpm ship 과 push 타이밍

`cross-result.json` 이 10분 초과 시 pre-push 자동 skip 됨.
A1-4b ~ A2-1 5 commits 가 로컬 누적 → A2-1 push 시 일괄 push.
의도하지 않은 배치 push 발생.

### 3. Drizzle push 의 비멱등성

복원 후 `db:push` 가 인덱스 중복으로 실패 (블로커 기록됨).
Drizzle v0.30.x 의 알려진 한계. 롤백 절차 문서에 주의사항 추가 필요.

---

## 발견된 블로커 (6건)

| # | 블로커 | 발견 위치 | 해결 | 설계 반영 |
|:---:|---|---|---|---|
| 1 | projects 테이블 누락 | A1-2 | 신규 생성 | ⏳ design-updates-needed.md |
| 2 | 타임스탬프 컨벤션 불일치 | A1-2 | text ISO 통일 | ⏳ |
| 3 | executionMode 컬럼명 충돌 | A1-3 | pipelineMode 분리 | ⏳ |
| 4 | agent role 기본값 custom | A1-4b | planner 로 변경 | ⏳ |
| 5 | $loop.<as> 접근 표기 불명확 | A1-4c | 명시적 표기 확정 | ⏳ |
| 6 | while 의미론 (pre vs post) | A1-4c | post-test 확정 | ⏳ |

설계 문서는 프로젝트 외부에 위치하여 `docs/phase-p/design-updates-needed.md` 에
권고사항 기록. 설계 소스 소유자가 반영 예정.

---

## Stage 2 진입 전 권고

### 유지할 패턴
- 구현 전 사전 조사 → 블로커 발견 → 사용자 판단 → 진행
- 감점 발견 시 다음 작업 전 즉시 fix
- 커밋 메시지 `feat(phase-p): Stage N X-Y — 요약` 통일

### 개선할 점
- `pnpm ship` 실행 즉시 `git push` 포함 여부 명확화
  (현재: 95+ A 이면 commit + push, 타이밍에 따라 skip)
- 롤백 절차에 `-y` 플래그 + `db:push` 스킵 옵션 문서화
- `06-gate-approval.yaml` 의 `retry-staging` 분기 처리 개선 (Stage 2)
- 설계 문서와 코드 동기화 주기 확립 (Stage 2 시작 전 설계 소유자와 확인)

### Stage 2 시작 조건 체크리스트
- ✅ DB 안전망 (backup / restore / verify)
- ✅ Phase P 데이터 모델 완성 (13 tables)
- ✅ ADPL 언어 스펙 공식화 (§1-§13)
- ✅ TypeScript 타입 + Zod 스키마
- ✅ Validation CLI (`pnpm adpl:validate`)
- ✅ 샘플 파이프라인 10개 (examples/adpl/)
- ✅ 통합 테스트 통과 (verify:cross 96/100 A)

**Stage 2 Engine Core 진입 준비 완료.**
예상 기간: 3-4주 (설계 4C1 기반).

---

## Metrics

| 항목 | 수치 |
|------|------|
| Phase P 설계 문서 | ~19,200줄 (14 문서) |
| Phase P 로드맵 | 1,488줄 |
| Stage 1 구현 코드 | ~8,000+ 줄 |
| Stage 1 commits | 12 |
| Stage 1 평균 verify:cross | 97.5 / 100 |
| Stage 1 블로커 발견 | 6건 |
| Stage 1 블로커 해결 | 6/6 |
| 최종 통합 테스트 | 96/100 A |
| 테스트 커버리지 | 22/22 pass |
