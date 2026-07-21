# PageComet Agent 安装部署执行清单

这份清单供执行安装部署的 Agent 使用，也供站点所有者核对 Agent 正在做什么。配置字段、Notion schema、命令含义和安全边界以仓库根目录的 [`README.md`](../README.md) 为准；本文件只规定执行顺序和完成标准。

## 任务目标

把一个新的 PageComet 仓库配置成站点所有者自己的版本，完成 fixture 验证、真实 Notion 构建、静态产物安全检查、Cloudflare Pages 发布和线上验证。

只有同时满足以下条件，任务才算完成：

- 锁定依赖安装成功；
- `npm test` 全部通过；
- 真实 `npm run build` 与 `npm run verify:dist` 通过；
- Cloudflare Pages 部署成功；
- 预览地址和正式地址的代表性页面可访问；
- `.env`、`site.config.mjs` 和任何密钥均未进入 Git；
- 最终向站点所有者报告测试、构建、部署和线上验证结果。

## 执行原则

1. 先读取完整 README，再开始修改配置。
2. 已存在的仓库、`.env`、`site.config.mjs` 和用户改动都不得无条件覆盖。
3. 不在回复、命令输出、提交信息或日志中显示 Token、Data Source ID、账户 ID 等敏感值。
4. 不使用 `git add -f` 提交被忽略的个人配置。
5. Notion Integration 保持只读；没有明确授权时，不通过 API 写入或删除用户内容。
6. Cloudflare 登录、自定义域名和 DNS 变更涉及账户权限，应在对应步骤取得所有者授权。
7. 测试、真实构建或安全扫描失败时必须先修复根因，不得跳过检查直接上传。
8. 正式发布统一运行 `npm run deploy`，不要自行拼接一条缺少隔离或扫描的 Wrangler 命令。

## 需要所有者提供或确认的信息

| 信息 | 用途 | Agent 应如何获取 |
| --- | --- | --- |
| 品牌名、标题、简介、联系方式 | 填写 `site.config.mjs` | 只询问缺失字段，不自行编造个人资料 |
| 正式 HTTPS 域名或 Pages 域名 | `origin`、线上验证 | 没有自定义域名时先使用 `pages.dev` 地址 |
| Notion Integration Token | 构建时读取内容 | 让所有者通过安全输入方式写入本机 `.env` |
| 两个 Notion Data Source ID | 区分文章与流水账 | 让所有者确认来源，禁止根据模糊 URL 猜测 |
| Cloudflare Pages 项目名 | 创建和部署项目 | 由所有者确认一个账户内可用的名称 |
| Cloudflare 授权 | 创建项目、上传站点 | 优先让所有者完成浏览器 OAuth；无浏览器时使用安全注入的 API Token |

账户密码不属于本项目配置，Agent 不应索取。Agent 具备已登录浏览器能力时，也只能在用户明确授权后操作对应 Notion 或 Cloudflare 页面。

## 执行流程

### 1. 进入仓库并检查环境

如果当前还没有仓库：

```bash
git clone https://github.com/shaun17/PageComet.git pagecomet
cd pagecomet
```

如果已经位于仓库中，直接使用现有目录，不要重复克隆。先检查工作区和运行环境：

```bash
git status --short --branch
node --version
npm --version
```

Node.js 必须是 22.13 或更高版本。存在 `nvm` 时运行 `nvm use`；否则先安装兼容版本，再继续。不要在有未识别用户改动时重置、覆盖或清理工作区。

### 2. 安装依赖并验证零密钥基线

```bash
npm ci
npm test
```

这一步不读取用户的 Notion 或 Cloudflare 凭据。失败表示项目基线或本机环境有问题，应先解决再创建个人配置。

### 3. 初始化公开站点配置

仅在文件不存在时复制示例：

```bash
cp site.config.example.mjs site.config.mjs
```

如果 `site.config.mjs` 已存在，先读取并保留用户配置。按照 README 的“创建本机站点配置”填写所有者提供的公开资料，然后运行：

```bash
npm run validate:site-config
```

必须保留 `career`、`works`、`writing`、`journal` 四个固定路由键。不要把 `site.config.mjs` 加入 Git。

### 4. 准备或核对 Notion

按照 README 的“准备两个 Notion 内容源”核对以下对象：

1. 一个文章 Data Source，包含 README 表格列出的全部文章字段；
2. 一个独立流水账 Data Source，包含 README 表格列出的全部流水账字段；
3. 一个绑定流水账 Data Source 的私有 Form；
4. 一个同时连接两个 Data Source、且只有读取权限的 Integration；
5. 文章 Data Source 至少有一条满足发布条件的内容，除非所有者明确选择空站。

