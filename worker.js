// Cloudflare Worker: lubansms CORS 代理
// 部署后在页面「代理地址」填：https://<你的worker>.workers.dev/?url=
// 用法：GET https://<worker>/?url=<encodeURIComponent(完整API URL)>

const ALLOW_ORIGIN = "*";           // 需要收紧时改成你的 Pages 域名，如 https://chatluck.github.io
const ALLOWED_HOSTS = ["lubansms.com"]; // 只允许代理这些目标域名

export default {
  async fetch(request) {
    const cors = {
      "Access-Control-Allow-Origin": ALLOW_ORIGIN,
      "Access-Control-Allow-Methods": "GET,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== "GET") {
      return new Response(JSON.stringify({ code: -1, msg: "only GET" }), {
        status: 405,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const u = new URL(request.url);
    const target = u.searchParams.get("url");
    if (!target) {
      return new Response(JSON.stringify({ code: -1, msg: "missing url param" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    let t;
    try { t = new URL(target); } catch {
      return new Response(JSON.stringify({ code: -1, msg: "bad url" }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    if (!ALLOWED_HOSTS.includes(t.hostname)) {
      return new Response(JSON.stringify({ code: -1, msg: "host not allowed: " + t.hostname }), {
        status: 403,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const upstream = await fetch(t.toString(), {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
        "Accept": "application/json",
      },
      cf: { cacheTtl: 0 },
    });

    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  },
};
