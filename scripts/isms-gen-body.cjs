// 生成 i-sms /api/user/recharge 的合法加密 body
// 用法: node gen_body.cjs '{"amount":5,"payment_method":"wechat"}'
const fs = require("fs");
const crypto = require("crypto");

const wasmBytes = fs.readFileSync("/tmp/isms_rev/enc.wasm");
const heap = [undefined];
const push = (v) => { heap.push(v); return heap.length - 1; };
let mem = null;

const impl = {
  crypto: () => push(globalThis.crypto),
  process: () => push({ versions: {} }),
  versions: () => push({}),
  node: () => push(undefined),
  require: () => push(undefined),
  msCrypto: () => push(undefined),
  getRandomValues: (a, b) => { const x = heap[b]; if (x && x.fill) globalThis.crypto.getRandomValues(x); },
  randomFillSync: (a, b) => { const x = heap[b]; if (x && x.fill) globalThis.crypto.getRandomValues(x); },
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
  throw: (p, l) => { throw new Error("[wasm] " + Buffer.from(new Uint8Array(mem.buffer, p, l)).toString()); },
  is_object: (i) => (heap[i] !== null && typeof heap[i] === "object" ? 1 : 0),
  is_string: (i) => (typeof heap[i] === "string" ? 1 : 0),
  is_function: (i) => (typeof heap[i] === "function" ? 1 : 0),
  is_undefined: (i) => (heap[i] === undefined ? 1 : 0),
  cast1: (a, b) => push(String(b)),
  cast2: (a, b) => { try { return push(Buffer.from(new Uint8Array(mem.buffer, a, b)).toString("utf8")); } catch { return push(String(b)); } },
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

const imports = { "./crypto_wasm_bg.js": {} };
for (const [full, short] of Object.entries(map)) {
  imports["./crypto_wasm_bg.js"][full] = (...a) => impl[short](...a);
}

(async () => {
  const pem = JSON.parse(fs.readFileSync("/tmp/isms_rev/pubkey.json", "utf8")).publicKey;
  const { instance } = await WebAssembly.instantiate(wasmBytes, imports);
  const e = instance.exports;
  mem = e.memory;
  const malloc = (n) => e.__wbindgen_export2(n, 1);
  const dv = () => new DataView(mem.buffer);

  const data = JSON.parse(process.argv[2] || '{"amount":5,"payment_method":"wechat"}');
  const fingerprint = {
    user_agent_hash: crypto.createHash("sha256").update("Mozilla/5.0 scorehub-autoreg").digest("hex"),
    timestamp: Date.now(),
    call_stack_depth: 5,
    timezone_offset: -480,
  };
  const payload = { data, public_key: pem, fingerprint, timestamp: Date.now() };

  const rp = e.__wbindgen_add_to_stack_pointer(-16);
  const buf = Buffer.from(JSON.stringify(payload));
  const ptr = malloc(buf.length);
  new Uint8Array(mem.buffer, ptr, buf.length).set(buf);
  e.encrypt_data_main(rp, ptr, buf.length);
  const op = dv().getUint32(rp, true), ol = dv().getUint32(rp + 4, true);
  const outStr = Buffer.from(new Uint8Array(mem.buffer, op, ol)).toString("utf8");
  e.__wbindgen_add_to_stack_pointer(16);

  const wasmOut = JSON.parse(outStr);
  const aesKey = Buffer.from(wasmOut.key, "base64");
  const rsaKey = crypto.createPublicKey(pem);
  const encKey = crypto.publicEncrypt(
    { key: rsaKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
    aesKey
  );

  const body = {
    encrypted: wasmOut.encrypted,
    key: encKey.toString("base64"),
    iv: wasmOut.iv,
    timestamp: wasmOut.timestamp,
    signature: wasmOut.signature,
  };
  fs.writeFileSync("/tmp/isms_rev/body.json", JSON.stringify(body));
  fs.writeFileSync("/tmp/isms_rev/aeskey.bin", aesKey);
  process.stdout.write("body written, keyLen=" + body.key.length + " aesKeyLen=" + aesKey.length + "\n");
  process.stdout.write(JSON.stringify(body).slice(0, 220) + "\n");
})();
