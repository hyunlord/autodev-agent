#!/bin/bash
# AutoDev Agent — ship: verify:cross → commit → push 원커맨드
#
# 사용법:
#   pnpm ship "feat: 새 기능 추가"          — verify:cross 후 커밋+푸시 (A등급 95+ 필요)
#   pnpm ship "fix: 버그 수정" --no-push    — verify:cross 후 커밋만 (푸시 안 함)
#   pnpm ship --verify-only                 — verify:cross만 실행 (커밋/푸시 안 함)
#   pnpm ship "msg" --force                 — LLM 연결 실패 시 우회 (명시적 선택)

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

# ── 인자 파싱 ──
COMMIT_MSG=""
NO_PUSH=false
VERIFY_ONLY=false
FORCE=false

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
    --force)
      FORCE=true
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

CROSS_RESULT="$HOME/.autodev/cross-result.json"

bash scripts/verify.sh cross
VERIFY_EXIT=$?

# cross-result.json 읽기
GRADE="?"
SCORE=0
MAX_SC=100
if [ -f "$CROSS_RESULT" ]; then
  GRADE=$(python3 -c "import json; print(json.load(open('$CROSS_RESULT')).get('grade','?'))" 2>/dev/null || echo "?")
  SCORE=$(python3 -c "import json; print(json.load(open('$CROSS_RESULT')).get('score',0))" 2>/dev/null || echo "0")
  MAX_SC=$(python3 -c "import json; print(json.load(open('$CROSS_RESULT')).get('maxScore',100))" 2>/dev/null || echo "100")
fi

if [ $VERIFY_EXIT -ne 0 ] || [ "$GRADE" != "A" ]; then
  if [ "$FORCE" = true ]; then
    # --force: LLM 연결 실패(llm_unavailable) + 기계적 검증 만점일 때만 우회 허용
    MECH_SCORE=$(python3 -c "import json; print(json.load(open('$CROSS_RESULT')).get('mechanicalScore',0))" 2>/dev/null || echo "0")
    MECH_MAX=$(python3 -c "import json; print(json.load(open('$CROSS_RESULT')).get('mechanicalMax',0))" 2>/dev/null || echo "0")
    VA_STATUS=$(python3 -c "import json; print(json.load(open('$CROSS_RESULT')).get('verifyAgentStatus','unknown'))" 2>/dev/null || echo "unknown")

    # --force 허용 조건: verifyAgentStatus == llm_unavailable + 기계적 검증 만점 + 결과 신선도
    if [ "$VA_STATUS" != "llm_unavailable" ]; then
      echo ""
      echo "❌ Ship aborted: --force는 LLM 연결 실패 시에만 사용 가능"
      echo "   현재 Verify Agent 상태: ${VA_STATUS}"
      [ "$VA_STATUS" = "reviewed" ] && echo "   LLM이 실제 리뷰 후 낮은 점수를 줌. 이슈를 수정하세요."
      exit 1
    fi

    # 결과 신선도 확인 (tree hash)
    RESULT_TREE=$(python3 -c "import json; print(json.load(open('$CROSS_RESULT')).get('treeHash',''))" 2>/dev/null || echo "")
    CURRENT_TREE=$(git write-tree 2>/dev/null || echo "unknown")
    if [ -n "$RESULT_TREE" ] && [ "$RESULT_TREE" != "unknown" ] && [ "$RESULT_TREE" != "$CURRENT_TREE" ]; then
      echo ""
      echo "❌ Ship aborted: cross-result가 현재 코드와 불일치 (stale)"
      echo "   pnpm verify:cross를 다시 실행하세요."
      exit 1
    fi

    if [ "$MECH_MAX" -gt 0 ] 2>/dev/null && [ "$MECH_SCORE" -eq "$MECH_MAX" ] 2>/dev/null; then
      echo ""
      echo "⚠️  Grade ${GRADE} (${SCORE}/${MAX_SC}) — --force bypass (LLM unavailable)"
      echo "   기계적 검증 ${MECH_SCORE}/${MECH_MAX} 만점. 수동 리뷰 책임은 사용자에게 있음."
    else
      echo ""
      echo "❌ Ship aborted: 기계적 검증 ${MECH_SCORE}/${MECH_MAX} 미달 — --force로도 우회 불가"
      echo "   --force는 빌드/TS/API/UI 만점 + LLM 연결 실패 시에만 사용 가능"
      exit 1
    fi
  else
    echo ""
    echo "❌ Ship aborted: grade ${GRADE} (${SCORE}/${MAX_SC})"
    echo "   Grade A (95%+) required. Fix issues first."
    echo "   LLM 연결 실패 시: pnpm ship \"msg\" --force"
    exit 1
  fi
else
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
  if ! git push --no-verify; then
    echo ""
    echo "❌ Push failed — commit exists locally"
    echo "   Commit: $(git rev-parse --short HEAD)"
    echo "   Branch: $BRANCH"
    echo ""
    echo "   수동 push: git push"
    echo "   상태 확인: git remote -v && git status"
    exit 1
  fi
  echo "✅ Pushed to $UPSTREAM"
else
  if ! git push -u origin "$BRANCH" --no-verify; then
    echo ""
    echo "❌ Push failed — commit exists locally"
    echo "   Commit: $(git rev-parse --short HEAD)"
    echo "   Branch: $BRANCH"
    echo ""
    echo "   수동 push: git push -u origin $BRANCH"
    echo "   상태 확인: git remote -v && git status"
    exit 1
  fi
  echo "✅ Pushed to origin/$BRANCH (upstream set)"
fi

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║  ✅ Ship complete!                            ║"
echo "║  verify:cross ${GRADE} (${SCORE}/${MAX_SC}) → committed → pushed  ║"
echo "╚══════════════════════════════════════════════╝"
