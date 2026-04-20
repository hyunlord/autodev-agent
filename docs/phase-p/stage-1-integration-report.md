# Stage 1 통합 테스트 리포트

일시: 2026-04-20
커밋: 454a3e4 (A2-3 완료) 기준

---

## 테스트 결과

| 항목 | 결과 | 비고 |
|------|------|------|
| Rollback drill — Backup | ✅ | 13 tables, 3,945 rows |
| Rollback drill — Restore | ✅ | -y 플래그 필요 (비-TTY) |
| Rollback drill — Re-migrate | ⚠️ | 아래 이슈 참조 |
| Rollback drill — Post-restore verify | ✅ | 13 tables, 3,945 rows 보존 |
| 샘플 YAML validate (10개) | ✅ 10/10 | |
| Invalid YAML rejection (exit 1) | ✅ | 한국어 에러 메시지 출력 |
| Missing file (exit 2) | ✅ | |
| Legacy 회귀 테스트 | ✅ 22/22 | vitest run |
| TypeScript strict | ✅ 에러 0 | tsc --noEmit |
| Build | ✅ | next build |
| verify:cross | ✅ A 96/100 | |

---

## 발견된 이슈

### 이슈 1: db:push 복원 후 인덱스 충돌

**증상**:
```
SqliteError: index idx_tasks_status already exists
```

**원인**: `db:restore` 로 복원하면 DB 에 이미 모든 인덱스가 포함된 상태.
`pnpm db:push` (Drizzle push) 는 인덱스 존재 여부를 체크하지 않고
재생성을 시도 → 충돌.

**영향**: 실제 데이터 무결성에는 영향 없음. DB 는 13 tables, 3,945 rows 정상.
`db:push` 는 롤백 절차의 "재마이그레이션" 단계에서만 발생.

**권고**:
- 복원 후 `db:push` 대신 `db:verify` 로 상태만 확인
- 또는 `db:push` 에 `--force` / `IF NOT EXISTS` 처리 추가 (Stage 2 개선 사항)
- Rollback 절차 문서에 `-y` 플래그 명시 + `db:push` 스킵 가능 주석 추가

**Drizzle 추적**: `drizzle-kit push` 의 idempotent index 처리가 v0.30.x 에서
미지원. 업스트림 이슈.

### 이슈 2: verify:cross 동시 실행 시 파일 충돌

**증상**: `pnpm build` 와 `pnpm verify:cross` 를 동시에 실행하면
`.next/export/500.html` rename 실패.

**원인**: 두 빌드가 `.next/` 를 동시에 쓰는 경쟁 조건.

**해결**: 순차 실행으로 회피. verify:cross 단독 재실행 → 96/100 정상.

### 이슈 3: Verify Agent 지적 — 06-gate-approval.yaml

**점수**: 46/50 (ok, Ship 허용)

**지적**: `retry-staging` 옵션이 `route-approval` 로직에서 실제로는 rejection
처리됨. 의미론적 불일치.

**대응**: 샘플 파일의 의도가 "승인 게이트" 패턴 시연 이므로 Stage 2 에서
`retry-staging` 분기 처리 추가 예정. 현재는 샘플 주석으로 한계 명시.

---

## 결론

**Stage 2 진입 준비 완료.**

핵심 기능 (DB 안전망, ADPL CLI, 타입/스키마, 샘플) 모두 정상 동작.
발견된 이슈 3건은 모두 기능 차단이 아닌 개선 항목.
verify:cross 96/100 A (Ship it).
