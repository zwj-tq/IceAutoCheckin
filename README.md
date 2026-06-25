# IceAutoCheckin

使用 GitHub Actions 定时执行自动打卡。

脚本会按账号依次执行：

1. 登录获取最新 token
2. 携带 token 调用打卡接口
3. 在日志中输出精简结果

## 文件说明

- `checkin.py`
  负责登录、提取 token、发起打卡请求。
- `.github/workflows/checkin.yml`
  GitHub Actions 工作流，默认每 3 小时执行一次，也支持手动触发。
- `requirements.txt`
  Python 依赖列表。
- `test-local.ps1`
  本地 PowerShell 测试脚本。
  这个文件已经被 `.gitignore` 忽略，不会推送到远程仓库。

## 运行效果

成功时日志类似：

```text
tianqing login: success
tianqing: 距离下次打卡还剩 131 分钟
```

如果请求失败，会输出类似：

```text
tianqing: 请求失败: HTTPConnectionPool(...)
```

## GitHub Secrets 配置

在仓库中进入：

`Settings -> Secrets and variables -> Actions`

然后添加以下 Secret。

### 必填

- `ACCOUNTS_JSON`
- `BASE_URL` 或 `CHECKIN_URL`
- `BASE_URL` 或 `LOGIN_URL`

最推荐的方式是直接配置 `BASE_URL`，这样登录和打卡地址都会自动拼接。

### 常用

- `TOKEN_PATH`
- `CHECKIN_TOKEN_LOCATION`
- `CHECKIN_TOKEN_KEY`
- `CHECKIN_TOKEN_PREFIX`
- `REQUEST_TIMEOUT_SECONDS`

## Secret 示例

### 1. 账号列表

`ACCOUNTS_JSON`

```json
[
  {
    "name": "user1",
    "qq": "your_qq_1",
    "password": "your_password_1"
  },
  {
    "name": "user2",
    "qq": "your_qq_2",
    "password": "your_password_2"
  }
]
```

每个账号至少需要：

- `qq`
- `password`

`name` 可选，用于日志展示。没填时会退回使用 `qq`。

### 2. 基础地址

`BASE_URL`

```text
http://your-server
```

配置后脚本会自动拼接：

- 登录地址：`/api/user/login`
- 打卡地址：`/api/playercenter/dakaApi`

如果你不想用 `BASE_URL`，也可以分别配置：

- `LOGIN_URL`
- `CHECKIN_URL`

### 3. 登录请求

如果登录接口保持当前格式，通常只需要：

`LOGIN_METHOD`

```text
POST
```

`LOGIN_PARAMS_JSON`

```json
{"qq":"{{qq}}","password":"{{password}}"}
```

如果你的登录接口不是 query/form 这种形式，也可以改用：

- `LOGIN_HEADERS_JSON`
- `LOGIN_FORM_JSON`
- `LOGIN_JSON_BODY`

## 4. Token 提取

如果登录响应中的 token 位于：

```json
{"code":1,"data":{"token":"..."}}
```

那么可以设置：

`TOKEN_PATH`

```text
data.token
```

如果不设置，脚本也会尝试自动识别这些常见路径：

- `token`
- `access_token`
- `data.token`
- `data.access_token`
- `result.token`
- `result.access_token`

## 5. 打卡接口

对于你当前这个站点，通常默认值已经够用：

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

也就是说，脚本会把登录得到的 token 放到请求头里的 `token` 字段。

如果你的目标接口不是这种格式，还可以自定义：

- `CHECKIN_HEADERS_JSON`
- `CHECKIN_PARAMS_JSON`
- `CHECKIN_FORM_JSON`
- `CHECKIN_JSON_BODY`

例如：

`CHECKIN_JSON_BODY`

```json
{"user":"{{qq}}","remark":"auto checkin"}
```

支持的占位符包括：

- `{{qq}}`
- `{{password}}`
- `{{token}}`
- 账号对象中的其他自定义字段

这些占位符可用于：

- URL
- headers
- query params
- form
- JSON body

## 本地测试

你可以直接运行：

```powershell
.\test-local.ps1
```

它会优先使用仓库下的：

```text
.\.venv\Scripts\python.exe
```

如果不存在，再回退到系统里的 `python`。

## GitHub Actions 定时

当前工作流配置在 [checkin.yml](.github/workflows/checkin.yml) 中：

```text
17 */3 * * *
```

表示按 UTC 时间每 3 小时执行一次，在第 17 分钟触发。

如果你在中国时区使用，大致相当于：

- `08:17`
- `11:17`
- `14:17`
- `17:17`
- `20:17`
- `23:17`
- `02:17`
- `05:17`

具体以 GitHub Actions 实际调度为准。

## 查看运行日志

进入仓库：

`Actions -> Auto Checkin -> 某一次运行记录 -> run-checkin -> Run checkin`

就能看到输出日志。

## 当前最简配置建议

对于你现在这个项目，通常最少只要配置：

- `ACCOUNTS_JSON`
- `BASE_URL`
- `TOKEN_PATH`

推荐值如下：

`BASE_URL`

```text
http://your-server
```

`TOKEN_PATH`

```text
data.token
```

## 注意事项

- 不要把真实账号密码写进仓库文件中。
- `test-local.ps1` 仅用于本地测试，建议继续只放本地，不要取消忽略。
- 如果 `BASE_URL`、`LOGIN_URL`、`CHECKIN_URL` 同时存在，脚本会优先使用显式的 `LOGIN_URL` / `CHECKIN_URL`。
- 如果之前在当前终端手动设置过旧的 `LOGIN_URL` 或 `CHECKIN_URL`，即使你修改了 `BASE_URL`，旧值仍然可能继续生效。需要先清掉环境变量再测试。
