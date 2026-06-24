# IceAutoCheckin

Use GitHub Actions to log in every 3 hours, fetch a fresh token, and then call the target check-in API for one or more accounts.

## Files

- `checkin.py`: logs in for each account, extracts the token, and calls the check-in API.
- `.github/workflows/checkin.yml`: scheduled workflow that runs every 3 hours.
- `requirements.txt`: Python dependency list.

## Required GitHub Secrets

Add these in `Settings -> Secrets and variables -> Actions`.

### Required

- `ACCOUNTS_JSON`
- `CHECKIN_URL` or `BASE_URL`

### Usually needed

- `BASE_URL`
- `TOKEN_PATH`
- `CHECKIN_TOKEN_LOCATION`
- `CHECKIN_TOKEN_KEY`
- `CHECKIN_TOKEN_PREFIX`

`LOGIN_URL` is optional because the script defaults to:

```text
http://114.66.28.189:56999/api/user/login
```

## Secret examples

### 1. Multiple accounts

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

### 2. Login request

If your login API stays the same, you can usually set only `BASE_URL`:

`BASE_URL`

```text
http://114.66.28.189:56999
```

Then the script will automatically use:

- login: `/api/user/login`
- check-in: `/api/playercenter/dakaApi`

If you prefer, you can still set full URLs directly with `LOGIN_URL` and `CHECKIN_URL`.

If your login API stays the same, you usually do not need to set these.

`LOGIN_METHOD`

```text
POST
```

`LOGIN_PARAMS_JSON`

```json
{"qq":"{{qq}}","password":"{{password}}"}
```

### 3. Token extraction

Set `TOKEN_PATH` to the field path returned by the login API, for example:

```text
data.token
```

If the login response is one of these common shapes, the script can detect it automatically:

- `{"token":"..."}`
- `{"access_token":"..."}`
- `{"data":{"token":"..."}}`
- `{"data":{"access_token":"..."}}`

### 4. Check-in API

For the current ICE site, the frontend sends the token in a header named `token` with no prefix, so these built-in defaults are usually already correct:

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

If your target check-in API is different and the token goes in another request field:

`CHECKIN_TOKEN_LOCATION`

```text
header
```

`CHECKIN_TOKEN_KEY`

```text
Authorization
```

`CHECKIN_TOKEN_PREFIX`

```text
Bearer 
```

If your check-in API also needs fixed params or body:

`CHECKIN_PARAMS_JSON`

```json
{"foo":"bar"}
```

`CHECKIN_JSON_BODY`

```json
{"user":"{{qq}}","remark":"auto checkin"}
```

The placeholders `{{qq}}`, `{{password}}`, `{{token}}`, and account custom fields are supported in URL, headers, params, form, and JSON body.

## Schedule

The workflow runs at:

```text
17 */3 * * *
```

This means every 3 hours at minute 17 in UTC. You can adjust it in `.github/workflows/checkin.yml`.

## What you still need to fill in

For the current ICE site, you can usually get started with just:

- `ACCOUNTS_JSON`
- `BASE_URL`

If your target API is different, these may still need to be configured:

- target check-in URL
- whether the token goes in header, query, form, or JSON
- exact token field name and prefix
- any extra request params or body fields
