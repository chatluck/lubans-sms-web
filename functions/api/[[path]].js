// Cloudflare Pages Functions: 把 /api/* 转发给 worker 处理逻辑
import worker from "../../worker/index.js";

export async function onRequest(context) {
  return worker.fetch(context.request, context.env);
}
