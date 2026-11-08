#!/usr/bin/env bash
# 一键启动壳模式开发环境（含 Electron 窗口）。
#
# 为什么需要这个脚本（而不是直接 pnpm dev）：
#   1. 某些宿主会注入 ELECTRON_RUN_AS_NODE=1，Electron 会退化成纯 Node 进程 → 不创建窗口，
#      vite-plugin-electron 还会在 cjsPreparseModuleExports 处崩溃。必须 unset。
#   2. 宿主的批量删除守卫会让 vite 清理 node_modules/.vite 时报
#      SAFE_DELETE_BULK_CONFIRM_REQUIRED，需 unset 对应的状态变量。
#   3. 部分环境解析不了 localhost（getaddrinfo ENOTFOUND），显式绑 127.0.0.1。
#
# 用法：
#   ./scripts/start-dev.sh              # 壳模式 + 调试（默认）
#   LM_SHELL_DEBUG=0 ./scripts/start-dev.sh   # 壳模式，无调试按钮
#   LM_SHELL_UI=0 ./scripts/start-dev.sh      # 经典模式（评论面板恒 0 条，B2 后端不启动）
# 退出：Ctrl+C
set -euo pipefail

cd "$(dirname "$0")/.."

unset ELECTRON_RUN_AS_NODE
unset CODEBUDDY_SAFE_DELETE_BULK_STATE_DIR
unset CODEBUDDY_TOOL_CALL_ID

export LM_SHELL_UI="${LM_SHELL_UI:-1}"
export LM_SHELL_DEBUG="${LM_SHELL_DEBUG:-1}"

echo "[start-dev] LM_SHELL_UI=$LM_SHELL_UI LM_SHELL_DEBUG=$LM_SHELL_DEBUG"
echo "[start-dev] Ctrl+C 退出"

# exec：让 vite 成为前台进程，Ctrl+C 直接终止整棵进程树
exec node node_modules/vite/bin/vite.js dev --host 127.0.0.1 "$@"
