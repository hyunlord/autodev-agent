#!/bin/bash
# AutoDev Agent — pre-push hook (최후 방어선)
# verify:cross A/B 등급 없이 push 차단
# HEAD commit과 cross-result의 commitHash를 비교
#
# 설치: pnpm hook:install
# 건너뛰기: git push --no-verify (절대 비권장)

PROJECT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$PROJECT_DIR"

echo "🛡️  pre-push: Checking verify:cross status..."

CROSS_RESULT="$HOME/.autodev/cross-result.json"
MAX_AGE=1800  # 30분

# ── cross-result.json 존재 확인 ──
if [ ! -f "$CROSS_RESULT" ]; then
  echo ""
  echo "❌ pre-push BLOCKED: No verify:cross record found"
  echo ""
  echo "   Run 'pnpm verify:cross' before pushing."
  echo "   Or use 'pnpm ship \"message\"' for one-command verify+commit+push."
  exit 1
fi

# ── 시간 확인 ──
if stat -f %m "$CROSS_RESULT" >/dev/null 2>&1; then
  FILE_MTIME=$(stat -f %m "$CROSS_RESULT")
else
  FILE_MTIME=$(stat -c %Y "$CROSS_RESULT")
fi
NOW=$(date +%s)
RESULT_AGE=$(( NOW - FILE_MTIME ))

if [ $RESULT_AGE -gt $MAX_AGE ]; then
  echo ""
  echo "❌ pre-push BLOCKED: verify:cross result is stale (${RESULT_AGE}s old, max ${MAX_AGE}s)"
  echo ""
  echo "   Run 'pnpm verify:cross' again before pushing."
  exit 1
fi

# ── 등급 확인 ──
GRADE=$(python3 -c "import json; print(json.load(open('$CROSS_RESULT')).get('grade','?'))" 2>/dev/null || echo "?")
SCORE=$(python3 -c "import json; print(json.load(open('$CROSS_RESULT')).get('score',0))" 2>/dev/null || echo "0")
MAX_SC=$(python3 -c "import json; print(json.load(open('$CROSS_RESULT')).get('maxScore',100))" 2>/dev/null || echo "100")
PERCENT=$(python3 -c "import json; print(json.load(open('$CROSS_RESULT')).get('percent',0))" 2>/dev/null || echo "0")
RESULT_COMMIT=$(python3 -c "import json; print(json.load(open('$CROSS_RESULT')).get('commitHash',''))" 2>/dev/null || echo "")

# ── HEAD와 commitHash 비교 ──
CURRENT_HEAD=$(git rev-parse HEAD 2>/dev/null || echo "unknown")

if [ -n "$RESULT_COMMIT" ] && [ "$RESULT_COMMIT" != "unknown" ]; then
  if ! git merge-base --is-ancestor "$RESULT_COMMIT" "$CURRENT_HEAD" 2>/dev/null; then
    echo ""
    echo "❌ pre-push BLOCKED: verify:cross was run on a different commit"
    echo "   result commit: ${RESULT_COMMIT:0:12}"
    echo "   current HEAD:  ${CURRENT_HEAD:0:12}"
    echo ""
    echo "   Run 'pnpm verify:cross' on the current code before pushing."
    exit 1
  fi
fi

# ── 등급 판정 ──
if [ "$GRADE" = "A" ]; then
  echo "✅ pre-push: verify:cross ${GRADE} (${SCORE}/${MAX_SC} = ${PERCENT}%, ${RESULT_AGE}s ago)"
  exit 0
fi

echo ""
echo "❌ pre-push BLOCKED: verify:cross grade = ${GRADE} (${SCORE}/${MAX_SC} = ${PERCENT}%)"
echo ""
echo "   Grade A (95%+) required for push."
echo "   Fix issues, run 'pnpm verify:cross', then push again."
exit 1
