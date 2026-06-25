# IceAutoCheckin

这是一个基于 Cloudflare Workers 的自动打卡项目。

当前版本只保留 Workers 部署结构，不再包含：

- Python 脚本版本
- GitHub Actions 定时版本
- 本地 PowerShell 测试脚本

## 当前结构

- `src/worker.js`
  Worker 主入口，负责登录、提取 token、发起打卡，并输出结果。
- `wrangler.toml`
  Wrangler 配置文件，包含 Worker 名称、入口文件和 cron 配置。
- `package.json`
  Node 依赖和常用命令。
- `.dev.vars.example`
  本地开发环境变量示例。

## 输出示例

成功时：

```text
tianqing login: success
tianqing: 距离下次打卡还剩 131 分钟
```

失败时：

```text
tianqing: 请求失败: ...
```

## 安装

先安装 Node.js 和 npm，然后在项目目录执行：

```bash
npm install
```

登录 Cloudflare：

```bash
npx wrangler login
```

## 本地开发

复制本地环境变量模板：

```bash
cp .dev.vars.example .dev.vars
```

把 `.dev.vars` 改成你的真实配置后，启动本地开发：

```bash
npm run dev
```

可用入口：

- `GET /health`
- `GET /`
- `POST /`

其中 `GET /` 和 `POST /` 都会手动触发一次打卡。

## 必要环境变量

推荐最少配置：

- `ACCOUNTS_JSON`
- `BASE_URL`
- `TOKEN_PATH`

也支持显式配置：

- `LOGIN_URL`
- `CHECKIN_URL`

如果同时存在完整 URL 和 `BASE_URL`，会优先使用：

- `LOGIN_URL`
- `CHECKIN_URL`

## 变量示例

### 1. 账号列表

`ACCOUNTS_JSON`

```json
[
  {
    "name": "user1",
    "qq": "your_qq_1",
    "password": "your_password_1"
  }
]
```

### 2. 基础地址

`BASE_URL`

```text
http://your-server
```

设置后会自动拼接：

- 登录路径：`/api/user/login`
- 打卡路径：`/api/playercenter/dakaApi`

### 3. 登录配置

`LOGIN_METHOD`

```text
POST
```

`LOGIN_PARAMS_JSON`

```json
{"qq":"{{qq}}","password":"{{password}}"}
```

### 4. Token 路径

`TOKEN_PATH`

```text
data.token
```

### 5. 打卡鉴权默认值

`CHECKIN_TOKEN_LOCATION`

```text
header
```

`CHECKIN_TOKEN_KEY`

```text
token
```

`CHECKIN_TOKEN_PREFIX`

```text

```

### 6. 超时

`REQUEST_TIMEOUT_SECONDS`

```text
30
```

## 配置 Cloudflare Secrets

使用 Wrangler 配置：

```bash
npx wrangler secret put ACCOUNTS_JSON
npx wrangler secret put BASE_URL
npx wrangler secret put TOKEN_PATH
```

也可以在 Cloudflare Dashboard 中配置：

`Workers & Pages -> 你的 Worker -> Settings -> Variables and Secrets`

## 常用命令

本地开发：

```bash
npm run dev
```

部署：

```bash
npm run deploy
```

构建检查：

```bash
npm run check
```

## 定时触发

当前 `wrangler.toml` 中配置的是：

```toml
[triggers]
crons = ["53 * * * *"]
```

表示每小时第 53 分钟触发一次。

修改后重新部署即可生效。

## 手动触发

部署后可以直接访问 Worker URL：

```bash
curl https://your-worker.your-subdomain.workers.dev/
```

它会返回本次执行日志。

## 注意事项

- `account.json`
- `.dev.vars`
- `node_modules/`
- `.wrangler/`

这些都不应该提交到远程仓库。
