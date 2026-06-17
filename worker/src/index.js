// 免稅不是免費 — 價格後端 Worker
// GET /price?item=<中文>&country=jp|kr[&term=<已翻譯詞>]
//  1. 用 AI 把中文商品名翻成日文/韓文（若已給 term 則跳過）
//  2. 查樂天(jp) 或 Naver(kr) 取得售價＋圖片
//  3. 算「典型單盒價」(濾掉整箱/配件離群值) 與區間，換算台幣
//  4. 回傳 JSON（含 CORS）

const ALLOWED_ORIGIN = '*';
const RAKUTEN_REFERER = 'https://andy30019123agent-ship-it.github.io/';

const CORS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS },
  });
}

// 取中位數
function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

// 濾掉離群值（整箱/批發/配件）：取中位數附近 0.4x~2.2x 的價格當「典型單盒」
function typicalPrices(prices) {
  const valid = prices.filter(p => p > 0).sort((a, b) => a - b);
  if (valid.length < 3) return valid;
  const med = median(valid);
  return valid.filter(p => p >= med * 0.4 && p <= med * 2.2);
}

async function translate(env, item, country) {
  const lang = country === 'kr' ? 'Korean' : 'Japanese';
  const hint = country === 'kr'
    ? 'Use the official Korean product/brand name with correct Hangul.'
    : 'Use the official Japanese product/brand name exactly as printed on the package and shopping sites (use the correct Kanji/Katakana, NOT all-hiragana).';
  const prompt =
    `You are a shopping search assistant. Convert this product or brand name (written in Chinese) ` +
    `into the exact ${lang} keyword used on ${lang} shopping websites. ${hint} ` +
    `Reply with ONLY the ${lang} keyword — no quotes, no romaji, no explanation.\n\nProduct: ${item}`;
  try {
    const r = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 40,
      temperature: 0,
    });
    let t = (r.response || '').trim().split('\n')[0].replace(/^["「『]|["」』]$/g, '').trim();
    return t || item;
  } catch (e) {
    return item; // 翻譯失敗就用原字
  }
}

async function rate(from) {
  try {
    const r = await fetch(`https://open.er-api.com/v6/latest/${from}`);
    const j = await r.json();
    return j?.rates?.TWD || null;
  } catch {
    return null;
  }
}
const FALLBACK_RATE = { JPY: 0.21, KRW: 0.023 };

async function searchRakuten(env, term) {
  const url = `https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260401` +
    `?applicationId=${env.RAKUTEN_APP_ID}&accessKey=${env.RAKUTEN_ACCESS_KEY}` +
    `&keyword=${encodeURIComponent(term)}&hits=30&format=json`;
  const r = await fetch(url, { headers: { Referer: RAKUTEN_REFERER } });
  if (!r.ok) { const b = await r.text(); throw new Error(`rakuten ${r.status}: ${b.slice(0,160)}`); }
  const j = await r.json();
  const items = (j.Items || []).map(x => x.Item || x);
  return items.map(i => ({ price: i.itemPrice, image: (i.mediumImageUrls?.[0]?.imageUrl) || i.smallImageUrls?.[0]?.imageUrl || '' }));
}

async function searchNaver(env, term) {
  const url = `https://openapi.naver.com/v1/search/shop.json?query=${encodeURIComponent(term)}&display=30&sort=sim`;
  const r = await fetch(url, {
    headers: {
      'X-Naver-Client-Id': env.NAVER_ID,
      'X-Naver-Client-Secret': env.NAVER_SECRET,
    },
  });
  if (!r.ok) throw new Error(`naver ${r.status}`);
  const j = await r.json();
  return (j.items || []).map(i => ({ price: parseInt(i.lprice), image: i.image || '' }));
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
      const term = givenTerm || await translate(env, item, country);

      // 日本：後端無法帶 Referer 給樂天，改回傳翻譯詞＋匯率，由前端瀏覽器直接查樂天
      if (country === 'jp') {
        const jpyRate = (await rate('JPY')) || FALLBACK_RATE.JPY;
        return json({ ok: true, country: 'jp', term, rate: jpyRate });
      }

      const raw = await searchNaver(env, term);
      const prices = raw.map(x => x.price).filter(p => p > 0);
      const typ = typicalPrices(prices);
      if (!typ.length) return json({ ok: true, country, term, typical: null, count: 0 });

      const typical = median(typ);
      // 找出最接近典型價、且有圖片的商品當代表圖
      let image = '';
      let best = Infinity;
      for (const x of raw) {
        if (x.price > 0 && x.image && Math.abs(x.price - typical) < best) {
          best = Math.abs(x.price - typical); image = x.image;
        }
      }

      const cur = country === 'kr' ? 'KRW' : 'JPY';
      const tw = (await rate(cur)) || FALLBACK_RATE[cur];

      return json({
        ok: true, country, term,
        currency: cur === 'JPY' ? '¥' : '₩',
        typical, min: typ[0], max: typ[typ.length - 1],
        twd: Math.round(typical * tw),
        image, count: typ.length,
      });
    } catch (e) {
      return json({ ok: false, error: String(e.message || e) }, 502);
    }
  },
};
