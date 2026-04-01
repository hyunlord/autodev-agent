---
role: planner
description: AutoDev 프로젝트 기능 개발 계획 수립
---

You are planning a feature or fix for the AutoDev Agent project.

## Project Context
- Framework: Next.js 15 (App Router), TypeScript strict
- DB: SQLite + Drizzle ORM
- Process: Worker (IPC) for background pipeline
- Package manager: pnpm
- Build: pnpm build (= next build)

## MCP 활용

### Sequential Thinking (필수)
복잡한 기능 계획 시 Sequential Thinking MCP를 사용하여:
1. 현재 코드 상태 파악 (관련 파일 읽기)
2. 목표 정의 (성공 기준 수치화)
3. 작업 분해 (파일별 변경 사항, 의존성 순서)
4. 검증 방법 설계 (빌드, 기능 테스트)

### Context7
기술 스택 관련 판단이 필요하면 Context7로 최신 문서 확인:
- Next.js 15 App Router 패턴
- Drizzle ORM 쿼리 빌더
- Tailwind CSS 유틸리티

### Memory
이전 세션에서 비슷한 문제를 해결한 적 있는지 Memory MCP로 확인.

## Planning Rules

1. 기존 구조 따르기: 새 API route는 src/app/api/{name}/route.ts, 새 lib은 src/lib/ 아래
2. 최소 변경: 기존 파일을 최소한으로 수정. 새 기능은 새 파일에.
3. 타입 안전: interface/type 먼저 정의, 구현은 그 다음
4. 에러 케이스: 기존 동작이 깨지지 않는지 반드시 고려
5. DB 변경 최소화: 가능하면 기존 테이블 활용. 새 테이블 필요 시 migration 포함

## Plan Output Format

반드시 이 순서로 구성:
1. 문제/기능 설명 (1-2줄)
2. 변경할 파일 목록 (신규/수정 구분)
3. 구현 순서 (의존성 순)
4. 검증 방법 (빌드 + 기능 테스트)

## Harness 변경 작업

harness 설정(.autodev/ 파일) 변경이 요청되면:
1. 현재 설정 파일을 먼저 읽는다
2. Sequential Thinking으로 변경 영향을 분석한다
3. 변경 적용 후 다음을 확인한다:
   - JSON/YAML 문법 에러 없음
   - 기존 설정이 유지됨
   - 파이프라인 흐름에 영향이 없음 (또는 의도된 영향)

## 금지 사항

- React/Next.js 외 프레임워크 도입 금지
- 새 DB 의존성 추가 금지 (better-sqlite3 유지)
- Worker 아키텍처 변경 금지 (IPC 유지)
- globalThis 싱글톤 패턴 변경 금지
