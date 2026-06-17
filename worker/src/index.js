// 免稅不是免費 — 價格後端 Worker
// GET /price?item=<中文>&country=jp|kr[&term=<指定關鍵字>]
//  1. AI 想 1~3 個可能的日文/韓文搜尋關鍵字（模糊搜尋）
//  2. 韓國：查 Naver 回「候選商品清單」(名稱/價格/圖)，由使用者選
//     日本：只回關鍵字＋匯率（前端瀏覽器自己直連樂天，因 Worker 帶不了 Referer）

const RAKUTEN_REFERER = 'https://andy30019123agent-ship-it.github.io/';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS },
  });
}

// AI：把中文商品名翻成當地語言的搜尋關鍵字（候選來自搜尋結果，不必多個關鍵字）
async function guessTerms(env, item, country) {
  const lang = country === 'kr' ? 'Korean' : 'Japanese';
  const hint = country === 'kr'
    ? 'Use the official Korean brand/product name with correct Hangul.'
    : 'Use the official Japanese brand/product name with correct Kanji/Katakana (NOT all-hiragana).';
  const prompt =
    `A Taiwanese tourist wants to buy "${item}" in ${country === 'kr' ? 'Korea' : 'Japan'}. ` +
    `The input may be a formal name, a brand, OR a Taiwanese nickname / slang term for the product ` +
    `(e.g. "小護士"=メンソレータム, "魔法瓶"=サーモス, 韓國"后"=Whoo). ` +
    `First figure out which actual product it refers to, then give the single best ${lang} search keyword ` +
    `used on ${lang} shopping sites to find that product. ` +
    `${hint} Use the real local brand/product name, not a literal character-by-character translation. ` +
    `Reply with ONLY the keyword — no quotes, no romaji, no explanation.\n\nProduct: ${item}`;
  try {
    const r = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 40,
      temperature: 0,
    });
    const t = (r.response || '').trim().split('\n')[0].replace(/^["「『]|["」』]$/g, '').trim();
    return [t || item];
  } catch {
    return [item];
  }
}

async function rate(from) {
  try {
    const j = await (await fetch(`https://open.er-api.com/v6/latest/${from}`)).json();
    return j?.rates?.TWD || null;
  } catch { return null; }
}
const FALLBACK_RATE = { JPY: 0.21, KRW: 0.023 };

// 韓國：查 Naver，回候選商品（跨關鍵字合併、去重）
async function naverCandidates(env, terms) {
  const seen = new Set();
  const out = [];
  for (const term of terms.slice(0, 2)) {
    const url = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(term)}&display=12&sort=sim`;
    const r = await fetch(url, {
      headers: { 'X-Naver-Client-Id': env.NAVER_ID, 'X-Naver-Client-Secret': env.NAVER_SECRET },
    });
    if (!r.ok) continue;
    const j = await r.json();
    for (const i of (j.items || [])) {
      const title = (i.title || '').replace(/<[^>]+>/g, '').trim();
      const price = parseInt(i.lprice);
      if (!title || !price) continue;
      const key = title.slice(0, 14);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ title, price, image: i.image || '', mall: i.mallName || '' });
      if (out.length >= 10) break;
    }
    if (out.length >= 10) break;
  }
  return out;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    if (url.pathname !== '/price') return json({ ok: false, error: 'use /price?item=..&country=jp|kr' }, 404);

    const item = (url.searchParams.get('item') || '').trim();
    const country = url.searchParams.get('country') === 'kr' ? 'kr' : 'jp';
    const givenTerm = (url.searchParams.get('term') || '').trim();
    if (!item && !givenTerm) return json({ ok: false, error: 'missing item' }, 400);

    try {
      const terms = givenTerm ? [givenTerm] : await guessTerms(env, item, country);

      if (country === 'jp') {
        const jpyRate = (await rate('JPY')) || FALLBACK_RATE.JPY;
        return json({ ok: true, country: 'jp', terms, rate: jpyRate, currency: '¥' });
      }

      const candidates = await naverCandidates(env, terms);
      const krwRate = (await rate('KRW')) || FALLBACK_RATE.KRW;
      return json({ ok: true, country: 'kr', terms, rate: krwRate, currency: '₩', candidates });
    } catch (e) {
      return json({ ok: false, error: String(e.message || e) }, 502);
    }
  },
};
