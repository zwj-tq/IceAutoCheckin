import json
import logging
import os
import sys
from copy import deepcopy
from typing import Any
from urllib.parse import urljoin

import requests


DEFAULT_LOGIN_PATH = "/api/user/login"
DEFAULT_CHECKIN_PATH = "/api/playercenter/dakaApi"
DEFAULT_CHECKIN_TOKEN_LOCATION = "header"
DEFAULT_CHECKIN_TOKEN_KEY = "token"
DEFAULT_CHECKIN_TOKEN_PREFIX = ""
COMMON_TOKEN_PATHS = (
    "token",
    "access_token",
    "data.token",
    "data.access_token",
    "result.token",
    "result.access_token",
)


def setup_logging() -> None:
    logging.basicConfig(
        level=logging.CRITICAL,
        format="%(asctime)s [%(levelname)s] %(message)s",
    )


def env_str(name: str, default: str | None = None) -> str | None:
    value = os.getenv(name)
    if value is None or value == "":
        return default
    return value


def env_json(name: str, default: Any) -> Any:
    raw = env_str(name)
    if raw is None:
        return deepcopy(default)
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"{name} is not valid JSON: {exc}") from exc


def resolve_placeholders(value: Any, context: dict[str, Any]) -> Any:
    if isinstance(value, str):
        result = value
        for key, item in context.items():
            result = result.replace(f"{{{{{key}}}}}", str(item))
        return result
    if isinstance(value, list):
        return [resolve_placeholders(item, context) for item in value]
    if isinstance(value, dict):
        return {key: resolve_placeholders(item, context) for key, item in value.items()}
    return value


def build_url(base_url: str, path: str) -> str:
    normalized_base_url = base_url.rstrip("/") + "/"
    return urljoin(normalized_base_url, path.lstrip("/"))


def resolve_request_url(
    url_env_name: str,
    *,
    base_path: str,
    context: dict[str, Any],
    fallback_url: str | None = None,
) -> str | None:
    raw_url = env_str(url_env_name)
    if raw_url:
        return resolve_placeholders(raw_url, context)

    raw_base_url = env_str("BASE_URL")
    if raw_base_url:
        base_url = resolve_placeholders(raw_base_url, context)
        return build_url(str(base_url), base_path)

    if fallback_url is not None:
        return resolve_placeholders(fallback_url, context)

    return None


def deep_get(data: Any, path: str) -> Any:
    current = data
    for part in path.split("."):
        if isinstance(current, dict) and part in current:
            current = current[part]
        else:
            return None
    return current


def find_token(payload: Any, token_path: str | None) -> str:
    if token_path:
        token = deep_get(payload, token_path)
        if token:
            return str(token)
        raise ValueError(f"Token not found at TOKEN_PATH={token_path}")

    for path in COMMON_TOKEN_PATHS:
        token = deep_get(payload, path)
        if token:
            return str(token)

    raise ValueError("Unable to locate token in login response; set TOKEN_PATH")


def login_error_message(payload: Any) -> str | None:
    if not isinstance(payload, dict):
        return None

    code = payload.get("code")
    message = payload.get("msg") or payload.get("message") or payload.get("error")

    if isinstance(code, bool):
        if code is False:
            return str(message or "Login failed")
        return None

    if code is None:
        success = payload.get("success")
        ok = payload.get("ok")
        if success is False or ok is False:
            return str(message or "Login failed")
        return None

    if str(code) in {"0", "200"}:
        return None

    return str(message or f"Login failed with code={code}")


def send_request(
    name: str,
    *,
    session: requests.Session,
    url: str,
    method: str,
    headers: dict[str, Any],
    params: dict[str, Any],
    form: dict[str, Any] | None,
    json_body: Any,
    timeout: int,
) -> requests.Response:
    logging.info("%s request method=%s url=%s", name, method.upper(), url)
    response = session.request(
        method=method.upper(),
        url=url,
        headers=headers,
        params=params,
        data=form,
        json=json_body,
        timeout=timeout,
    )
    logging.info("%s status=%s", name, response.status_code)
    logging.info("%s final url=%s", name, response.request.url)
    try:
        response.raise_for_status()
    except requests.HTTPError:
        logging.error("%s response=%s", name, response.text[:500])
        raise
    return response


def parse_json_response(response: requests.Response, label: str) -> Any:
    try:
        return response.json()
    except ValueError as exc:
        raise ValueError(f"{label} did not return JSON: {response.text[:300]}") from exc


def try_parse_json_response(response: requests.Response) -> Any | None:
    try:
        return response.json()
    except ValueError:
        return None


def load_accounts() -> list[dict[str, Any]]:
    accounts = env_json("ACCOUNTS_JSON", [])
    if not isinstance(accounts, list) or not accounts:
        raise ValueError("ACCOUNTS_JSON must be a non-empty JSON array")

    for index, account in enumerate(accounts, start=1):
        if not isinstance(account, dict):
            raise ValueError(f"Account #{index} must be a JSON object")
        if "qq" not in account or "password" not in account:
            raise ValueError(f"Account #{index} must include qq and password")
    return accounts


