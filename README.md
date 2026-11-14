# ScoreHub 账号 · 一键获取（GitHub Pages + Cloudflare Worker）

页面：https://chatluck.github.io/lubans-sms-web/

点「获取账号」后，后端自动完成：

```
lubans 取号 → ScoreHub 发短信 → lubans 收码 → 登录/注册（自动建号）
→ 设置商户名称 → 设置登录密码 → 标记引导完成 → 返回账号+密码
```

全程纯 HTTP，不依赖浏览器自动化。

## 目录

```
index.html        前端（GitHub Pages 托管）
worker/index.js   后端（Cloudflare Worker）
worker/wrangler.toml
```

## 一、部署 Worker（一次性）

```bash
cd worker
npx wrangler login                 # 浏览器授权
npx wrangler secret put LUBANS_APIKEY   # 粘贴 lubans apikey
npx wrangler deploy
```

部署成功会打印形如 `https://scorehub-autoreg.<子域>.workers.dev` 的地址。

可选变量（`wrangler.toml` 的 `[vars]`）：

- `LUBANS_KEYWORD`：短信关键词，默认 `斯氪科技`

## 二、前端配置

打开 Pages，在「后端」输入框填 Worker 地址（不带结尾斜杠），回车保存到 localStorage。之后点「获取账号」即可。

## 三、接口

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/start` | 取号并发短信，返回 `{status:"started", phone}` |
| GET | `/api/poll?phone=` | 单次最多等 20s 查码；命中则完成注册并返回 `{status:"ok", phone, password, merchantName}` |
| GET | `/api/health` | 健康检查，`lubans` 字段表示 key 是否配置 |

`/api/poll` 的状态：`waiting`（继续轮询）、`ok`（拿到账号）、`blocked`（号码被屏蔽，前端自动换号）、`error`。

## 四、背后的 ScoreHub 接口（已实测）

| 步骤 | 接口 |
|---|---|
| 发验证码 | `POST /merchant/auth/verification/send` `{identifier, type:1}` |
| 登录/注册 | `POST /merchant/auth/login/code` `{identifier, code}` → `data.accessToken` |
| 设商户名 | `PATCH /merchant/merchant/config/name` `{name}` |
| 设密码 | `PATCH /merchant/members/me/password` `{newPassword}`（8–18 位，字母数字特殊符号） |
| 引导完成 | `POST /merchant/merchant/config/guide-completed` `{}` |
| 密码登录 | `POST /merchant/auth/login` `{username, password}` |

请求头需带 `x-api-version: 1`；Bearer token 来自登录接口。

## 五、注意事项

- **密码规则**：8–18 位，需字母+数字，特殊符号限 `!@#$%&*?.`；Worker 生成形如 `Sc7fK3mQ92x`。
- **号码池**：`131`/`132` 段成功率最高；`191/193/170/162/155/173` 常被屏蔽。被屏蔽时 `/api/poll` 返回 `blocked`，前端会自动重新取号（最多 3 次）。
- **号码是账号的唯一找回方式**：lubans 订单释放后，短信登录/忘记密码都不可用，只能密码登录。需要保留找回能力就别释放订单。
- **成本**：每成功一条短信约 0.08（lubans 计费），失败/屏蔽不计费。
- **安全**：Worker 里存 lubans apikey，`Access-Control-Allow-Origin` 目前是 `*`。若不想让别人白用，把 `worker/index.js` 的 `cors()` 改成只允许 `https://chatluck.github.io`。

## 号池质量说明（实测）

- lubans 的 `getKeywordNumber` 返回的号段随时间波动，13[1-9] / 18x 段能收到「斯氪科技」短信，`15x/16x/17x/19x` 段几乎全被运营商拦截。
- Worker 会先连抽最多 6 个号筛出 13x/18x；抽不到就用最后一个号回退试一次（返回体里 `fallback: true`）。
- 某些时段整池都是坏号段（实测出现过连续 17 个号全不可用），此时前端会按 `MAX_TRY` 自动重来。号池恢复后成功率立刻回升。
- 已验证的完整成功样本：`18307320380` / `ScVbuAizd47gx`（密码登录返回 accessToken）。
