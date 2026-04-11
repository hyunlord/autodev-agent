#!/bin/bash
# AutoDev Agent — git hooks 설치/제거 (pre-commit + pre-push)
#
# 사용법:
#   pnpm hook:install    — 모든 hooks 설치
#   pnpm hook:uninstall  — 모든 hooks 제거

ACTION="${1:-install}"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# HIGH #3: git worktree 호환 — .git/hooks 하드코딩 대신 git rev-parse 사용
HOOKS_DIR=$(git -C "$PROJECT_DIR" rev-parse --git-path hooks 2>/dev/null)
if [ -z "$HOOKS_DIR" ] || [ ! -d "$HOOKS_DIR" ]; then
  # fallback
  HOOKS_DIR="$PROJECT_DIR/.git/hooks"
fi

# hooks 디렉터리가 없으면 생성
mkdir -p "$HOOKS_DIR"

install_hook() {
  local HOOK_NAME="$1"
  local SOURCE="$PROJECT_DIR/scripts/${HOOK_NAME}.sh"
  local TARGET="$HOOKS_DIR/$HOOK_NAME"

  if [ ! -f "$SOURCE" ]; then
    echo "⚠️  Source not found: $SOURCE (skipping $HOOK_NAME)"
    return 1
  fi

  if [ -f "$TARGET" ]; then
    echo "⚠️  $HOOK_NAME hook already exists. Backing up to ${HOOK_NAME}.bak"
    cp "$TARGET" "$TARGET.bak"
  fi

  cp "$SOURCE" "$TARGET"
  chmod +x "$TARGET"
  echo "✅ $HOOK_NAME hook installed → $TARGET"
  return 0
}

uninstall_hook() {
  local HOOK_NAME="$1"
  local TARGET="$HOOKS_DIR/$HOOK_NAME"

  if [ -f "$TARGET" ]; then
    rm "$TARGET"
    echo "✅ $HOOK_NAME hook removed"
    if [ -f "$TARGET.bak" ]; then
      mv "$TARGET.bak" "$TARGET"
      echo "   Previous $HOOK_NAME hook restored from backup"
    fi
  else
    echo "No $HOOK_NAME hook to remove"
  fi
}

case "$ACTION" in
  install)
    INSTALLED=0
    install_hook "pre-commit" && INSTALLED=$((INSTALLED + 1))
    install_hook "pre-push"   && INSTALLED=$((INSTALLED + 1))

    echo ""
    echo "━━━ $INSTALLED hook(s) installed ━━━"
    echo ""
    echo "What's enforced:"
    echo "  pre-commit  → Build + TS check + verify:cross PASS 필수"
    echo "  pre-push    → verify:cross verdict + HEAD commit 재확인"
    echo ""
    echo "Recommended workflow:"
    echo "  pnpm ship \"commit message\"  — verify:cross → commit → push 한 번에"
    echo ""
    echo "Emergency skip:  git commit --no-verify / git push --no-verify"
    ;;

  uninstall)
    uninstall_hook "pre-commit"
    uninstall_hook "pre-push"
    ;;

  *)
    echo "Usage: $0 [install|uninstall]"
    exit 1
    ;;
esac
