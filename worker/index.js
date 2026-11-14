// ScoreHub 自动注册后端（Cloudflare Worker）
//
// 接口：
//   POST /api/start            -> { phone }            取号 + 触发短信
//   GET  /api/poll?phone=xxx   -> { status, ... }      查码 → 注册 → 设密码
//        status: waiting | ok | blocked | error
//   GET  /api/health           -> { ok: true }
//
// 环境变量（wrangler secret / vars）：
//   LUBANS_APIKEY   lubans 接码平台 apikey（必填）
//   LUBANS_KEYWORD  短信关键词，默认 斯氪科技
//
// 流程（全部纯 HTTP，无需浏览器）：
//   lubans getKeywordNumber → scorehub verification/send → lubans getKeywordSms
//   → scorehub auth/login/code → config/name → members/me/password → config/guide-completed

const SCOREHUB = "https://api.scorehub.cn/merchant";
const LUBANS = "https://lubansms.com/v2/api/";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function json(data, status = 200, origin = "*") {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cors(origin) },
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchText(url, init, tries = 2) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, init);
      return await res.text();
    } catch (e) {
      lastErr = e;
      await sleep(500 * (i + 1));
    }
  }
  throw new Error("网络请求失败：" + (lastErr?.message || lastErr));
}

async function lubans(env, endpoint, params) {
  const apikey = env.LUBANS_APIKEY;
  if (!apikey) throw new Error("LUBANS_APIKEY 未配置");
  const qs = new URLSearchParams({ apikey, ...params }).toString();
  const text = await fetchText(LUBANS + endpoint + "?" + qs, {
    headers: {
      "User-Agent": UA,
      "Accept": "application/json, text/plain, */*",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      "Referer": "https://lubansms.com/",
      "Origin": "https://lubansms.com",
      "sec-ch-ua": '"Chromium";v="126", "Not:A-Brand";v="24"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
    },
  });
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("lubans 响应异常：" + text.slice(0, 120));
  }
}

async function scorehub(path, { method = "GET", body, token } = {}) {
  const headers = {
    "Content-Type": "application/json",
    "x-api-version": "1",
    "User-Agent": UA,
    "Origin": "https://app.scorehub.cn",
    "Referer": "https://app.scorehub.cn/merchant/login",
  };
  if (token) headers["Authorization"] = "Bearer " + token;
  const res = await fetch(SCOREHUB + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("scorehub 响应异常：" + text.slice(0, 160));
  }
  return { http: res.status, data };
}

function extractCode(text) {
  const m = /(?:验证码[：:\s]*)?(\d{6})/.exec(text || "");
  return m ? m[1] : null;
}

function isBlocked(text) {
  return /短信被屏蔽|本项目不被支持|已被当前号码提供方屏蔽/.test(text || "");
}

function makePassword() {
  const letters = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const nums = "23456789";
  const pick = (s) => s[Math.floor(Math.random() * s.length)];
  let core = "";
  for (let i = 0; i < 6; i++) core += pick(letters);
  for (let i = 0; i < 4; i++) core += pick(nums + letters.slice(0, 10));
  // 形如 Sc7fK3mQ92x：字母+数字，长度 11，满足 8-18 位规则
  return "Sc" + core + "x";
}

// ---------- 业务 ----------

// 号段经验：13x 段（联通实卡）到达率明显更高，其它段常被运营商屏蔽
const GOOD_PREFIX = /^1(3[1-9]|8[0-9])\d{8}$/;
const RELEASE_UNUSABLE = true;

function releaseNumber(env, phone) {
  // 不阻塞主流程：释放失败也不影响
  lubans(env, "delKeywordNumber", { phone }).catch(() => {});
}

async function pickNumber(env, tries = 2) {
  const rejected = [];
  let lastPhone = null;
  const deadline = Date.now() + 9000;
  for (let i = 0; i < tries && Date.now() < deadline; i++) {
    const n = await lubans(env, "getKeywordNumber", {});
    if (!n || n.code !== 0 || !n.phone) {
      return { error: "取号失败：" + (n?.msg || "unknown"), rejected };
    }
    const phone = String(n.phone);
    if (GOOD_PREFIX.test(phone)) {
      return { phone, rejected };
    }
    rejected.push(phone);
    lastPhone = phone;
    if (RELEASE_UNUSABLE) releaseNumber(env, phone);

  }
  // 全部是低成功号段时，退一步用最后一个号直接试
  return { phone: lastPhone, rejected, fallback: true };
}

