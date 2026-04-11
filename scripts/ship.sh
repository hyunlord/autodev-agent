#!/bin/bash
# AutoDev Agent — ship: verify:cross → commit → push 원커맨드
#
# 사용법:
#   pnpm ship "feat: 새 기능 추가"          — verify:cross 후 커밋+푸시
#   pnpm ship "fix: 버그 수정" --no-push    — verify:cross 후 커밋만 (푸시 안 함)
#   pnpm ship --verify-only                 — verify:cross만 실행 (커밋/푸시 안 함)

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

# ── 인자 파싱 ──
COMMIT_MSG=""
NO_PUSH=false
VERIFY_ONLY=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-push)
      NO_PUSH=true
      shift
      ;;
    --verify-only)
      VERIFY_ONLY=true
      shift
      ;;
    *)
      COMMIT_MSG="$1"
      shift
      ;;
  esac
done

if [ "$VERIFY_ONLY" = false ] && [ -z "$COMMIT_MSG" ]; then
  echo "❌ Usage: pnpm ship \"commit message\" [--no-push]"
  echo "         pnpm ship --verify-only"
  exit 1
fi

echo "╔══════════════════════════════════════════════╗"
echo "║  🚀 AutoDev Ship — Verify → Commit → Push   ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── Step 1: verify:cross 실행 ──
echo "━━━ Step 1/3: verify:cross ━━━"
echo ""

if ! bash scripts/verify.sh cross; then
  echo ""
  echo "❌ Ship aborted: verify:cross FAILED"
  echo "   Fix issues and try again."
  exit 1
fi

# cross-result.json 확인 (verify.sh가 생성)
CROSS_RESULT="$HOME/.autodev/cross-result.json"
if [ -f "$CROSS_RESULT" ]; then
  GRADE=$(python3 -c "import json; print(json.load(open('$CROSS_RESULT')).get('grade','?'))" 2>/dev/null || echo "?")
  SCORE=$(python3 -c "import json; print(json.load(open('$CROSS_RESULT')).get('score',0))" 2>/dev/null || echo "0")
  MAX_SC=$(python3 -c "import json; print(json.load(open('$CROSS_RESULT')).get('maxScore',100))" 2>/dev/null || echo "100")

  if [ "$GRADE" != "A" ] && [ "$GRADE" != "B" ]; then
    echo ""
    echo "❌ Ship aborted: grade ${GRADE} (${SCORE}/${MAX_SC})"
    echo "   Grade A/B required. Fix issues first."
    exit 1
  fi

  echo ""
  echo "✅ verify:cross ${GRADE} (${SCORE}/${MAX_SC})"
fi

if [ "$VERIFY_ONLY" = true ]; then
  echo ""
  echo "✅ Verify-only mode complete."
  exit 0
fi

# ── Step 2: Git commit ──
echo ""
echo "━━━ Step 2/3: Git commit ━━━"
echo ""

git add -A

if git diff --cached --quiet; then
  echo "⚠️  No staged changes to commit."
  exit 0
fi

# 커밋 (--no-verify: verify:cross에서 이미 검증 완료)
git commit --no-verify -m "$COMMIT_MSG"
echo "✅ Committed: $COMMIT_MSG"

# cross-result.json의 commitHash 업데이트 (pre-push 검증용)
NEW_HEAD=$(git rev-parse HEAD 2>/dev/null || echo "")
if [ -n "$NEW_HEAD" ] && [ -f "$CROSS_RESULT" ]; then
  python3 -c "
import json
f = '$CROSS_RESULT'
d = json.load(open(f))
d['commitHash'] = '$NEW_HEAD'
json.dump(d, open(f, 'w'), indent=2)
" 2>/dev/null || true
fi

# ── Step 3: Git push ──
if [ "$NO_PUSH" = true ]; then
  echo ""
  echo "✅ Ship complete (commit only, --no-push)"
  exit 0
fi

echo ""
echo "━━━ Step 3/3: Git push ━━━"
echo ""

BRANCH=$(git branch --show-current)
UPSTREAM=$(git rev-parse --abbrev-ref "@{upstream}" 2>/dev/null || echo "")

if [ -n "$UPSTREAM" ]; then
  git push --no-verify
  echo "✅ Pushed to $UPSTREAM"
else
  git push -u origin "$BRANCH" --no-verify
  echo "✅ Pushed to origin/$BRANCH (upstream set)"
fi

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  ✅ Ship complete!                            ║"
echo "║  verify:cross ${GRADE} (${SCORE}/${MAX_SC}) → committed → pushed  ║"
echo "╚══════════════════════════════════════════════╝"
