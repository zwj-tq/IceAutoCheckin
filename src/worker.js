const DEFAULT_LOGIN_PATH = "/api/user/login";
const DEFAULT_CHECKIN_PATH = "/api/playercenter/dakaApi";
const DEFAULT_CHECKIN_TOKEN_LOCATION = "header";
const DEFAULT_CHECKIN_TOKEN_KEY = "token";
const DEFAULT_CHECKIN_TOKEN_PREFIX = "";
const COMMON_TOKEN_PATHS = [
  "token",
  "access_token",
  "data.token",
  "data.access_token",
  "result.token",
  "result.access_token",
];

function envStr(env, name, defaultValue = null) {
  const value = env[name];
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }
  return String(value);
}

function envJson(env, name, defaultValue) {
  const raw = envStr(env, name);
  if (raw === null) {
    return structuredClone(defaultValue);
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${name} is not valid JSON: ${error.message}`);
  }
}

function resolvePlaceholders(value, context) {
  if (typeof value === "string") {
    let result = value;
    for (const [key, item] of Object.entries(context)) {
      result = result.replaceAll(`{{${key}}}`, String(item));
    }
    return result;
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolvePlaceholders(item, context));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolvePlaceholders(item, context)]),
    );
  }

  return value;
}

function buildUrl(baseUrl, path) {
  return new URL(path.replace(/^\/+/, ""), `${baseUrl.replace(/\/+$/, "")}/`).toString();
}

function resolveRequestUrl(env, urlEnvName, { basePath, context }) {
  const rawUrl = envStr(env, urlEnvName);
  if (rawUrl) {
    return resolvePlaceholders(rawUrl, context);
  }

  const rawBaseUrl = envStr(env, "BASE_URL");
  if (rawBaseUrl) {
    return buildUrl(resolvePlaceholders(rawBaseUrl, context), basePath);
  }

  return null;
}

function deepGet(data, path) {
  let current = data;
  for (const part of path.split(".")) {
    if (current && typeof current === "object" && part in current) {
      current = current[part];
    } else {
      return null;
    }
  }
  return current;
}

function findToken(payload, tokenPath) {
  if (tokenPath) {
    const token = deepGet(payload, tokenPath);
    if (token) {
      return String(token);
    }
    throw new Error(`Token not found at TOKEN_PATH=${tokenPath}`);
  }

  for (const path of COMMON_TOKEN_PATHS) {
    const token = deepGet(payload, path);
    if (token) {
      return String(token);
    }
  }

  throw new Error("Unable to locate token in login response; set TOKEN_PATH");
}

function loginErrorMessage(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const code = payload.code;
  const message = payload.msg || payload.message || payload.error;

  if (typeof code === "boolean") {
    return code ? null : String(message || "Login failed");
  }

  if (code === undefined || code === null) {
    if (payload.success === false || payload.ok === false) {
      return String(message || "Login failed");
    }
    return null;
  }

  if (String(code) === "0" || String(code) === "200" || String(code) === "1") {
    return null;
  }

  return String(message || `Login failed with code=${code}`);
}

function appendSearchParams(url, params) {
  if (!params || typeof params !== "object") {
    return url;
  }

  const finalUrl = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        finalUrl.searchParams.append(key, String(item));
      }
      continue;
    }

    finalUrl.searchParams.set(key, String(value));
  }
  return finalUrl.toString();
}

function toBodyAndContentType(form, jsonBody) {
  if (jsonBody !== null && jsonBody !== undefined) {
    return {
      body: JSON.stringify(jsonBody),
      contentType: "application/json;charset=UTF-8",
    };
  }

  if (form && typeof form === "object") {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(form)) {
      if (value === undefined || value === null) {
        continue;
      }

      if (Array.isArray(value)) {
        for (const item of value) {
          body.append(key, String(item));
        }
        continue;
      }

      body.append(key, String(value));
    }

    return {
      body: body.toString(),
      contentType: "application/x-www-form-urlencoded;charset=UTF-8",
    };
  }

  return {
    body: null,
    contentType: null,
  };
}

async function sendRequest(name, env, options) {
  const timeoutSeconds = options.timeout;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(`${name} timeout`), timeoutSeconds * 1000);

  try {
    let url = appendSearchParams(options.url, options.params);
    const headers = new Headers();
    for (const [key, value] of Object.entries(options.headers || {})) {
      if (value !== undefined && value !== null) {
        headers.set(key, String(value));
      }
    }

    const { body, contentType } = toBodyAndContentType(options.form, options.jsonBody);
    if (contentType && !headers.has("Content-Type")) {
      headers.set("Content-Type", contentType);
    }

    const response = await fetch(url, {
      method: options.method.toUpperCase(),
      headers,
      body,
      signal: controller.signal,
      redirect: "follow",
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
    }

    return response;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`${name} request timed out after ${timeoutSeconds} seconds`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function parseJsonResponse(response, label) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} did not return JSON: ${text.slice(0, 300)}`);
  }
}

async function tryParseJsonResponse(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function loadAccounts(env) {
  const accounts = envJson(env, "ACCOUNTS_JSON", []);
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error("ACCOUNTS_JSON must be a non-empty JSON array");
  }

  for (let index = 0; index < accounts.length; index += 1) {
    const account = accounts[index];
    if (!account || typeof account !== "object" || Array.isArray(account)) {
      throw new Error(`Account #${index + 1} must be a JSON object`);
    }
    if (!("qq" in account) || !("password" in account)) {
      throw new Error(`Account #${index + 1} must include qq and password`);
    }
  }

  return accounts;
}

