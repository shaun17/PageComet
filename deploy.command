#!/bin/zsh

set -u

# 双击脚本时终端的工作目录不固定，因此始终切换到网站项目目录。
project_dir="${0:A:h}"
cd "$project_dir" || exit 1

exit_status=0

# 先验证基础运行环境，避免依赖安装到一半才发现 Node.js 版本不兼容。
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  exit_status=1
  echo "未找到 Node.js 或 npm。请先安装 Node.js 22.13 或更高版本。"
elif ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 13) ? 0 : 1)'; then
  exit_status=1
  echo "当前 Node.js 版本过低。请升级到 22.13 或更高版本。"
elif [[ ! -f "$project_dir/.env" ]]; then
  exit_status=1
  echo "缺少 .env。请先复制 .env.example，并填写 Notion 与 Cloudflare Pages 配置。"
elif [[ ! -f "$project_dir/site.config.mjs" ]]; then
  exit_status=1
  echo "缺少 site.config.mjs。请先复制 site.config.example.mjs，并填写自己的公开站点信息。"
# 密钥文件只允许当前用户读取；每次发布前主动收紧权限，避免复制后沿用 0644。
elif ! /bin/chmod 600 "$project_dir/.env"; then
  exit_status=1
  echo "无法将 .env 权限设置为 600，请检查文件所有者。"
elif ! node --env-file="$project_dir/.env" -e 'for (const name of ["NOTION_TOKEN", "NOTION_DATA_SOURCE_ID", "CLOUDFLARE_PAGES_PROJECT"]) { if (!process.env[name]?.trim()) { console.error(`缺少环境变量：${name}`); process.exitCode = 1; } }'; then
  exit_status=1
  echo "请补全 .env 后重新发布。"
fi

# 锁文件、系统架构或 Node ABI 变化时重新安装，避免跨机器复用不兼容的原生依赖。
if (( exit_status == 0 )); then
  lock_hash="$(/usr/bin/shasum -a 256 "$project_dir/package-lock.json" | /usr/bin/awk '{print $1}')"
  runtime_signature="$(node -p '[process.platform, process.arch, process.versions.modules].join("-")')"
  dependency_fingerprint="${lock_hash}:${runtime_signature}"
  dependency_marker="$project_dir/node_modules/.package-lock-runtime.sha256"
  installed_fingerprint=""
  [[ -f "$dependency_marker" ]] && installed_fingerprint="$(<"$dependency_marker")"

  # 缓存标记存在但依赖被手动裁剪或损坏时，同样执行完整恢复。
  if [[ "$installed_fingerprint" != "$dependency_fingerprint" ]] || ! npm ls --depth=0 --include=dev --silent >/dev/null 2>&1; then
    echo "正在安装项目依赖……"
    # 显式包含构建依赖，防止机器级 NODE_ENV 或 npm omit 配置跳过 Astro、TypeScript 与 Wrangler。
    if npm ci --include=dev; then
      print -r -- "$dependency_fingerprint" > "$dependency_marker"
    else
      exit_status=1
      echo "依赖安装失败，请保留上方错误信息后再排查。"
    fi
    echo
  fi
fi

# API Token 由隔离部署脚本按白名单传入；没有 Token 时才检查本机 OAuth 状态。
uses_cloudflare_token=0
if (( exit_status == 0 )) && node --env-file="$project_dir/.env" -e 'process.exit(process.env.CLOUDFLARE_API_TOKEN?.trim() && process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ? 0 : 1)'; then
  uses_cloudflare_token=1
fi

# Cloudflare OAuth 授权保存在当前机器；首次运行时打开浏览器登录。
if (( exit_status == 0 && uses_cloudflare_token == 0 )) && ! "$project_dir/node_modules/.bin/wrangler" whoami --json >/dev/null 2>&1; then
  echo "当前机器尚未登录 Cloudflare，正在打开授权页面……"
  if ! "$project_dir/node_modules/.bin/wrangler" login --use-keyring; then
    exit_status=1
    echo "Cloudflare 登录失败，请保留上方错误信息后再排查。"
  elif ! "$project_dir/node_modules/.bin/wrangler" whoami --json >/dev/null 2>&1; then
    exit_status=1
    echo "Cloudflare 授权尚未生效，请重新运行发布脚本。"
  fi
  echo
fi

# 复用项目现有发布流程，构建或验证失败时不会上传不完整的网站。
if (( exit_status == 0 )); then
  echo "正在读取 Notion 内容、生成静态网站并发布到 Cloudflare Pages……"
  echo
  if npm run deploy; then
    echo
    site_url="$(node --input-type=module -e 'import { siteConfig } from "./site.config.mjs"; process.stdout.write(siteConfig.origin)')"
    echo "发布完成：$site_url"
  else
    exit_status=1
    echo
    echo "发布失败，请保留上方错误信息后再排查。"
  fi
fi

echo
terminal_tty="$(tty 2>/dev/null || true)"
read -r "reply?按回车键关闭窗口……"

# Terminal 可能被设置为保留已结束的窗口；按当前 TTY 精确关闭本次发布所在的窗口或标签页。
if [[ "${TERM_PROGRAM:-}" == "Apple_Terminal" && "$terminal_tty" == /dev/* ]]; then
  /usr/bin/osascript \
    -e 'on run argv' \
    -e 'set targetTTY to item 1 of argv' \
    -e 'delay 0.3' \
    -e 'tell application "Terminal"' \
    -e 'repeat with terminalWindow in windows' \
    -e 'repeat with terminalTab in tabs of terminalWindow' \
    -e 'if (tty of terminalTab) is targetTTY then' \
    -e 'if (count of tabs of terminalWindow) is 1 then' \
    -e 'close terminalWindow' \
    -e 'else' \
    -e 'close terminalTab' \
    -e 'end if' \
    -e 'return' \
    -e 'end if' \
    -e 'end repeat' \
    -e 'end repeat' \
    -e 'end tell' \
    -e 'end run' \
    "$terminal_tty" >/dev/null 2>&1 &!
fi

exit "$exit_status"
