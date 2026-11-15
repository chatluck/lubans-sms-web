// i-sms 充值加密（Workers 运行时可用的复刻实现）
// 依据实测逆向：wasm encrypt_data_main + RSA-OAEP(SHA-256) + AES-GCM
import WASM_MODULE from "./enc.wasm";

const ISMS = "https://www.i-sms.app";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

let pubkeyPem = null;

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function hex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---- wasm-bindgen 最小运行时（29 个 import） ----
function makeImports(state) {
  const heap = [undefined];
  const push = (v) => { heap.push(v); return heap.length - 1; };
  const raw = {
    crypto: () => push(globalThis.crypto),
    process: () => push({ versions: {} }),
    versions: () => push({}),
    node: () => push(undefined),
    require: () => push(undefined),
    msCrypto: () => push(undefined),
    getRandomValues: (a, b) => { const x = heap[b]; if (x && x.fill) crypto.getRandomValues(x); },
    randomFillSync: (a, b) => { const x = heap[b]; if (x && x.fill) crypto.getRandomValues(x); },
    object_drop_ref: (i) => { heap[i] = undefined; },
    object_clone_ref: (i) => i,
    new_with_length: (l) => push(new Uint8Array(l)),
    length: (i) => (heap[i] ? heap[i].length : 0),
    prototypesetcall: (a, b, c) => { const x = heap[a]; if (x && x.set && heap[b]) x.set(heap[b], c); },
    subarray: (a, b, c) => push(heap[a] ? heap[a].subarray(b, c) : new Uint8Array(0)),
    now: () => Date.now(),
    gthis: () => push(globalThis),
    self: () => push(globalThis),
    global: () => push(globalThis),
    window: () => push(globalThis),
    new_no_args: () => push(new Uint8Array(0)),
    call2: (f, t) => push(typeof heap[f] === "function" ? heap[f].call(heap[t]) : undefined),
    call3: (f, t) => push(typeof heap[f] === "function" ? heap[f].call(heap[t]) : undefined),
    throw: (p, l) => { throw new Error("[wasm] " + new TextDecoder().decode(new Uint8Array(state.mem.buffer, p, l))); },
    is_object: (i) => (heap[i] !== null && typeof heap[i] === "object" ? 1 : 0),
    is_string: (i) => (typeof heap[i] === "string" ? 1 : 0),
    is_function: (i) => (typeof heap[i] === "function" ? 1 : 0),
    is_undefined: (i) => (heap[i] === undefined ? 1 : 0),
    cast1: (a, b) => push(String(b)),
    cast2: (a, b) => { try { return push(new TextDecoder().decode(new Uint8Array(state.mem.buffer, a, b))); } catch { return push(String(b)); } },
  };
  const map = {
    __wbg_crypto_86f2631e91b51511: "crypto", __wbg_process_3975fd6c72f520aa: "process",
    __wbg_versions_4e31226f5e8dc909: "versions", __wbg_node_e1f24f89a7336c2e: "node",
    __wbg_require_b74f47fc2d022fd6: "require", __wbg_msCrypto_d562bbe83e0d4b91: "msCrypto",
    __wbg_getRandomValues_b3f15fcbfabb0f8b: "getRandomValues", __wbg_randomFillSync_f8c153b79f285817: "randomFillSync",
    __wbindgen_object_drop_ref: "object_drop_ref", __wbindgen_object_clone_ref: "object_clone_ref",
    __wbg_new_with_length_a2c39cbe88fd8ff1: "new_with_length", __wbg_length_32ed9a279acd054c: "length",
    __wbg_prototypesetcall_bdcdcc5842e4d77d: "prototypesetcall", __wbg_subarray_a96e1fef17ed23cb: "subarray",
    __wbg_now_a3af9a2f4bbaa4d1: "now", __wbg_static_accessor_GLOBAL_THIS_e628e89ab3b1c95f: "gthis",
    __wbg_static_accessor_SELF_a621d3dfbb60d0ce: "self", __wbg_static_accessor_GLOBAL_12837167ad935116: "global",
    __wbg_static_accessor_WINDOW_f8727f0cf888e0bd: "window", __wbg_new_no_args_1c7c842f08d00ebb: "new_no_args",
    __wbg_call_389efe28435a9388: "call2", __wbg_call_4708e0c13bdc8e95: "call3",
    __wbg___wbindgen_throw_be289d5034ed271b: "throw", __wbg___wbindgen_is_object_5ae8e5880f2c1fbd: "is_object",
    __wbg___wbindgen_is_string_cd444516edc5b180: "is_string", __wbg___wbindgen_is_function_0095a73b8b156f76: "is_function",
    __wbg___wbindgen_is_undefined_9e4d92534c42d778: "is_undefined",
    __wbindgen_cast_0000000000000001: "cast1", __wbindgen_cast_0000000000000002: "cast2",
  };
  const mod = { "./crypto_wasm_bg.js": {} };
  for (const [full, short] of Object.entries(map)) mod["./crypto_wasm_bg.js"][full] = (...a) => raw[short](...a);
  return mod;
}

async function getWasm() {
  // 每次请求都用全新实例：复用实例会导致服务端签名校验失败（实测）
  const state = { mem: null };
  const instance = await WebAssembly.instantiate(WASM_MODULE, makeImports(state));
  const ex = instance.exports || instance;
  state.mem = ex.memory;
  return { ex, mem: ex.memory };
}

