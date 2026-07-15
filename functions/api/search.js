const ENDPOINT = "https://api.tikhub.io/api/v1/xiaohongshu/app_v2/search_notes";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": status === 200 ? "public, max-age=0, s-maxage=300" : "no-store",
    "x-content-type-options": "nosniff",
  },
});

function count(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "0").trim().replaceAll(",", "");
  const numeric = Number.parseFloat(text) || 0;
  if (text.includes("万")) return Math.round(numeric * 10000);
  if (text.includes("亿")) return Math.round(numeric * 100000000);
  return Math.round(numeric);
}

function itemsOf(payload) {
  return [payload?.data?.data?.items, payload?.data?.items, payload?.data?.notes, payload?.items, payload?.notes]
    .find(Array.isArray) ?? [];
}

function normalize(payload, keyword) {
  return itemsOf(payload).map((item) => {
    const card = item?.note_card ?? item?.noteCard ?? item?.card ?? item ?? {};
    const interact = card?.interact_info ?? card?.interactInfo ?? card?.interaction ?? {};
    const likes = count(interact?.liked_count ?? interact?.likedCount ?? card?.liked_count);
    const collects = count(interact?.collected_count ?? interact?.collectedCount ?? card?.collected_count);
    const comments = count(interact?.comment_count ?? interact?.commentCount ?? card?.comment_count);
    const shares = count(interact?.shared_count ?? interact?.share_count ?? interact?.sharedCount);
    const id = String(item?.id ?? item?.note_id ?? card?.note_id ?? card?.noteId ?? "");
    return {
      id,
      title: String(card?.display_title ?? card?.displayTitle ?? card?.title ?? item?.title ?? `${keyword}相关热门内容`).trim(),
      author: String(card?.user?.nickname ?? card?.author?.nickname ?? card?.user?.name ?? "小红书用户").trim(),
      heat: Math.round(likes + collects * 1.5 + comments * 2 + shares * 3),
      likes,
      collects,
      comments,
      shares,
      url: id ? `https://www.xiaohongshu.com/explore/${id}` : "https://www.xiaohongshu.com/",
    };
  }).filter((item) => item.title)
    .sort((a, b) => b.heat - a.heat)
    .slice(0, 30)
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const keyword = String(url.searchParams.get("keyword") ?? "").trim().slice(0, 50);
  if (!keyword) return json({ error: "请输入要查询的关键词" }, 400);
  if (!context.env.TIKHUB_API_TOKEN) return json({ error: "实时数据接口尚未配置" }, 503);

  const sort = ["general", "time_descending", "popularity_descending", "comment_descending", "collect_descending"]
    .includes(url.searchParams.get("sort_type")) ? url.searchParams.get("sort_type") : "popularity_descending";
  const time = ["不限", "一天内", "一周内", "半年内"].includes(url.searchParams.get("time_filter"))
    ? url.searchParams.get("time_filter") : "一周内";
  const upstreamUrl = new URL(ENDPOINT);
  upstreamUrl.searchParams.set("keyword", keyword);
  upstreamUrl.searchParams.set("page", "1");
  upstreamUrl.searchParams.set("sort_type", sort);
  upstreamUrl.searchParams.set("note_type", "不限");
  upstreamUrl.searchParams.set("time_filter", time);

  try {
    const upstream = await fetch(upstreamUrl, {
      headers: { Authorization: `Bearer ${context.env.TIKHUB_API_TOKEN}`, Accept: "application/json" },
    });
    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      const hint = upstream.status === 401 || upstream.status === 403
        ? "密钥未获授权，请在 TikHub 检查小红书 App 权限"
        : payload?.message_zh || payload?.message || `数据服务返回 ${upstream.status}`;
      return json({ error: `查询失败：${hint}` }, upstream.status);
    }
    return json({ keyword, updatedAt: new Date().toISOString(), source: "live", sourceName: "TikHub · 小红书搜索", topics: normalize(payload, keyword) });
  } catch {
    return json({ error: "暂时无法连接数据服务，请稍后再试" }, 502);
  }
}
