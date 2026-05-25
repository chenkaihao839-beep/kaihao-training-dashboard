# 自动化部署说明

目标：你只在 OneDrive Word 里记录训练，其余自动完成。

## 架构

```text
OneDrive / Word
  -> GitHub Actions 同步任务
  -> sync_from_docx.py 解析训练记录
  -> training-dashboard/data/training-data.json
  -> GitHub Pages 发布网站
```

## 已准备好的文件

- `training-dashboard/data/training-data.json`：网站读取的数据
- `training-dashboard/data/training-data.js`：本地 file:// 版本的数据 fallback
- `training-dashboard/scripts/download_onedrive_docx.py`：从 OneDrive 下载 Word
- `training-dashboard/scripts/sync_from_docx.py`：解析 Word 并更新数据文件
- `.github/workflows/sync-training-data.yml`：自动同步数据
- `.github/workflows/pages.yml`：部署 GitHub Pages

## GitHub Secrets

在 GitHub 仓库中添加：

- `MS_CLIENT_ID`
- `MS_CLIENT_SECRET`
- `MS_REFRESH_TOKEN`

在 GitHub Repository Variables 中添加：

- `ONEDRIVE_DOCX_PATH`

推荐值：

```text
训练/00_当前Cycle训练记录.docx
```

## 获取 Microsoft refresh token

先在 Microsoft Entra / Azure App registrations 创建一个应用：

1. Redirect URI 加：`http://localhost`
2. API permissions 加 Microsoft Graph delegated permission：`Files.Read`
3. 创建 client secret

生成授权 URL：

```bash
python training-dashboard/scripts/get_microsoft_refresh_token.py \
  --client-id "<MS_CLIENT_ID>"
```

打开输出的 URL，登录并同意权限。浏览器跳到 `http://localhost/?code=...` 后，复制 `code` 参数，再执行：

```bash
python training-dashboard/scripts/get_microsoft_refresh_token.py \
  --client-id "<MS_CLIENT_ID>" \
  --client-secret "<MS_CLIENT_SECRET>" \
  --code "<AUTH_CODE_FROM_CALLBACK>"
```

输出里的 `refresh_token` 就是 GitHub Secret `MS_REFRESH_TOKEN`。

## Microsoft Graph 权限

Azure / Microsoft Entra 应用需要请求：

```text
offline_access
Files.Read
```

`offline_access` 用于让 GitHub Actions 用 refresh token 自动换取 access token，`Files.Read` 用于读取 OneDrive 中的 Word 文件。

参考：

- Microsoft Graph 下载文件内容：https://learn.microsoft.com/en-us/graph/api/driveitem-get-content
- Microsoft identity refresh token：https://learn.microsoft.com/en-us/azure/active-directory/develop/refresh-tokens
- `offline_access` scope：https://learn.microsoft.com/en-us/entra/identity-platform/scopes-oidc

## GitHub Pages

仓库 Settings -> Pages：

- Source: `GitHub Actions`

之后 `pages.yml` 会把 `training-dashboard/` 发布成网站。

## 自动触发方式

当前 workflow 支持三种触发：

1. 每 30 分钟自动同步一次
2. 手动点 GitHub Actions 里的 `Sync training data from OneDrive`
3. Power Automate 监听 OneDrive 文件修改后，触发 GitHub `repository_dispatch`

Power Automate HTTP 请求：

```http
POST https://api.github.com/repos/<owner>/<repo>/dispatches
Authorization: Bearer <GITHUB_PAT>
Accept: application/vnd.github+json
Content-Type: application/json

{
  "event_type": "onedrive_training_updated"
}
```

`GITHUB_PAT` 需要允许触发当前仓库的 Actions。私有仓库通常需要 `repo` 权限；公开仓库可使用更窄权限。

参考：

- GitHub repository dispatch：https://docs.github.com/en/webhooks/webhook-events-and-payloads#repository_dispatch
- GitHub Pages custom workflows：https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages

## 日常使用

你只做：

1. 手机 Word 打开 OneDrive 的 `00_当前Cycle训练记录.docx`
2. 训练时填写
3. 保存

系统自动做：

1. GitHub Actions 下载最新 Word
2. 解析新增训练记录
3. 更新 JSON/JS 数据文件
4. GitHub Pages 发布新网站

## 注意

Word 模板结构越稳定，解析越稳。尽量保持动作名、日期、体重、训练时长、实际完成的表格结构不变。
