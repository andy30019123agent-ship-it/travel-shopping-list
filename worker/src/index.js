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

// 常見台灣客藥妝／伴手禮對照表（綽號/漢字品牌 → 當地搜尋字）
const JP_DICT = {
  '合利他命': 'アリナミンEX', '合力他命': 'アリナミンEX',
  '表飛鳴': '新ビオフェルミンS', '新表飛鳴': '新ビオフェルミンS', '欣表飛鳴': '新ビオフェルミンS',
  '撒隆巴斯': 'サロンパス', '小護士': 'メンソレータム', '面速力達母': 'メンソレータム', '曼秀雷敦': 'メンソレータム',
  '蓋舒泰': 'ガスター10', '龍角散': '龍角散', '休足時間': '休足時間',
  '命之母': '命の母', '命的母': '命の母', '太田胃散': '太田胃散',
  '百保能': 'パブロン', '大正感冒藥': 'パブロン',
  '止痛藥': 'イブA錠', '安美露': 'アンメルツヨコヨコ', '安膜露': 'アンメルツヨコヨコ',
  '蒸氣眼罩': 'めぐりズム 蒸気でホットアイマスク', '美舒律': 'めぐりズム',
  '小花眼藥水': 'ロートリセ', '樂敦眼藥水': 'ロート Vロート',
  '娥羅納英': 'オロナインH軟膏', '正露丸': '正露丸', '口內炎貼片': '口内炎パッチ大正',
  '白色戀人': '白い恋人', '東京香蕉': '東京ばな奈', '東京芭娜娜': '東京ばな奈',
  '薯條三兄弟': 'じゃがポックル', '皇家奶茶': 'ロイヤルミルクティー', '一蘭拉麵': '一蘭 ラーメン',
  '魔法瓶': 'サーモス', '保溫瓶': 'サーモス', '雪肌精': '雪肌精', '極潤': '肌研 極潤',
  '牛乳石鹼': '牛乳石鹸', '碧柔': 'ビオレ', '洗顏專科': '専科 洗顔',
  '液體絆創膏': '液体絆創膏', '液體OK繃': '液体絆創膏',
};
const KR_DICT = {
  '雪花秀': '설화수', '后': '더 후 Whoo', '愛茉莉': '아모레퍼시픽', '正官庄': '정관장',
  '蘭芝': '라네즈', '蜂蜜唇膜': '라네즈 립 슬리핑 마스크', '悅詩風吟': '이니스프리',
  '菲詩小舖': '더페이스샵', '香蕉牛奶': '바나나맛 우유', '辛拉麵': '신라면',
  '蜂蜜奶油杏仁': '허니버터아몬드', '紅蔘': '홍삼',
};

function normalize(s) { return (s || '').replace(/\s+/g, '').trim(); }
function lev(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
// 容錯查表：完全相符 → 子字串包含 → 編輯距離(錯字)
function dictLookup(dict, input) {
  const q = normalize(input);
  if (!q) return null;
  if (dict[q]) return dict[q];
  let best = null, bestScore = Infinity;
  for (const key of Object.keys(dict)) {
    const k = normalize(key);
    if (k.length >= 2 && (q.includes(k) || k.includes(q))) {
      const s = Math.abs(q.length - k.length);
      if (s < bestScore) { bestScore = s; best = dict[key]; }
      continue;
    }
    if (Math.abs(q.length - k.length) <= 1 && k.length >= 2) {
      const d = lev(q, k);
      const thr = q.length <= 4 ? 1 : 2;
      if (d <= thr && d < bestScore) { bestScore = d; best = dict[key]; }
    }
  }
  return best;
}

// AI：把中文商品名翻成當地語言的搜尋關鍵字（候選來自搜尋結果，不必多個關鍵字）
async function guessTerms(env, item, country) {
  // 先查對照表（含容錯），命中就不必呼叫 AI
  const hit = dictLookup(country === 'kr' ? KR_DICT : JP_DICT, item);
  if (hit) return [hit];
  const lang = country === 'kr' ? 'Korean' : 'Japanese';
  const hint = country === 'kr'
    ? 'Use the official Korean brand/product name with correct Hangul.'
    : 'Use the official Japanese brand/product name with correct Kanji/Katakana (NOT all-hiragana).';
  const prompt =
    `A Taiwanese tourist wants to buy "${item}" in ${country === 'kr' ? 'Korea' : 'Japan'}. ` +
    `The input may be a formal name, a brand, a Taiwanese nickname/slang, a Taiwanese transliteration of a ` +
    `Japanese/Korean drugstore brand, OR contain typos (e.g. "小護士"=メンソレータム, "魔法瓶"=サーモス, ` +
    `"合利他命"=アリナミン, "表飛鳴"=新ビオフェルミン, 韓國"后"=Whoo). ` +
    `Correct obvious typos, then figure out which actual product it refers to, then give the single best ${lang} search keyword ` +
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

// 貼網址 → 抓商品頁標題當搜尋來源
async function extractFromUrl(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MenshuiBot/1.0)' } });
    if (!r.ok) return '';
    const html = await r.text();
    let title = '';
    const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
    if (og) title = og[1];
    else { const t = html.match(/<title[^>]*>([^<]+)/i); if (t) title = t[1]; }
    title = title.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').trim();
    title = title.split(/\s*[|｜\-–—]\s*/)[0].trim(); // 去掉站名後綴
    return title;
  } catch { return ''; }
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

    let item = (url.searchParams.get('item') || '').trim();
    const country = url.searchParams.get('country') === 'kr' ? 'kr' : 'jp';
    const givenTerm = (url.searchParams.get('term') || '').trim();
    if (!item && !givenTerm) return json({ ok: false, error: 'missing item' }, 400);

    try {
      // 貼網址 → 先抓商品標題當搜尋字
      let fromUrl = '';
      if (/^https?:\/\//i.test(item)) {
        fromUrl = await extractFromUrl(item);
        if (fromUrl) item = fromUrl;
      }
      const terms = givenTerm ? [givenTerm] : await guessTerms(env, item, country);

      if (country === 'jp') {
        const jpyRate = (await rate('JPY')) || FALLBACK_RATE.JPY;
        return json({ ok: true, country: 'jp', terms, rate: jpyRate, currency: '¥', resolved: fromUrl });
      }

      const candidates = await naverCandidates(env, terms);
      const krwRate = (await rate('KRW')) || FALLBACK_RATE.KRW;
      return json({ ok: true, country: 'kr', terms, rate: krwRate, currency: '₩', candidates, resolved: fromUrl });
    } catch (e) {
      return json({ ok: false, error: String(e.message || e) }, 502);
    }
  },
};
