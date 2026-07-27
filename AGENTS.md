# PageComet 模板维护规范

## 仓库职责

开始修改前必须执行 `git remote -v`、`git status --short --branch` 和 `git branch -vv`：

- 本仓库的 `origin` 必须指向 `shaun17/PageComet`，这里只维护所有使用者都能复用的模板能力。
- 个性化站点属于独立下游仓库；不得把下游内容、凭据、资源或部署配置提交到 PageComet。
- 不得用 linked worktree 代替模板与下游站点的独立工程，也不得覆盖用户尚未提交的修改。

## 可进入模板的修改

模板修改必须同时满足以下条件：

1. 不依赖姓名、域名、个人文案、私有数据源、个人路由或专属资源。
2. 使用 `site.config.example.mjs` 与 fixture 数据可以完整运行。
3. 包含可复用实现、示例配置与对应测试，不包含下游接入代码。

同时包含通用实现和下游接入的修改必须拆成两个独立提交。PageComet 只接收通用提交；下游接入提交留在对应下游仓库。

## 贡献流程

1. 更新 `origin/main`，从它创建 `contrib/<功能名>` 分支。
2. 如果通用改动最初出现在下游仓库，只能 cherry-pick 其中的纯通用提交；混合提交必须重新提炼，禁止整体移入模板。
3. 逐项检查暂存区，确认不含 `.env`、真实配置、缓存、构建产物、个人内容、个人资源或本机任务文件。
4. 执行 `npm ci`、`REPOSITORY_ROLE=template npm run check:repository-boundary` 和 `npm test`。
5. 推送贡献分支，向 `shaun17/PageComet:main` 创建 PR；Fixture CI 成功后才能合并。
6. 下游站点自行获取并合并更新后的 PageComet 主线，不用下游 `main` 充当回流模板的中转分支。

受保护的 `main` 禁止直接推送、强推和删除；所有通用优化都必须经过 PR 与 `test` 检查。

## 代码与提交要求

- 使用 `ast-grep` 做代码结构搜索；只有在明确要求时才退回纯文本搜索。
- 需要库、API、安装或配置资料时先使用 Context7；不可用时只查官方文档。
- 所有函数和关键逻辑必须有清楚的中文注释。
- 未明确要求时不要新增 README、设计说明或其他文档。
- 修复根因并完成整个功能，不提交临时绕过方案或半成品。
