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
  const description = String(card?.desc ?? card?.description ?? item?.desc ?? item?.description ?? "").trim();
  const tags = [
    ...(Array.isArray(card?.tag_list) ? card.tag_list : []),
    ...(Array.isArray(card?.tags) ? card.tags : []),
  ].map((tag) => String(tag?.name ?? tag?.title ?? tag ?? "").trim()).filter(Boolean);

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
    description,
    tags,
    notes: 1,
    engagement: likes + collects + comments + shares,
    growth: 0,
    sentiment: "中性",
    keywords: [keyword, author].filter(Boolean),
    sparkline: [24, 31, 36, 45, 52, 64, 78, 92],
    url: noteId ? `https://www.xiaohongshu.com/explore/${noteId}` : "https://www.xiaohongshu.com/",
  };
}

const INDUSTRY_RULES = {
  "美妆护肤": ["护肤", "抗老", "抗衰", "细纹", "皱纹", "面霜", "精华", "防晒", "妆容", "口红", "美容", "医美"],
  "健康": ["健康", "更年期", "睡眠", "失眠", "体检", "运动", "健身", "瑜伽", "激素", "衰老", "养生"],
  "职场": ["职场", "工作", "事业", "转型", "创业", "退休", "晋升", "领导", "裁员", "副业"],
  "情感关系": ["婚姻", "离婚", "伴侣", "爱情", "恋爱", "单身", "独处", "家庭", "亲密关系", "育儿"],
  "财务": ["财务", "存款", "理财", "养老", "退休金", "保险", "买房", "资产", "赚钱", "消费"],
  "生活方式": ["旅行", "穿搭", "生活", "家居", "读书", "兴趣", "社交", "松弛感", "自洽", "自由"],
};

const ZHONGNV_TOPIC_RULES = [
  ["中女的自我接纳与年龄焦虑", "女性成长", ["年龄焦虑", "年龄", "衰老", "变老", "自洽", "接纳", "年轻", "少女感"]],
  ["中女的职场转型与第二曲线", "职场", ["职场", "转型", "事业", "工作", "创业", "副业", "退休", "裁员", "第二曲线"]],
  ["中女的婚姻、离婚与亲密关系", "情感关系", ["婚姻", "离婚", "伴侣", "亲密关系", "爱情", "恋爱", "老公", "夫妻"]],
  ["中女的独处、单身与自由生活", "生活方式", ["独处", "单身", "自由", "一个人", "不婚", "松弛感", "生活方式"]],
  ["中女的抗老护肤与自然变美", "美妆护肤", ["抗老", "抗衰", "护肤", "细纹", "皱纹", "面霜", "精华", "美容", "医美", "变美"]],
  ["中女的健康管理与更年期", "健康", ["健康", "更年期", "睡眠", "失眠", "体检", "激素", "运动", "养生", "健身"]],
  ["中女的财务安全与养老规划", "财务", ["财务", "存款", "理财", "养老", "退休金", "保险", "资产", "买房", "赚钱"]],
  ["中女的穿搭、体态与气质", "生活方式", ["穿搭", "体态", "气质", "发型", "衣服", "身材", "审美"]],
  ["中女的家庭责任与育儿边界", "情感关系", ["家庭", "育儿", "孩子", "父母", "妈妈", "母亲", "边界"]],
  ["中女的旅行、兴趣与精神生活", "生活方式", ["旅行", "兴趣", "读书", "精神", "社交", "爱好", "悦己"]],
];

function aliasesFor(keyword) {
  return keyword === "中女" ? ["中女", "中年女性", "成熟女性", "35+女性", "40+女性", "四十岁女人", "中年女人"] : [keyword];
}

function detectIndustry(text) {
  let best = ["其他", 0];
  for (const [industry, words] of Object.entries(INDUSTRY_RULES)) {
    const score = words.filter((word) => text.includes(word)).length;
    if (score > best[1]) best = [industry, score];
  }
  return best[0];
}

function fallbackTopicTitle(note, keyword) {
  const hashtags = `${note.title} ${note.description}`.match(/#[^#\s，。！？、]{2,20}/g) ?? [];
  if (hashtags[0]) return hashtags[0].slice(1);
  const cleaned = note.title
    .replaceAll(keyword, "")
    .replace(/[｜|丨:：—_「」【】()[\]#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.slice(0, 22) || `${keyword}相关讨论`;
}

export function aggregateSearchTopics(notes, keyword, industry = "全部行业") {
  const aliases = aliasesFor(keyword);
  const direct = notes.filter((note) => {
    const text = `${note.title} ${note.description} ${(note.tags ?? []).join(" ")}`;
    if (!aliases.some((alias) => text.includes(alias))) return false;
    if (industry === "全部行业") return true;
    return (INDUSTRY_RULES[industry] ?? []).some((word) => text.includes(word));
  });
  const groups = new Map();
  for (const note of direct) {
    const text = `${note.title} ${note.description} ${(note.tags ?? []).join(" ")}`;
    let name;
    let topicIndustry;
    let matchedWords = [];
    if (keyword === "中女") {
      const matches = ZHONGNV_TOPIC_RULES
        .map(([title, groupIndustry, words]) => ({ title, groupIndustry, matched: words.filter((word) => text.includes(word)) }))
        .filter((item) => item.matched.length)
        .sort((a, b) => b.matched.length - a.matched.length);
      if (matches[0]) {
        name = matches[0].title;
        topicIndustry = matches[0].groupIndustry;
        matchedWords = matches[0].matched;
      }
    }
    name ||= fallbackTopicTitle(note, keyword);
    topicIndustry ||= detectIndustry(text);
    matchedWords = [...new Set([...matchedWords, ...aliases.filter((alias) => text.includes(alias))])];
    const current = groups.get(name) ?? { title: name, category: topicIndustry, notes: [], heat: 0, likes: 0, collects: 0, comments: 0, shares: 0, words: new Set() };
    current.notes.push(note);
    current.heat += note.heat;
    current.likes += note.likes;
    current.collects += note.collects;
    current.comments += note.comments;
    current.shares += note.shares;
    matchedWords.forEach((word) => current.words.add(word));
    groups.set(name, current);
  }
  return [...groups.values()]
    .sort((a, b) => b.heat - a.heat || b.notes.length - a.notes.length)
    .slice(0, 50)
    .map((group, index) => ({
      rank: index + 1,
      id: `topic-${index + 1}`,
      title: group.title,
      category: group.category,
      heat: group.heat,
      likes: group.likes,
      collects: group.collects,
      comments: group.comments,
      shares: group.shares,
      notes: group.notes.length,
      engagement: group.likes + group.collects + group.comments + group.shares,
      growth: 0,
      sentiment: "中性",
      keywords: [...group.words].slice(0, 5),
      sparkline: [24, 31, 36, 45, 52, 64, 78, 92],
      sampleTitles: group.notes.slice(0, 3).map((note) => note.title),
      url: group.notes[0]?.url,
    }));
}

export function normalizeTikHubResponse(payload, keyword) {
  return findItems(payload)
    .map((item, index) => normalizeItem(item, keyword, index))
    .filter((item) => item.title)
    .sort((a, b) => b.heat - a.heat)
    .slice(0, 100)
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

    const notes = normalizeTikHubResponse(payload, keyword);
    const industry = String(request.query?.industry ?? "全部行业");
    const topics = aggregateSearchTopics(notes, keyword, industry);
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
