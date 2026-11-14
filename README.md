# 鲁班接码 · 在线网页版

把 `lubansms.py` 的接码能力搬成浏览器可直接用的单页工具，部署在 GitHub Pages。

- 纯静态，无后端、无依赖
- APIKEY 只存浏览器 `localStorage`，页面不向任何第三方上报
- 支持：查余额 / 取号 / 轮询验证码 / 释放号码 / 短信记录

## 功能对应接口

| 页面操作 | 接口 |
|---|---|
| 查余额 | `getBalance` |
| 取号 | `getKeywordNumber` |
| 轮询验证码 | `getKeywordSms` |
| 释放号码 | `delKeywordNumber` |
| 短信记录 | `keywordSmsHistory` |

接口前缀：`https://lubansms.com/v2/api/`

## 为什么需要代理

浏览器从 `*.github.io` 直接请求 `lubansms.com` 属于跨域，对方不返回 `Access-Control-Allow-Origin`，会被浏览器拦下。两种用法：

1. **配代理（推荐）**：部署 `worker.js` 到 Cloudflare Workers（免费），拿到形如 `https://xxx.workers.dev/?url=` 的地址，填到页面的「代理地址」。
2. **不配代理**：页面会提示 CORS 失败，只能用下面的本地方式跑。

## 本地跑（无 CORS 问题）

```bash
python3 -m http.server 8000 -d web
# 打开 http://127.0.0.1:8000/
```
本地 `127.0.0.1` 与目标站仍跨域，同样需要代理；若想完全免代理，用原来的 CLI：

```bash
python3 lubansms.py balance
python3 lubansms.py number
python3 lubansms.py sms --phone 1xxxxxxxxxx --keyword 斯氪科技
python3 lubansms.py release --phone 1xxxxxxxxxx
```

## 部署 Cloudflare Worker

```bash
npm i -g wrangler
wrangler login
wrangler deploy worker.js --name lubans-proxy
```

部署后用浏览器访问 `https://<name>.<account>.workers.dev/?url=<URL编码后的接口地址>` 自测。

## 部署 GitHub Pages

仓库根目录放 `index.html`（本目录内容），然后在仓库 Settings → Pages 选择分支与目录，或：

```bash
gh api -X POST repos/<owner>/<repo>/pages -f source[branch]=main -f source[path]=/
```

## 安全提醒

- 页面里的 APIKEY 会被任何打开该页面的人看到余额与号码操作权；对外公开页面时建议只部署给自己用（私有仓库 + Pages 仍公开），或让使用者自己填 key。
- `worker.js` 默认允许所有来源，建议把 `ALLOW_ORIGIN` 改成你的 Pages 域名。
