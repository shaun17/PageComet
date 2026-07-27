# PageComet 与下游站点维护规范

## 开始工作前确认仓库角色

每次修改前先执行 `git remote -v`、`git status --short --branch` 和 `git branch -vv`，再按远端判断角色：

- `/Users/coco/code/pagecomet`：`origin` 必须是 `shaun17/PageComet`，这里只维护可复用模板。
- `/Users/coco/code/website`：`origin` 必须是 `shaun17/wenren-site`，`upstream` 必须是 `shaun17/PageComet`，这是包含 3D 与个人内容的生产站。
- 其他远端：视为独立的 PageComet 下游站点；不得在未明确授权时向上述两个仓库推送。

不得用 linked worktree 代替这两个独立工程，也不得重写、清理或覆盖用户尚未提交的内容。

## 修改分类

修改前必须把需求归入以下一种类型：

1. 通用模板能力：不依赖姓名、域名、个人文案、Notion 数据源、3D 模型或个人路由，使用 `site.config.example.mjs` 和 fixture 数据可以完整工作。
2. 个人站能力：涉及 `/avatar/`、`public/3d/`、空间肖像、个人内容、个人部署或 `wenren.cc`。
3. 混合修改：同时包含通用能力与个人接入，必须拆成两个独立提交，先完成通用提交，再完成个人提交。

## 通用模板提交

通用优化只在 `/Users/coco/code/pagecomet` 开发：

1. 从最新 `origin/main` 创建 `contrib/<功能名>` 分支。
2. 只提交模板通用代码、示例配置和 fixture 测试。
3. 执行 `npm ci`、`npm test` 和 `npm run verify:dist`。
4. 推送功能分支并向 `shaun17/PageComet:main` 创建 PR；不得直接把个人站分支合入 PageComet。
5. PR 和 Fixture CI 成功后，在个人站执行 `git fetch upstream --prune` 与 `git merge upstream/main`，再运行个人站完整测试。

如果通用优化最初出现在个人分支中，先在 `/Users/coco/code/pagecomet` 更新 `origin/main` 并创建 `contrib/<功能名>`，再把个人站里的纯通用提交 cherry-pick 到这个贡献分支。提交若混有个人内容，必须重新提炼通用部分，禁止整体 cherry-pick；不得先把它推入 `wenren-site/main` 作为回流 PageComet 的中转步骤。

## 个人站提交

个人功能只在 `/Users/coco/code/website` 开发并进入 `shaun17/wenren-site`：

1. `main` 是包含模板能力与个人功能的生产分支，不需要与 `PageComet/main` 保持相同文件树。
2. 3D 模型、空间肖像、个人页面与生产配置不得反向进入 PageComet。
3. 合并 PageComet 更新时使用 merge，不重写长期个人历史；冲突解决必须同时保留上游通用改进和个人接入。
4. 发布必须使用项目内置的 `npm run deploy`，并独立核验正式域名、关键路由、3D 资源与随机 404。

## 提交前检查

- 使用 `ast-grep` 做代码结构搜索；只有在明确要求时才退回纯文本搜索。
- 需要库、API、安装或配置资料时先使用 Context7；不可用时只查官方文档。
- 所有函数和关键逻辑必须有清楚的中文注释。
- 未明确要求时不要新增 README、设计说明或其他文档。
- PageComet 维护者在本地执行 `REPOSITORY_ROLE=template npm run check:repository-boundary`；GitHub Actions 会根据仓库身份自动执行同等严格检查。个人站执行 `npm run check:repository-boundary`。
- 提交前执行 `npm test`，并逐项检查暂存区，不能使用无范围审计的批量提交。
- PageComet 提交不得包含 `.env`、`site.config.mjs`、缓存、构建产物、个人内容、个人模型或本机定时任务文件。
