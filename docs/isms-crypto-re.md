# i-sms 请求加密逆向笔记（未完成）

目标：让后端能生成合法的 `/api/user/recharge` 请求，从而实现页面内充值。
结论：**未打通**。wasm 可以实例化、能调用 `compute_entry_name`，但 `encrypt_data_main` 返回值恒为空。

## 资产

| 文件 | 说明 |
|---|---|
| `https://www.i-sms.app/2deac345080c6144.module.wasm` | 183KB Rust→wasm 加密库 |
| `https://www.i-sms.app/js/crypto-wasm.9f96705e.js` | wasm-bindgen glue（混淆 + 反调试） |
| `https://www.i-sms.app/api/public-key` | RSA-2048 公钥（PEM） |
| `chunk-vendors` / `app.js` | 主 bundle，含请求拦截器与加密调用 |

## wasm 关键信息

- 段：type / import(29) / func(402) / table / memory / global / export / elem / datacount / code / data，**无 start 段**
- 导出：
  - `encrypt_data_main(i32,i32,i32) -> ()`
  - `decrypt_data_main(i32,i32,i32,i32,i32,i32,i32) -> ()`
  - `compute_entry_name(i32,i64,i32,i32) -> ()`  ← 实测可正常返回字符串
  - `__wbindgen_export2(size,align) -> ptr`（malloc）、`__wbindgen_export3`（realloc）、`__wbindgen_export4(ptr,size,align)`（free）
  - `__wbindgen_add_to_stack_pointer(i32) -> i32`
- 字符串常量里挖到的结构：

```
{"encrypted":"","key":"","iv":"","timestamp":,"signature":""}
字段：data public_key fingerprint timestamp encrypted key iv signature user_agent_hash call_stack_depth timezone_offset
```

- 依赖 crate：serde_json 1.0.149、cipher 0.4.4、universal-hash 0.5.1、getrandom

## 真实请求样本（抓自浏览器，敏感字段已脱敏）

```json
POST https://www.i-sms.app/api/user/recharge
Authorization: Bearer <JWT>
{
  "encrypted": "<base64>",
  "key": "<256B base64，RSA-2048 加密的 AES key>",
  "iv": "<base64，约 12B>",
  "timestamp": 1794731360774,
  "signature": "<64 hex>"
}
```

响应同样是 `{encrypted, iv, timestamp, signature}`。

## 已验证的结论

1. **无防重放**：同一请求体重放返回 200。
2. **重放不可用**：响应被 AES 加密，而 AES key 被 RSA 公钥包裹，后端拿不到 `order_id`，拼不出 `pay.isms.pw/submit.php?...`。
3. **跨域全封**：带 `Origin` 的请求（含静态 js/wasm）一律 500。
4. **登录页无预填**：`auth` chunk 里 query 只处理 OAuth 的 `code/state`，`redirectUri` 的 google/github 均 `enabled:false`。

## 手写运行时状态

29 个 import 已实现（externref 堆、getRandomValues、throw、cast 等），malloc/free 正常。
`compute_entry_name(retptr, i64, ptr, len)` 返回 `fn_cc806db87c1f7c1f` ✅。
`encrypt_data_main` 在 `(retptr, ptr, len)` 模式下不 trap 但返回 `[0,0]`；`(ptr, len, outptr)` 模式 `unreachable`。

## 下一步（如果继续）

- 反编译 `encrypt_data_main`（`wabt` 已生成 `enc.wat`，2.1MB），定位它的分支条件与返回值写入位置
- 尝试 4 字段 schema（`data/public_key/timestamp/fingerprint` 等）与 `serde` 的 `missing field` 报错路径
- 或改走 JS 降级实现 `encryptRequestJS`（在未加载的 webpack chunk `0x2cc` 里，名字与 hash 都被混淆）

## 复现脚本

`/tmp/isms_rev/`：`enc.wasm`、`crypto-wasm.js`、`app.0f464fda.js`、`pubkey.json`、`run2.cjs`、`sweep2.cjs`、`sweep3.cjs`、`enc.wat`

## 2026-11-15 突破（Node 端已完全跑通）

修正了三处运行时语义后，wasm 加密可以正常工作了：

1. `__wbindgen_object_clone_ref` 必须 **返回同一个索引**（不是新建副本）
2. `is_object / is_string / is_function / is_undefined` 必须 **真实判断**（用 0/1 常量会走进 getrandom 的环境探测失败分支）
3. `__wbg_call_*` 必须真正调用函数
4. 另外 `fingerprint` 必须是对象：`{user_agent_hash, timestamp, call_stack_depth, timezone_offset}`

正确的请求载荷是：

```json
{"data": <业务数据>, "public_key": <PEM>, "fingerprint": {...}, "timestamp": <ms>}
```

wasm 返回：

```json
{"encrypted":"...","key":"<base64 32B AES key>","iv":"...","timestamp":...,"signature":"<64 hex>"}
```

然后要用 **RSA-OAEP(SHA-256)** 把 `key`（AES key 原文）加密替换：

```js
crypto.publicEncrypt({key, padding: RSA_PKCS1_OAEP_PADDING, oaepHash:"sha256"}, aesKey)
```

### 下单 + 取支付链接（Node 实测成功）

```
POST /api/user/recharge   body={encrypted,key,iv,timestamp,signature}
  → 200，响应加密，AES-256-GCM(key, iv) 解出 {"success":true,"order_id":"26111516..."}

GET /api/user/recharge-url?order_id=...  需头 X-Encryption-Key
  X-Encryption-Key = RSA-OAEP(JSON{k:base64(32B 随机),t:Date.now(),h:sha256("/api/user/recharge-url?order_id=...")})
  注意 h 用的是 **相对路径+query**
  → 解出 {"success":true,"rechargeUrl":"https://pay.isms.pw/submit.php?..."}
```

脚本在 `scripts/isms-gen-body.cjs` 与 `scripts/isms-get-url.cjs`。

### 仍未解决的差异

同样的 wasm 在 **Cloudflare Worker/Pages Functions 里**生成的 `signature` 会被服务端判为无效（`ENC_VALIDATION_FAILED`），而 Node 里同样的流程成功。已验证：
- Worker 生成的 body 用本地 Node 发送同样失败 → 是 body 内容差异，不是网络/头
- key/encrypted/iv 长度与 Node 一致，且用 AES key 能本地解开、明文正确
- 每次新建 wasm 实例（不复用）仍失败

推测是 Workers 的 WebAssembly/JS 值语义与 Node 有细微差异，影响 wasm 内部签名计算。