async function getPubkey() {
  if (pubkeyPem) return pubkeyPem;
  const res = await fetch(ISMS + "/api/public-key", { headers: { "User-Agent": UA, Accept: "application/json" } });
  const data = await res.json();
  pubkeyPem = data.publicKey;
  return pubkeyPem;
}

function pemToDer(pem) {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  return b64ToBytes(b64);
}

async function rsaOaepEncrypt(text, pem) {
  const key = await crypto.subtle.importKey(
    "spki",
    pemToDer(pem),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"]
  );
  const enc = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, key, new TextEncoder().encode(text));
  return bytesToB64(new Uint8Array(enc));
}

async function aesGcmDecrypt(b64Data, b64Iv, keyBytes) {
  const data = b64ToBytes(b64Data);
  const iv = b64ToBytes(b64Iv);
  const ct = data.slice(0, data.length - 16);
  const tag = data.slice(data.length - 16);
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]);
  const merged = new Uint8Array(ct.length + tag.length);
  merged.set(ct, 0);
  merged.set(tag, ct.length);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, merged);
  return JSON.parse(new TextDecoder().decode(plain));
}

// ---- 对外能力 ----

export async function createRechargeOrder({ token, amount, methodId = 3 }) {
  const { ex: e, mem } = await getWasm();
  const pem = await getPubkey();
  const fingerprint = {
    user_agent_hash: hex(crypto.getRandomValues(new Uint8Array(32))),
    timestamp: Date.now(),
    call_stack_depth: 5,
    timezone_offset: -480,
  };
  const payload = JSON.stringify({
    data: { amount: Number(amount), paymentMethodId: Number(methodId) },
    public_key: pem,
    fingerprint,
    timestamp: Date.now(),
  });

  const rp = e.__wbindgen_add_to_stack_pointer(-16);
  const buf = new TextEncoder().encode(payload);
  const ptr = e.__wbindgen_export2(buf.length, 1);
  new Uint8Array(mem.buffer, ptr, buf.length).set(buf);
  e.encrypt_data_main(rp, ptr, buf.length);
  const dv = new DataView(mem.buffer);
  const op = dv.getUint32(rp, true), ol = dv.getUint32(rp + 4, true);
  const outStr = new TextDecoder().decode(new Uint8Array(mem.buffer, op, ol));
  e.__wbindgen_add_to_stack_pointer(16);

  let wasmOut;
  try { wasmOut = JSON.parse(outStr); } catch (e) {
    return { ok: false, error: "wasm 输出非 JSON(长度 " + outStr.length + ")", detail: outStr.slice(0, 120) };
  }
  if (!wasmOut.encrypted || !wasmOut.key) {
    return { ok: false, error: "wasm 输出缺字段", detail: Object.keys(wasmOut) };
  }
  const aesKey = b64ToBytes(wasmOut.key);
  const encKey = await rsaOaepEncrypt(wasmOut.key, pem);

  const body = {
    encrypted: wasmOut.encrypted,
    key: encKey,
    iv: wasmOut.iv,
    timestamp: wasmOut.timestamp,
    signature: wasmOut.signature,
  };

  const bodyForDebug = JSON.stringify(body);
  const res = await fetch(ISMS + "/api/user/recharge", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: "Bearer " + token,
      "User-Agent": UA,
    },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { ok: false, error: "响应非 JSON: " + raw.slice(0, 120) }; }

  if (!parsed.encrypted || !parsed.iv) {
    return { ok: false, error: parsed.message || "下单响应未加密", detail: parsed, dbg: {
      keyLen: body.key.length, encLen: body.encrypted.length, ivLen: body.iv.length,
      sigLen: String(body.signature).length, wasmKeyLen: aesKey.length, payloadLen: payload.length,
      fullBody: bodyForDebug,
      aesKeyB64: bytesToB64(aesKey)
    } };
  }
  const plain = await aesGcmDecrypt(parsed.encrypted, parsed.iv, aesKey);
  if (!plain.success) {
    return { ok: false, error: plain.message || "下单失败", detail: plain, dbg: {
      keyLen: body.key.length, encLen: body.encrypted.length, ivLen: body.iv.length,
      sigLen: String(body.signature).length, ts: body.timestamp, wasmKeyLen: aesKey.length
    } };
  }
  return { ok: true, orderId: plain.order_id, aesKey };
}

export async function getRechargeUrl({ token, orderId, aesKey }) {
  const pem = await getPubkey();
  const rel = "/api/user/recharge-url?order_id=" + orderId;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rel));
  const h = hex(new Uint8Array(digest));

  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const k = bytesToB64(keyBytes);
  const header = await rsaOaepEncrypt(JSON.stringify({ k, t: Date.now(), h }), pem);

  const res = await fetch(ISMS + rel, {
    headers: {
      Accept: "application/json",
      Authorization: "Bearer " + token,
      "User-Agent": UA,
      "X-Encryption-Key": header,
    },
  });
  const raw = await res.text();
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return { ok: false, error: "响应非 JSON: " + raw.slice(0, 120) }; }
  if (!parsed.encrypted) return { ok: false, error: parsed.message || "获取支付链接失败", detail: parsed, dbg: { h, kLen: k.length, headerLen: header.length, rel } };
  const plain = await aesGcmDecrypt(parsed.encrypted, parsed.iv, keyBytes);
  if (!plain.success) return { ok: false, error: plain.message || "获取支付链接失败", detail: plain };
  return { ok: true, url: plain.rechargeUrl, orderId, amount: plain.amount, status: plain.status };
}
