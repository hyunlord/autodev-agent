#!/bin/bash
# AutoDev Agent — pre-commit hook
# 커밋 전 빌드 + 타입 체크를 실행하여 깨진 코드 커밋 방지
#
# 설치: pnpm hook:install
# 제거: pnpm hook:uninstall
# 건너뛰기: git commit --no-verify

set -e

PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$PROJECT_DIR"

echo "🔍 pre-commit: Running build check..."

# Quick build check (pnpm build)
BUILD_OUTPUT=$(pnpm build 2>&1)
BUILD_EXIT=$?

if [ $BUILD_EXIT -ne 0 ]; then
  echo ""
  echo "❌ pre-commit FAILED: Build error"
  echo ""
  echo "$BUILD_OUTPUT" | tail -20
  echo ""
  echo "Fix build errors before committing."
  echo "To skip this check: git commit --no-verify"
  exit 1
fi

# Check for TypeScript errors in build output
TS_ERRORS=$(echo "$BUILD_OUTPUT" | grep -c "Type error" || true)
if [ "$TS_ERRORS" -gt 0 ]; then
  echo ""
  echo "❌ pre-commit FAILED: $TS_ERRORS TypeScript error(s)"
  echo ""
  echo "$BUILD_OUTPUT" | grep -A 3 "Type error"
  echo ""
  echo "Fix TypeScript errors before committing."
  echo "To skip this check: git commit --no-verify"
  exit 1
fi

echo "✅ pre-commit: Build passed"

# Optional: Verify Agent review (only if AUTODEV_PRECOMMIT_VERIFY=1)
if [ "${AUTODEV_PRECOMMIT_VERIFY:-0}" = "1" ]; then
  echo "🔍 pre-commit: Running Verify Agent review..."

  VERIFY_OUTPUT=$(npx tsx scripts/verify-agent.ts 2>&1)
  VERIFY_EXIT=$?

  if [ $VERIFY_EXIT -ne 0 ]; then
    echo ""
    echo "⚠️  pre-commit WARNING: Verify Agent found issues"
    echo ""
    echo "$VERIFY_OUTPUT" | grep -E "(Verdict|Score|Issues|[0-9]+\.)" | head -20
    echo ""
    # Verify Agent 실패는 기본 경고만 (차단 안 함)
    # 차단하려면 AUTODEV_PRECOMMIT_VERIFY_STRICT=1 설정
    if [ "${AUTODEV_PRECOMMIT_VERIFY_STRICT:-0}" = "1" ]; then
      echo "Strict mode: Verify Agent failure blocks commit."
      echo "To skip: git commit --no-verify"
      exit 1
    else
      echo "(Warning only — commit will proceed. Set AUTODEV_PRECOMMIT_VERIFY_STRICT=1 to block.)"
    fi
  else
    echo "✅ pre-commit: Verify Agent passed"
  fi
fi

# Optional: Check recent Verify Agent verdict (within 5 minutes)
VERDICT_FILE="$HOME/.autodev/verdict.json"
if [ -f "$VERDICT_FILE" ]; then
  # macOS와 Linux 모두 호환
  if stat -f %m "$VERDICT_FILE" >/dev/null 2>&1; then
    FILE_MTIME=$(stat -f %m "$VERDICT_FILE")
  else
    FILE_MTIME=$(stat -c %Y "$VERDICT_FILE")
  fi
  NOW=$(date +%s)
  VERDICT_AGE=$(( NOW - FILE_MTIME ))

  if [ $VERDICT_AGE -lt 300 ]; then
    VERDICT=$(python3 -c "import sys,json; print(json.load(open('$VERDICT_FILE')).get('verdict','unknown'))" 2>/dev/null || echo "unknown")
    if [ "$VERDICT" = "fail" ]; then
      echo ""
      echo "❌ pre-commit: Recent Verify Agent verdict: FAIL (${VERDICT_AGE}s ago)"
      echo "   Run 'pnpm verify:agent' to re-check, or 'git commit --no-verify' to override."
      exit 1
    fi
  fi
fi

exit 0
