const TIKHUB_ENDPOINT = "https://api.tikhub.io/api/v1/xiaohongshu/app_v2/search_notes";

function parseCount(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "0").trim().replaceAll(",", "");
  const numeric = Number.parseFloat(text) || 0;
  if (text.includes("万")) return Math.round(numeric * 10000);
  if (text.includes("亿")) return Math.round(numeric * 100000000);
  return Math.round(numeric);
}

function findItems(payload) {
  const candidates = [
    payload?.data?.data?.items,
    payload?.data?.items,
    payload?.data?.notes,
    payload?.items,
    payload?.notes,
  ];
  return candidates.find(Array.isArray) ?? [];
}

function normalizeItem(item, keyword, index) {
  const card = item?.note_card ?? item?.noteCard ?? item?.card ?? item ?? {};
  const interact = card?.interact_info ?? card?.interactInfo ?? card?.interaction ?? {};
  const likes = parseCount(interact?.liked_count ?? interact?.likedCount ?? card?.liked_count);
  const collects = parseCount(interact?.collected_count ?? interact?.collectedCount ?? card?.collected_count);
  const comments = parseCount(interact?.comment_count ?? interact?.commentCount ?? card?.comment_count);
  const shares = parseCount(interact?.shared_count ?? interact?.share_count ?? interact?.sharedCount);
  const heat = Math.round(likes + collects * 1.5 + comments * 2 + shares * 3);
  const noteId = item?.id ?? item?.note_id ?? card?.note_id ?? card?.noteId ?? "";
  const title = String(card?.display_title ?? card?.displayTitle ?? card?.title ?? item?.title ?? `${keyword}相关热门内容`).trim();
  const author = String(card?.user?.nickname ?? card?.author?.nickname ?? card?.user?.name ?? "小红书用户").trim();

  return {
    rank: index + 1,
    id: String(noteId),
    title,
    category: "搜索结果",
    heat,
    likes,
    collects,
    comments,
    shares,
    author,
    notes: 1,
    engagement: likes + collects + comments + shares,
    growth: 0,
    sentiment: "中性",
    keywords: [keyword, author].filter(Boolean),
    sparkline: [24, 31, 36, 45, 52, 64, 78, 92],
    url: noteId ? `https://www.xiaohongshu.com/explore/${noteId}` : "https://www.xiaohongshu.com/",
  };
}

export function normalizeTikHubResponse(payload, keyword) {
  return findItems(payload)
    .map((item, index) => normalizeItem(item, keyword, index))
    .filter((item) => item.title)
    .sort((a, b) => b.heat - a.heat)
    .slice(0, 30)
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "仅支持 GET 请求" });
  }

  const keyword = String(request.query?.keyword ?? "").trim().slice(0, 50);
  if (!keyword) return response.status(400).json({ error: "请输入要查询的关键词" });

  const token = process.env.TIKHUB_API_TOKEN;
  if (!token) {
    return response.status(503).json({ error: "实时数据接口尚未配置，请先在部署平台添加 TIKHUB_API_TOKEN" });
  }

  const sortType = ["general", "time_descending", "popularity_descending", "comment_descending", "collect_descending"]
    .includes(request.query?.sort_type) ? request.query.sort_type : "popularity_descending";
  const timeFilter = ["不限", "一天内", "一周内", "半年内"].includes(request.query?.time_filter)
    ? request.query.time_filter : "一周内";
  const url = new URL(TIKHUB_ENDPOINT);
  url.searchParams.set("keyword", keyword);
  url.searchParams.set("page", "1");
  url.searchParams.set("sort_type", sortType);
  url.searchParams.set("note_type", "不限");
  url.searchParams.set("time_filter", timeFilter);

  try {
    const upstream = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
    });
    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const permissionHint = upstream.status === 401 || upstream.status === 403
        ? "密钥未获授权，请在 TikHub 检查小红书 App 权限"
        : "";
      const detail = permissionHint || payload?.message_zh || payload?.message || payload?.detail || `数据服务返回 ${upstream.status}`;
      return response.status(upstream.status).json({ error: `查询失败：${detail}` });
    }

    const topics = normalizeTikHubResponse(payload, keyword);
    response.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=600");
    return response.status(200).json({
      keyword,
      updatedAt: new Date().toISOString(),
      source: "live",
      sourceName: "TikHub · 小红书搜索",
      topics,
    });
  } catch (error) {
    const message = error?.name === "TimeoutError" ? "数据服务响应超时，请稍后重试" : "暂时无法连接数据服务";
    return response.status(502).json({ error: message });
  }
}