async function handleStart(env, origin) {
  const picked = await pickNumber(env);
  if (!picked.phone) {
    return json({ status: "error", message: picked.error, rejected: picked.rejected }, 200, origin);
  }
  return json({ status: "started", phone: picked.phone, replaced: picked.rejected, fallback: Boolean(picked.fallback) }, 200, origin);
}

async function handleSend(env, phone, origin) {
  if (!phone) return json({ status: "error", message: "缺少 phone" }, 400, origin);
  const send = await scorehub("/auth/verification/send", {
    method: "POST",
    body: { identifier: phone, type: 1 },
  });
  if (send.data?.code !== 0) {
    return json({ status: "error", message: "发码失败：" + (send.data?.description || send.data?.code), phone }, 200, origin);
  }
  return json({ status: "sent", phone }, 200, origin);
}

async function handlePoll(env, phone, origin) {
  if (!phone) return json({ status: "error", message: "缺少 phone" }, 400, origin);
  const keyword = env.LUBANS_KEYWORD || "斯氪科技";

  // 单次请求内只等几秒，避免超过 Worker 的 30s 上限；轮询由前端驱动
  let smsText = "";
  for (let i = 0; i < 3; i++) {
    const r = await lubans(env, "getKeywordSms", { phone, keyword });
    if (r && r.code === 0) {
      smsText = r.msg || "";
      break;
    }
    const msg = String(r?.msg || "");
    if (isBlocked(msg)) {
      return json({ status: "blocked", message: msg, phone }, 200, origin);
    }
    await sleep(2500);
  }

  if (!smsText) return json({ status: "waiting", phone }, 200, origin);
  if (isBlocked(smsText)) {
    return json({ status: "blocked", message: smsText.slice(0, 120), phone }, 200, origin);
  }

  const code = extractCode(smsText);
  if (!code) return json({ status: "waiting", message: "短信已到但未解析出验证码", phone }, 200, origin);

  const login = await scorehub("/auth/login/code", {
    method: "POST",
    body: { identifier: phone, code },
  });
  const token = login.data?.data?.accessToken;
  if (login.data?.code !== 0 || !token) {
    return json({ status: "error", message: "登录/注册失败：" + (login.data?.description || ""), phone }, 200, origin);
  }

  const merchantName = "Score" + phone;
  const password = makePassword();

  await scorehub("/merchant/config/name", { method: "PATCH", body: { name: merchantName }, token });
  const pwd = await scorehub("/members/me/password", { method: "PATCH", body: { newPassword: password }, token });
  if (pwd.data?.code !== 0) {
    return json(
      { status: "error", message: "设密码失败：" + JSON.stringify(pwd.data?.description), phone, merchantName },
      200,
      origin
    );
  }
  await scorehub("/merchant/config/guide-completed", { method: "POST", body: {}, token });

  return json(
    { status: "ok", phone, password, merchantName, username: login.data?.data?.user?.username || null },
    200,
    origin
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "*";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(origin) });
    }

    let body = null;
    if (request.method === "POST") {
      try { body = await request.clone().json(); } catch { body = null; }
    }

    try {
      if (url.pathname === "/api/debug") {
        const probe = async (label, fn) => {
          const t0 = Date.now();
          try {
            const r = await Promise.race([
              fn(),
              new Promise((_, rej) => setTimeout(() => rej(new Error("timeout-8s")), 8000)),
            ]);
            return { label, ms: Date.now() - t0, ok: true, value: r };
          } catch (e) {
            return { label, ms: Date.now() - t0, ok: false, error: String(e.message || e) };
          }
        };
        const out = [];
        out.push(await probe("lubans-balance", async () => {
          const r = await lubans(env, "getBalance", {});
          return r;
        }));
        out.push(await probe("scorehub-send", async () => {
          const r = await scorehub("/auth/verification/send", { method: "POST", body: { identifier: "13800000000", type: 1 } });
          return { http: r.http, code: r.data?.code };
        }));
        return json({ probes: out }, 200, origin);
      }
      if (url.pathname === "/api/health") {
        return json({ ok: true, lubans: Boolean(env.LUBANS_APIKEY) }, 200, origin);
      }
      if (url.pathname === "/api/start" && request.method === "POST") {
        return await handleStart(env, origin);
      }
      if (url.pathname === "/api/send") {
        const phone = url.searchParams.get("phone") || (body?.phone ?? "");
        return await handleSend(env, phone, origin);
      }
      if (url.pathname === "/api/poll" && request.method === "GET") {
        return await handlePoll(env, url.searchParams.get("phone") || "", origin);
      }
      return json({ status: "error", message: "not found" }, 404, origin);
    } catch (e) {
      return json({ status: "error", message: String(e.message || e) }, 500, origin);
    }
  },
};
