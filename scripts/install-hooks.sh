#!/bin/bash
# AutoDev Agent — pre-commit hook 설치/제거
#
# 사용법:
#   pnpm hook:install    — pre-commit hook 설치
#   pnpm hook:uninstall  — pre-commit hook 제거

ACTION="${1:-install}"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HOOK_PATH="$PROJECT_DIR/.git/hooks/pre-commit"
SOURCE_PATH="$PROJECT_DIR/scripts/pre-commit.sh"

case "$ACTION" in
  install)
    if [ ! -f "$SOURCE_PATH" ]; then
      echo "❌ Source not found: $SOURCE_PATH"
      exit 1
    fi

    if [ -f "$HOOK_PATH" ]; then
      echo "⚠️  pre-commit hook already exists. Backing up to pre-commit.bak"
      cp "$HOOK_PATH" "$HOOK_PATH.bak"
    fi

    cp "$SOURCE_PATH" "$HOOK_PATH"
    chmod +x "$HOOK_PATH"

    echo "✅ pre-commit hook installed"
    echo ""
    echo "   Build + TypeScript check will run on every commit."
    echo "   Skip with:               git commit --no-verify"
    echo "   Enable Verify Agent:     AUTODEV_PRECOMMIT_VERIFY=1 git commit"
    echo "   Block on Verify failure: AUTODEV_PRECOMMIT_VERIFY_STRICT=1 git commit"
    ;;

  uninstall)
    if [ -f "$HOOK_PATH" ]; then
      rm "$HOOK_PATH"
      echo "✅ pre-commit hook removed"
      if [ -f "$HOOK_PATH.bak" ]; then
        mv "$HOOK_PATH.bak" "$HOOK_PATH"
        echo "   Previous hook restored from backup"
      fi
    else
      echo "No pre-commit hook to remove"
    fi
    ;;

  *)
    echo "Usage: $0 [install|uninstall]"
    exit 1
    ;;
esac
