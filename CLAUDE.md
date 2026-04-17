# AutoDev Agent — Project Instructions

## 프로젝트
Next.js 15 + TypeScript(strict) + SQLite + Drizzle + pnpm 기반 멀티 에이전트 코딩 오케스트레이터. Plan → Code → Verify 파이프라인이 핵심. 상세 아키텍처는 `docs/architecture-v2.md` 참조.

## 코딩 규칙
1. TypeScript strict — any 사용 최소화, 타입 명시
2. next build 필수 통과 — 모든 변경 후 빌드 에러 0 확인
3. Drizzle ORM — raw SQL 금지, 스키마 변경 시 migration 생성
4. execa — 외부 프로세스 실행은 `src/lib/execa.ts` 래퍼 사용
5. nanoid — ID 생성은 항상 nanoid 사용
6. 에러 핸들링 — try/catch 후 emit으로 에러 전파, 조용히 삼키지 않기
7. globalThis 싱글톤 — DB, Worker는 globalThis에 저장 (HMR 대응)
8. 경로 — 절대 경로 금지, 프로젝트 루트 기준 상대 경로
9. 기존 기능 유지 — 새 기능 추가 시 기존 동작 깨뜨리지 않기
10. 한국어 주석 OK — 코드 내 한국어 주석 허용, 변수명은 영어

## 파이프라인 흐름
Task 생성 → Planning (CLI/API) → Plan Review (사용자 승인) → Agent Selection (LLM 추천) → Coding → Verification (8 types) → Retry (max 3) → Complete/Escalation. Auto-cycle 모드는 GOAL_COMPLETE까지 반복 (max N cycles).

## DB 테이블
- `tasks` — 작업 (status, plan, prompt, config)
- `attempts` — 코딩 시도 (agentId, costUsd, tokenCount)
- `verifications` — 검증 결과 (checkId, status, expected/actual)
- `events` — SSE 이벤트 (type, data, timestamp)
- `webhooks` — 알림 훅 (platform, url, events, enabled)

## 파일 수정 주의
- `src/lib/db/schema.ts` 수정 → `pnpm db:push` (현재 push 방식만 사용, generate 아님)
- `src/worker/pipeline.ts` 수정 → Worker 재시작 필요 (IPC)
- `.autodev/agents/*.md` 수정은 Harness Evolve UI 경유 권장, 직접 편집 지양

## 검증 + 커밋 프로토콜
**모든 커밋은 `pnpm ship` 경유**. ship 내부:
1. build + typecheck + API health + UI health + Verify Agent(cross-LLM) 실행
2. 결과표(┌─┬─┐) 출력
3. 총점 95+ (A등급)이면 commit + push, 이하 차단

**금지**:
- 직접 `git commit` / `git push`
- verify:cross 건너뛰고 "완료" 보고
- 결과표 없이 요약만 제공
- B(85-94) 이하 점수에서 `--force` 없이 push 시도
- "문서만 수정"·"한 줄 변경"이라는 이유로 verify 스킵

**등급**: A 95+ (Ship it) · B 85-94 (검토 필요) · C 70-84 (재작업) · F <70 (차단)

## 작업 보고 규칙
Claude Code 응답은 4블록 구조:
1. **Plan** — 수정할 파일 + 변경 요지 (2-5줄)
2. **Code** — 파일별 +N/-M diff 요약
3. **Verify** — `pnpm ship` 결과표 그대로 포함
4. **요약** — 수락 기준 충족 여부 + 커밋 해시 + 외부 요인(rate limit 등)

## 참조 문서
- `README.md` — 외부 사용자용 intro, 기술 스택/Features
- `docs/architecture-v2.md` — 전체 아키텍처 상세 (Verify Agent, 파이프라인 구조)
- `docs/API.md` — API 레퍼런스
- `docs/mcp-guide.md` — 6개 MCP 서버 사용법
- `docs/harness-config.md` — Harness 자연어 설정 매핑
- `.autodev/agents/*.md` — 에이전트별 지시문 (coder, planner, verifier, evaluator, debate-drafter)
