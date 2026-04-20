# Phase P — Known Issues Fixed

Stage 1 완료 후 발견된 인프라 이슈 2건 수정 기록 (Stage 2 진입 전 안정화).

---

## 1. Drizzle db:push 인덱스 중복 에러

**발견**: Stage 1 A2-4 통합 테스트 (rollback drill)
**긴급도**: HIGH — Stage 2 rollback drill 마다 발생

### 증상

```
SqliteError: index idx_tasks_status already exists
```

`db:restore` 후 `db:push` 실행 시 발생. 특히 오래된 백업(pre-stage-1)에서 복원 후
두 번째 `db:push` 실행 시 재현.

### 근본 원인

drizzle-kit 0.30.6 SQLite 버그. `tasks` 테이블에 컬럼 추가 시 drizzle-kit이
SQLite의 "drop + recreate" 패턴으로 테이블을 재생성하면서 인덱스를 인라인 생성하고,
**동일 실행 내**에서 같은 인덱스를 "누락 인덱스"로 재시도 → 중복 에러.

### 수정 (`scripts/db-push.ts`)

`drizzle-kit push`의 래퍼 스크립트. 두 단계 우회:

1. **Pre-drop**: push 전 `sqlite_master`에서 사용자 정의 인덱스 전체 삭제
   (일반 idempotency 케이스 처리)
2. **Retry**: `already exists` 에러 발생 시 해당 인덱스만 삭제 후 재시도
   (테이블 재생성이 포함된 케이스 처리, max 10회)

`package.json` `db:push` 스크립트: `drizzle-kit push` → `tsx scripts/db-push.ts`

### 검증

- `db:restore(pre-stage-1) → db:push → db:push` 에러 0 ✓
- `db:backup → db:restore → db:push` 왕복 3회 에러 0 ✓
- TypeScript 에러 0 ✓

---

## 2. pnpm ship push 실패 무음 처리

**발견**: Stage 1 Day 1 중반 (A1-4b~A2-1, 5 commits 뒤늦게 push)
**긴급도**: MEDIUM — 사용자가 push 성공으로 오인

### 증상

`pnpm ship "msg"` 실행 시 `git push` 실패해도 "Ship complete ✅" 출력.
커밋은 로컬에만 쌓임.

### 근본 원인

`scripts/ship.sh`에 `set -e` 없고, Step 3의 `git push --no-verify` 뒤
exit code 확인 없음 → push 실패 시 스크립트 계속 진행.

### 수정 (`scripts/ship.sh`)

`git push` 명령에 `if !` 조건 추가. 실패 시:
- 커밋 해시 + 브랜치 출력
- 수동 push 방법 안내
- exit 1

### 검증

- 정상 ship 워크플로우 유지 (회귀 없음) ✓
- push 실패 시 명확한 에러 + exit 1 출력 ✓
