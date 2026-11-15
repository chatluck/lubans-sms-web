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
