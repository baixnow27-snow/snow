import { aggregateSearchTopics, normalizeTikHubResponse } from "../../api/search.js";

const ENDPOINT = "https://api.tikhub.io/api/v1/xiaohongshu/app_v2/search_notes";
const reply = (body, status = 200) => Response.json(body, {
  status,
  headers: {
    "cache-control": status === 200 ? "public, max-age=0, s-maxage=300" : "no-store",
    "x-content-type-options": "nosniff",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-headers": "Content-Type",
  },
});

const findNestedValue = (input, keys) => {
  const queue = [input];
  const visited = new Set();
  while (queue.length) {
    const value = queue.shift();
    if (!value || typeof value !== "object" || visited.has(value)) continue;
    visited.add(value);
    for (const key of keys) {
      if (typeof value[key] === "string" && value[key]) return value[key];
    }
    for (const child of Object.values(value)) {
      if (child && typeof child === "object") queue.push(child);
    }
  }
  return "";
};

export default async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS", "access-control-allow-headers": "Content-Type" } });
  if (request.method !== "GET") return reply({ error: "仅支持 GET 请求" }, 405);
  const requestUrl = new URL(request.url);
  const keyword = String(requestUrl.searchParams.get("keyword") ?? "").trim().slice(0, 50);
  const industry = String(requestUrl.searchParams.get("industry") ?? "全部行业").trim().slice(0, 30);
  if (!keyword) return reply({ error: "请输入要查询的关键词" }, 400);
  const token = process.env.TIKHUB_API_TOKEN;
  if (!token) return reply({ error: "实时数据接口尚未配置" }, 503);

  const sort = ["general", "time_descending", "popularity_descending", "comment_descending", "collect_descending"]
    .includes(requestUrl.searchParams.get("sort_type")) ? requestUrl.searchParams.get("sort_type") : "popularity_descending";
  const time = ["不限", "一天内", "一周内", "半年内"].includes(requestUrl.searchParams.get("time_filter"))
    ? requestUrl.searchParams.get("time_filter") : "一周内";
  const buildUrl = (page, searchId = "", searchSessionId = "") => {
    const url = new URL(ENDPOINT);
    url.searchParams.set("keyword", keyword);
    url.searchParams.set("page", String(page));
    url.searchParams.set("sort_type", sort);
    url.searchParams.set("note_type", "不限");
    url.searchParams.set("time_filter", time);
    url.searchParams.set("source", "explore_feed");
    url.searchParams.set("ai_mode", "0");
    if (searchId) url.searchParams.set("search_id", searchId);
    if (searchSessionId) url.searchParams.set("search_session_id", searchSessionId);
    return url;
  };
  const fetchPage = async (page, searchId = "", searchSessionId = "") => {
    const response = await fetch(buildUrl(page, searchId, searchSessionId), {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(25000),
    });
    return { response, payload: await response.json().catch(() => ({})) };
  };

  try {
    const first = await fetchPage(1);
    if (!first.response.ok) {
      const hint = first.response.status === 401 || first.response.status === 403
        ? "密钥未获授权，请在 TikHub 检查小红书 App 权限"
        : first.payload?.message_zh || first.payload?.message || `数据服务返回 ${first.response.status}`;
      return reply({ error: `查询失败：${hint}` }, first.response.status);
    }
    const payloads = [first.payload];
    const searchId = findNestedValue(first.payload, ["search_id", "searchId"]);
    const searchSessionId = findNestedValue(first.payload, ["search_session_id", "searchSessionId"]);
    if (searchId && searchSessionId) {
      for (const page of [2, 3]) {
        const next = await fetchPage(page, searchId, searchSessionId);
        if (!next.response.ok) break;
        payloads.push(next.payload);
      }
    }
    const seen = new Set();
    const notes = payloads
      .flatMap((payload) => normalizeTikHubResponse(payload, keyword))
      .filter((topic) => {
        const key = topic.id || topic.url || topic.title;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => b.heat - a.heat);
    const topics = aggregateSearchTopics(notes, keyword, industry);
    return reply({
      keyword,
      updatedAt: new Date().toISOString(),
      source: "live",
      sourceName: "TikHub · 小红书搜索",
      topics,
    });
  } catch (error) {
    const message = error?.name === "TimeoutError" ? "数据服务响应超时，请稍后重试" : "暂时无法连接数据服务";
    return reply({ error: message }, 502);
  }
};

export const config = { path: "/api/search" };
