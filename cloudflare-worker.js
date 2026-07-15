import { onRequestGet as searchNotes } from "./functions/api/search.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/search") {
      if (request.method !== "GET") {
        return new Response(JSON.stringify({ error: "仅支持 GET 请求" }), {
          status: 405,
          headers: { "content-type": "application/json; charset=utf-8", Allow: "GET" },
        });
      }
      return searchNotes({ request, env });
    }

    return env.ASSETS.fetch(request);
  },
};