def login(account: dict[str, Any], timeout: int, session: requests.Session) -> str:
    context = deepcopy(account)
    account_name = str(account.get("name") or account["qq"])
    url = resolve_request_url(
        "LOGIN_URL",
        base_path=DEFAULT_LOGIN_PATH,
        context=context,
    )
    if not url:
        raise ValueError("LOGIN_URL or BASE_URL is required")
    method = env_str("LOGIN_METHOD", "POST")
    headers = resolve_placeholders(env_json("LOGIN_HEADERS_JSON", {}), context)
    params = resolve_placeholders(
        env_json("LOGIN_PARAMS_JSON", {"qq": "{{qq}}", "password": "{{password}}"}),
        context,
    )
    form = resolve_placeholders(env_json("LOGIN_FORM_JSON", None), context)
    json_body = resolve_placeholders(env_json("LOGIN_JSON_BODY", None), context)

    response = send_request(
        "login",
        session=session,
        url=url,
        method=method,
        headers=headers,
        params=params,
        form=form,
        json_body=json_body,
        timeout=timeout,
    )
    payload = parse_json_response(response, "Login response")
    if isinstance(payload, dict) and payload.get("msg") is not None:
        print(f"{account_name} login: {payload['msg']}")
    else:
        print(f"{account_name} login: {json.dumps(payload, ensure_ascii=True)[:500]}")
    logging.info("login response=%s", response.text)
    try:
        return find_token(payload, env_str("TOKEN_PATH"))
    except ValueError as exc:
        error_message = login_error_message(payload)
        if error_message:
            raise ValueError(error_message) from exc
        raise


def call_checkin(
    account: dict[str, Any],
    token: str,
    timeout: int,
    session: requests.Session,
) -> None:
    context = deepcopy(account)
    context["token"] = token
    account_name = str(account.get("name") or account["qq"])

    url = resolve_request_url(
        "CHECKIN_URL",
        base_path=DEFAULT_CHECKIN_PATH,
        context=context,
    )
    if not url:
        raise ValueError("CHECKIN_URL or BASE_URL is required")

    method = env_str("CHECKIN_METHOD", "POST")
    headers = resolve_placeholders(env_json("CHECKIN_HEADERS_JSON", {}), context)
    params = resolve_placeholders(env_json("CHECKIN_PARAMS_JSON", {}), context)
    form = resolve_placeholders(env_json("CHECKIN_FORM_JSON", None), context)
    json_body = resolve_placeholders(env_json("CHECKIN_JSON_BODY", None), context)

    token_location = env_str("CHECKIN_TOKEN_LOCATION", DEFAULT_CHECKIN_TOKEN_LOCATION)
    token_key = env_str("CHECKIN_TOKEN_KEY", DEFAULT_CHECKIN_TOKEN_KEY)
    token_prefix = env_str("CHECKIN_TOKEN_PREFIX", DEFAULT_CHECKIN_TOKEN_PREFIX)
    token_value = f"{token_prefix}{token}"

    if token_location == "header":
        headers[token_key] = token_value
    elif token_location == "query":
        params[token_key] = token_value
    elif token_location == "form":
        form = form or {}
        form[token_key] = token_value
    elif token_location == "json":
        if json_body is None:
            json_body = {}
        if not isinstance(json_body, dict):
            raise ValueError("CHECKIN_JSON_BODY must be a JSON object when token goes to json")
        json_body[token_key] = token_value
    elif token_location != "none":
        raise ValueError(
            "CHECKIN_TOKEN_LOCATION must be one of: header, query, form, json, none"
        )

    response = send_request(
        "checkin",
        session=session,
        url=url,
        method=method,
        headers=headers,
        params=params,
        form=form,
        json_body=json_body,
        timeout=timeout,
    )

    payload = try_parse_json_response(response)
    if isinstance(payload, dict) and payload.get("msg") is not None:
        print(f"{account_name}: {payload['msg']}")
    elif payload is not None:
        print(f"{account_name}: {json.dumps(payload, ensure_ascii=True)[:500]}")
    else:
        print(f"{account_name}: {response.text[:500]}")


def main() -> int:
    setup_logging()
    timeout = int(env_str("REQUEST_TIMEOUT_SECONDS", "30"))
    accounts = load_accounts()

    failures: list[str] = []
    for account in accounts:
        account_name = str(account.get("name") or account["qq"])
        logging.info("processing account=%s", account_name)
        try:
            session = requests.Session()
            token = login(account, timeout, session)
            call_checkin(account, token, timeout, session)
            logging.info("account=%s completed", account_name)
        except Exception as exc:  # noqa: BLE001
            failures.append(account_name)
            print(f"{account_name}: 请求失败: {exc}")
            logging.exception("account=%s failed: %s", account_name, exc)

    if failures:
        logging.error("failed accounts: %s", ", ".join(failures))
        return 1

    logging.info("all accounts completed successfully")
    return 0


if __name__ == "__main__":
    sys.exit(main())