async function login(account, env, timeoutSeconds) {
  const context = structuredClone(account);
  const accountName = String(account.name || account.qq);
  const url = resolveRequestUrl(env, "LOGIN_URL", {
    basePath: DEFAULT_LOGIN_PATH,
    context,
  });

  if (!url) {
    throw new Error("LOGIN_URL or BASE_URL is required");
  }

  const method = envStr(env, "LOGIN_METHOD", "POST");
  const headers = resolvePlaceholders(envJson(env, "LOGIN_HEADERS_JSON", {}), context);
  const params = resolvePlaceholders(
    envJson(env, "LOGIN_PARAMS_JSON", { qq: "{{qq}}", password: "{{password}}" }),
    context,
  );
  const form = resolvePlaceholders(envJson(env, "LOGIN_FORM_JSON", null), context);
  const jsonBody = resolvePlaceholders(envJson(env, "LOGIN_JSON_BODY", null), context);

  const response = await sendRequest("login", env, {
    url,
    method,
    headers,
    params,
    form,
    jsonBody,
    timeout: timeoutSeconds,
  });

  const payload = await parseJsonResponse(response, "Login response");
  let loginLine;
  if (payload && typeof payload === "object" && !Array.isArray(payload) && payload.msg !== undefined) {
    loginLine = `${accountName} login: ${payload.msg}`;
  } else {
    loginLine = `${accountName} login: ${JSON.stringify(payload).slice(0, 500)}`;
  }

  const errorMessage = loginErrorMessage(payload);
  if (errorMessage) {
    throw new Error(errorMessage);
  }

  return {
    token: findToken(payload, envStr(env, "TOKEN_PATH")),
    logLine: loginLine,
  };
}

async function callCheckin(account, token, env, timeoutSeconds) {
  const context = structuredClone(account);
  context.token = token;
  const accountName = String(account.name || account.qq);

  const url = resolveRequestUrl(env, "CHECKIN_URL", {
    basePath: DEFAULT_CHECKIN_PATH,
    context,
  });
  if (!url) {
    throw new Error("CHECKIN_URL or BASE_URL is required");
  }

  const method = envStr(env, "CHECKIN_METHOD", "POST");
  const headers = resolvePlaceholders(envJson(env, "CHECKIN_HEADERS_JSON", {}), context);
  const params = resolvePlaceholders(envJson(env, "CHECKIN_PARAMS_JSON", {}), context);
  let form = resolvePlaceholders(envJson(env, "CHECKIN_FORM_JSON", null), context);
  let jsonBody = resolvePlaceholders(envJson(env, "CHECKIN_JSON_BODY", null), context);

  const tokenLocation = envStr(env, "CHECKIN_TOKEN_LOCATION", DEFAULT_CHECKIN_TOKEN_LOCATION);
  const tokenKey = envStr(env, "CHECKIN_TOKEN_KEY", DEFAULT_CHECKIN_TOKEN_KEY);
  const tokenPrefix = envStr(env, "CHECKIN_TOKEN_PREFIX", DEFAULT_CHECKIN_TOKEN_PREFIX);
  const tokenValue = `${tokenPrefix}${token}`;

  if (tokenLocation === "header") {
    headers[tokenKey] = tokenValue;
  } else if (tokenLocation === "query") {
    params[tokenKey] = tokenValue;
  } else if (tokenLocation === "form") {
    form = form || {};
    form[tokenKey] = tokenValue;
  } else if (tokenLocation === "json") {
    jsonBody = jsonBody || {};
    if (typeof jsonBody !== "object" || Array.isArray(jsonBody)) {
      throw new Error("CHECKIN_JSON_BODY must be a JSON object when token goes to json");
    }
    jsonBody[tokenKey] = tokenValue;
  } else if (tokenLocation !== "none") {
    throw new Error("CHECKIN_TOKEN_LOCATION must be one of: header, query, form, json, none");
  }

  const response = await sendRequest("checkin", env, {
    url,
    method,
    headers,
    params,
    form,
    jsonBody,
    timeout: timeoutSeconds,
  });

  const payload = await tryParseJsonResponse(response);
  if (payload && typeof payload === "object" && !Array.isArray(payload) && payload.msg !== undefined) {
    return `${accountName}: ${payload.msg}`;
  }
  if (typeof payload === "string") {
    return `${accountName}: ${payload.slice(0, 500)}`;
  }
  return `${accountName}: ${JSON.stringify(payload).slice(0, 500)}`;
}

async function runCheckin(env) {
  const timeoutSeconds = Number.parseInt(envStr(env, "REQUEST_TIMEOUT_SECONDS", "30"), 10);
  const accounts = loadAccounts(env);
  const lines = [];
  const failures = [];

  for (const account of accounts) {
    const accountName = String(account.name || account.qq);
    try {
      const loginResult = await login(account, env, timeoutSeconds);
      lines.push(loginResult.logLine);
      lines.push(await callCheckin(account, loginResult.token, env, timeoutSeconds));
    } catch (error) {
      failures.push(accountName);
      lines.push(`${accountName}: 请求失败: ${error.message}`);
    }
  }

  return {
    ok: failures.length === 0,
    text: lines.join("\n"),
    failures,
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return new Response("ok");
    }

    if (request.method !== "POST" && request.method !== "GET") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const result = await runCheckin(env);
    return new Response(result.text, {
      status: result.ok ? 200 : 500,
      headers: {
        "Content-Type": "text/plain; charset=UTF-8",
      },
    });
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      (async () => {
        const result = await runCheckin(env);
        console.log(result.text);
        if (!result.ok) {
          throw new Error(`Failed accounts: ${result.failures.join(", ")}`);
        }
      })(),
    );
  },
};
