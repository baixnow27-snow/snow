import { normalizeTikHubResponse } from "../../api/search.js";

const ENDPOINT = "https://api.tikhub.io/api/v1/xiaohongshu/app_v2/search_notes";
const reply = (body, status = 200) => Response.json(body, {
  status,
  headers: {
    "cache-control": status === 200 ? "public, max-age=0, s-maxage=300" : "no-store",
    "x-content-type-options": "nosniff",
  },
});
const readableMessage = (value) => {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    return [value.message_zh, value.message, value.detail, value.reason, value.error]
      .find((item) => typeof item === "string") || JSON.stringify(value);
  }
  return "TikHub 未提供具体原因";
};

export default async (request) => {
  if (request.method !== "GET") return reply({ error: "仅支持 GET 请求" }, 405);
  const requestUrl = new URL(request.url);
  const keyword = String(requestUrl.searchParams.get("keyword") ?? "").trim().slice(0, 50);
  if (!keyword) return reply({ error: "请输入要查询的关键词" }, 400);
  const token = process.env.TIKHUB_API_TOKEN;
  if (!token) return reply({ error: "实时数据接口尚未配置" }, 503);

  const sort = ["general", "time_descending", "popularity_descending", "comment_descending", "collect_descending"]
    .includes(requestUrl.searchParams.get("sort_type")) ? requestUrl.searchParams.get("sort_type") : "popularity_descending";
  const time = ["不限", "一天内", "一周内", "半年内"].includes(requestUrl.searchParams.get("time_filter"))
    ? requestUrl.searchParams.get("time_filter") : "一周内";
  const upstreamUrl = new URL(ENDPOINT);
  upstreamUrl.searchParams.set("keyword", keyword);
  upstreamUrl.searchParams.set("page", "1");
  upstreamUrl.searchParams.set("sort_type", sort);
  upstreamUrl.searchParams.set("note_type", "不限");
  upstreamUrl.searchParams.set("time_filter", time);

  try {
    const upstream = await fetch(upstreamUrl, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    });
    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const providerMessage = readableMessage(payload?.message_zh ?? payload?.message ?? payload?.detail ?? payload);
      return reply({
        error: `查询失败：${providerMessage}`,
        providerStatus: upstream.status,
        providerCode: payload?.code ?? null,
      }, upstream.status);
    }
    return reply({
      keyword,
      updatedAt: new Date().toISOString(),
      source: "live",
      sourceName: "TikHub · 小红书搜索",
      topics: normalizeTikHubResponse(payload, keyword),
    });
  } catch (error) {
    const message = error?.name === "TimeoutError" ? "数据服务响应超时，请稍后重试" : "暂时无法连接数据服务";
    return reply({ error: message }, 502);
  }
};

export const config = { path: "/api/search" };