如果 Agent 有已登录浏览器并得到明确授权，可以在界面中协助创建和核对；否则应把 README 中对应字段表交给所有者完成。不要为了“全自动”索取账户密码，也不要把只读 Integration 擅自升级为写权限。

### 5. 初始化私密环境变量

仅在 `.env` 不存在时复制模板，并始终收紧权限：

```bash
cp .env.example .env
chmod 600 .env
```

让所有者通过安全方式填写：

- `NOTION_TOKEN`；
- `NOTION_DATA_SOURCE_ID`；
- `NOTION_JOURNAL_DATA_SOURCE_ID`；
- `CLOUDFLARE_PAGES_PROJECT`。

本机浏览器 OAuth 模式可以把 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID` 留空。无浏览器环境必须安全注入这两个值。读取配置时只判断“是否存在、格式是否有效”，不要把值打印出来。

### 6. 验证真实内容

```bash
npm run build
npm run verify:dist
```

构建成功后确认：

- 首页包含 01 职业经历、02 个人作品、03 文稿、04 流水账；
- `/journal/` 可以生成；
- 至少一篇文章详情页可以生成；
- 媒体引用都指向本地内容哈希文件；
- `verify:dist` 没有发现临时 Notion 地址、缺失资源或凭据。

需要视觉检查时运行 `npm run preview`，使用浏览器检查桌面与移动宽度。不要把 fixture 构建成功误报成真实内容已经可发布。

### 7. 登录 Cloudflare 并创建 Pages 项目

OAuth 模式：

```bash
npm run cloudflare:login
```

此命令打开浏览器时，让所有者亲自确认授权。然后核对 `.env` 中的项目名：项目不存在时执行一次 `npm run pages:create`；项目已经存在时跳过创建，避免误操作同名资源。

```bash
npm run pages:create
```

使用 API Token 时必须同时存在 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID`。Token 只授予当前 Pages 发布所需的最小权限。

### 8. 执行正式发布

从项目根目录运行并记录真实耗时：

```bash
npm run deploy
```

该命令已经包含 fixture 测试、真实 Notion 构建、安全扫描和 Cloudflare Pages Direct Upload。任何一步失败都表示尚未发布成功，不得只根据终端中较早出现的构建成功信息下结论。

### 9. 验证线上结果

从发布输出中取得本次 `pages.dev` 预览地址，并从 `site.config.mjs` 取得正式 `origin`。至少验证：

- 预览地址首页返回 200；
- 正式首页返回 200；
- 正式 `/journal/` 返回 200；
- 一篇正式文章详情页返回 200；
- 页面引用的 CSS 和代表性媒体资源可以加载；
- 首页四个入口和本地真实构建一致。

本机使用代理时，优先通过 `curl --noproxy '*'` 检查真实公网响应。Cloudflare 边缘节点可能短暂缓存旧资源；首次检查异常时等待片刻，并使用带版本查询参数的地址复查，再判断是否发布失败。

自定义域名尚未添加时，先以本次 `pages.dev` 地址完成验证，并明确告诉所有者还需在 Cloudflare Pages 中添加域名和 DNS。未经授权不要修改 DNS。

### 10. 检查 Git 与汇报结果

```bash
git status --short --branch
```

确认输出中没有 `.env`、`site.config.mjs` 或其他密钥文件。只有在所有者要求提交或推送时，才提交可公开跟踪的代码和文档改动。

最终汇报应包含：

- 安装与测试结果；
- 真实构建结果和页面数量；
- 安全扫描结果；
- 部署结果、实际耗时和预览地址；
- 正式域名与代表性页面的线上状态；
- 尚需所有者完成的账户或 DNS 操作；
- 当前 Git 状态，以及是否已经提交或推送。

## 常见阻塞

| 现象 | 优先检查 |
| --- | --- |
| Notion API 返回 404 | Integration 是否连接了两个正确的 Data Source，ID 是否来自 Manage data sources |
| schema 校验失败 | 字段名称、Notion 类型和 Select 选项是否与 README 完全一致 |
| 构建提示没有已发布内容 | 文章状态、必填字段、Integration 权限；不要默认打开 `ALLOW_EMPTY_SITE` |
| 流水账为空 | Form 是否绑定了正确 Data Source，记录是否勾选了 `隐藏` |
| Wrangler 未登录 | 完成 OAuth，或安全提供 API Token 与账户 ID |
| Pages 项目不存在 | 核对项目名后运行一次 `npm run pages:create` |
| 发布后首个资源请求 404 | 等待边缘缓存传播，使用版本查询参数复查 |
| 安全扫描失败 | 查明真实泄漏或临时 URL 来源，不得跳过 `verify:dist` |
