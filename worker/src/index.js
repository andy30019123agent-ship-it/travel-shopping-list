// 免稅不是免費 — 價格後端 Worker
// GET /price?item=<中文>&country=jp|kr[&term=<指定關鍵字>]
//  1. AI 想 1~3 個可能的日文/韓文搜尋關鍵字（模糊搜尋）
//  2. 韓國：查 Naver 回「候選商品清單」(名稱/價格/圖)，由使用者選
//     日本：只回關鍵字＋匯率（前端瀏覽器自己直連樂天，因 Worker 帶不了 Referer）

const RAKUTEN_REFERER = 'https://andy30019123agent-ship-it.github.io/';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
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
  // DHC 保健食品（台灣遊客熱門，「精華/萃取」日文不用「精華」一詞）
  'DHC藍莓': 'DHC ブルーベリー', 'DHC藍莓精華': 'DHC ブルーベリー', 'DHC藍莓萃取': 'DHC ブルーベリー',
  'DHC維他命C': 'DHC ビタミンC', 'DHC維生素C': 'DHC ビタミンC', 'DHC維他命B群': 'DHC ビタミンBミックス',
  'DHC維他命E': 'DHC ビタミンE', 'DHC葉黃素': 'DHC ルテイン', 'DHC膠原蛋白': 'DHC コラーゲン',
  'DHC魚油': 'DHC DHA', 'DHCDHA': 'DHC DHA', 'DHC鋅': 'DHC 亜鉛', 'DHC鈣': 'DHC カルシウム',
  'DHC鐵': 'DHC ヘム鉄', 'DHC玻尿酸': 'DHC ヒアルロン酸', 'DHC輔酶Q10': 'DHC コエンザイムQ10',
  'DHC大豆異黃酮': 'DHC 大豆イソフラボン', 'DHC綜合維他命': 'DHC マルチビタミン',
  'DHC燃燒': 'DHC フォースコリー', 'DHC瘦身': 'DHC フォースコリー', 'DHC護唇膏': 'DHC 薬用リップクリーム',
  // 常見保健食品通用詞（保健食品用成分名，不加「精華」）
  '葉黃素': 'ルテイン サプリ', '膠原蛋白': 'コラーゲン サプリ', '蝦紅素': 'アスタキサンチン',
  '藍莓精華': 'ブルーベリー サプリ', '深海魚油': 'DHA EPA サプリ', '輔酶Q10': 'コエンザイムQ10',
  '波斯菊葉黃素': 'ルテイン', '善存': 'マルチビタミン',
};
const KR_DICT = {
  '雪花秀': '설화수', '后': '더 후 Whoo', '愛茉莉': '아모레퍼시픽', '正官庄': '정관장',
  '蘭芝': '라네즈', '蜂蜜唇膜': '라네즈 립 슬리핑 마스크', '悅詩風吟': '이니스프리',
  '菲詩小舖': '더페이스샵', '香蕉牛奶': '바나나맛 우유', '辛拉麵': '신라면',
  '蜂蜜奶油杏仁': '허니버터아몬드', '紅蔘': '홍삼',
  // 當紅 K-beauty（含中文俗稱與英文品牌）
  '數字面膜': '넘버즈인 마스크팩', 'numbuzin': '넘버즈인', '넘버즈인': '넘버즈인',
  'torriden': '토리든', '토리든': '토리든', 'torriden玻尿酸面膜': '토리든 다이브인 마스크팩',
  'reju-all': '닥터리쥬올', 'rejuall': '닥터리쥬올', 'drrejuall': '닥터리쥬올', '리쥬올': '닥터리쥬올',
  'anua': '아누아', '아누아': '아누아', 'medicube': '메디큐브', 'mediheal': '메디힐',
  'skin1004': '스킨1004', 'beautyofjoseon': '조선미녀', '朝鮮美女': '조선미녀',
  'roundlab': '라운드랩', 'abib': '아비브', 'tirtir': '티르티르', 'manyo': '마녀공장', '魔女工廠': '마녀공장',
};

function normalize(s) { return (s || '').toLowerCase().replace(/[\s\-_·.・]/g, '').trim(); }
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
  // 逐詞比對：「品牌 + 中文描述」時，抓出已知品牌
  for (const tok of (input || '').split(/[\s,/]+/)) {
    const t = normalize(tok);
    if (t.length >= 2 && dict[t]) return dict[t];
  }
  // 正規化後的鍵也建一份對照
  for (const key of Object.keys(dict)) { if (normalize(key) === q) return dict[key]; }
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

// OpenAI Chat（文字或含圖片的 content），失敗回 null 讓呼叫端退回免費模型
async function openaiChat(env, content, max_tokens = 50, model = 'gpt-4o-mini') {
  if (!env.OPENAI_API_KEY) return null;
  try {
    const body = { model, messages: [{ role: 'user', content }] };
    // gpt-5 系列是推理模型：用 max_completion_tokens(含思考額度)、temperature 只能預設、降低思考量省錢加速
    if (/^gpt-5/.test(model)) { body.max_completion_tokens = Math.max(max_tokens, 1500); body.reasoning_effort = 'low'; }
    else { body.max_tokens = max_tokens; body.temperature = 0; }
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return (j.choices?.[0]?.message?.content || '').trim() || null;
  } catch { return null; }
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
    `The input may be a formal name, a brand, a Taiwanese nickname/slang, a Taiwanese transliteration, ` +
    `an English/romanized brand name, OR contain typos (e.g. "小護士"=メンソレータム, "魔法瓶"=サーモス, ` +
    `"合利他命"=アリナミン, 韓國"后"=Whoo, "numbuzin/數字面膜"=넘버즈인, "Torriden"=토리든, "Anua"=아누아, "Rejuran"=리쥬란). ` +
    `These are often trendy/popular cosmetics, drugstore, or health-supplement items. ` +
    `IMPORTANT: Keep well-known Latin/English brand names in their ORIGINAL Latin spelling (e.g. SENKA, DHC, KOSE, CANMAKE, Bioré, SK-II, Cetaphil) — do NOT phonetically transliterate a brand into kana/Hangul (NOT センクア). Only convert a brand when it has a real official local name (e.g. 資生堂, 雪花秀=설화수). Translate the product-type words into local script. ` +
    (country === 'kr' ? '' : `For health supplements (保健食品/サプリ), translate the INGREDIENT and do NOT keep the cosmetic word "精華"; supplements use the ingredient name or エキス (e.g. 藍莓精華=ブルーベリー, 葉黃素=ルテイン, 維他命C=ビタミンC, 膠原蛋白=コラーゲン, 魚油=DHA). `) +
    `Correct obvious typos, identify the actual (popular) product, then give the single best ${lang} search keyword ` +
    `used on ${lang} shopping sites to find that product. ` +
    `${hint} Use the real local brand/product name, not a literal character-by-character translation. ` +
    `Reply with ONLY the keyword — no quotes, no romaji, no explanation.\n\nProduct: ${item}`;
  const clean = s => (s || '').trim().split('\n')[0].replace(/^["「『]|["」』]$/g, '').trim();
  // 先用 OpenAI（較準），失敗或無金鑰再退回 Workers AI llama
  const oa = await openaiChat(env, prompt, 40);
  if (oa) return [clean(oa) || item];
  try {
    const r = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 40,
      temperature: 0,
    });
    return [clean(r.response) || item];
  } catch {
    return [item];
  }
}

// 貼網址 → 抓商品頁的標題／圖片／價格
function metaContent(html, prop) {
  const m = html.match(new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${prop}["'][^>]+content=["']([^"']+)`, 'i'))
    || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name|itemprop)=["']${prop}["']`, 'i'));
  return m ? m[1].replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').trim() : '';
}
async function extractFromUrl(url) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MenshuiBot/1.0)' } });
    if (!r.ok) return {};
    // 日本網站常用 Shift_JIS / EUC-JP，需依 charset 正確解碼，否則標題會變亂碼
    const buf = await r.arrayBuffer();
    let cs = (r.headers.get('content-type') || '').match(/charset=["']?([\w-]+)/i)?.[1];
    if (!cs) cs = new TextDecoder('latin1').decode(buf.slice(0, 4096)).match(/charset=["']?([\w-]+)/i)?.[1];
    cs = (cs || 'utf-8').toLowerCase().replace('shift_jis', 'shift-jis');
    let html;
    try { html = new TextDecoder(cs).decode(buf); } catch { html = new TextDecoder('utf-8').decode(buf); }
    let title = metaContent(html, 'og:title');
    if (!title) { const t = html.match(/<title[^>]*>([^<]+)/i); if (t) title = t[1].replace(/&amp;/g, '&').trim(); }
    title = title.split(/\s*[|｜\-–—]\s*/)[0].trim();
    const image = metaContent(html, 'og:image');
    const priceStr = metaContent(html, 'product:price:amount') || metaContent(html, 'og:price:amount') || metaContent(html, 'price');
    const price = priceStr ? parseInt(priceStr.replace(/[^\d]/g, '')) : 0;
    return { title, image, price };
  } catch { return {}; }
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
      out.push({ title, price, image: i.image || '', mall: i.mallName || '', url: i.link || '' });
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
    if (url.pathname === '/rate') {
      const [jpy, krw] = await Promise.all([rate('JPY'), rate('KRW')]);
      return json({ ok: true, jpy: jpy || FALLBACK_RATE.JPY, krw: krw || FALLBACK_RATE.KRW });
    }
    if (url.pathname === '/vision') {
      if (request.method !== 'POST') return json({ ok: false, error: 'POST image' }, 405);
      try {
        const body = await request.json();
        const b64 = (body.image || '').replace(/^data:image\/\w+;base64,/, '');
        const visionModel = body.model || 'gpt-4.1-nano'; // 可由前端/測試指定模型，預設 gpt-4.1-nano（實測最準＋最便宜）
        let name = '', info = '', usage = '', claim = '';
        // OpenAI 視覺辨識，回 JSON {name, info, usage, claim}。分層：客觀辨識 vs 行銷宣稱；prompt 加防幻覺規則
        const oa = await openaiChat(env, [
          { type: 'text', text: '這是台灣遊客想買的商品照片。請「只根據包裝上實際看得到的文字、logo、圖案」辨識，不要憑空推測。只回 JSON：{"name":"品牌+品名，簡潔好搜尋(例：numbuzin 無濾鏡提亮防曬精華)。務必把包裝上的品牌讀出來；不要把 SPF、容量、色號、規格塞進來(那些放 claim)，讀不到品牌才只寫品名(繁體中文或當地語言皆可)","info":"客觀說明這是什麼類型的產品與主要用途，一句話，不要誇大效果，也不要提及品牌的國籍或產地(繁體中文約40字)","usage":"使用方式；若是食品就寫口味或食用方式(繁體中文約40字；無法判斷給空字串)","claim":"產品包裝上主打的具體效果或賣點(例 SPF50+、保濕提亮、特定成分訴求)，用「・」分隔的短句(繁體中文約50字；無法判斷給空字串)"}。格式要求：每個欄位只填「內容本身」，不要在值裡重複欄位名稱或加上「這是什麼」「怎麼用」「主打效果」之類前綴或冒號。重要規則：產地、國籍、價格、醫療療效、具體成分含量等「無法從圖片確認」的資訊一律不要編造，寧可省略。若完全無法辨識，name 回 UNKNOWN。不要多餘文字、不要 markdown。' },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
        ], 450, visionModel);
        if (oa) {
          try {
            const m = oa.match(/\{[\s\S]*\}/);
            const obj = m ? JSON.parse(m[0]) : {};
            const n = (obj.name || '').trim().slice(0, 60);
            if (n && !/UNKNOWN|無法|抱歉|sorry|cannot|can't|unable/i.test(n)) {
              name = n;
              info = (obj.info || '').trim().slice(0, 100);
              usage = (obj.usage || '').trim().slice(0, 100);
              claim = (obj.claim || '').trim().slice(0, 120);
            }
          } catch {}
        }
        if (!name) {
          const bin = atob(b64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          const r = await env.AI.run('@cf/llava-hf/llava-1.5-7b-hf', {
            image: [...bytes],
            prompt: 'This is a product a tourist wants to buy. Identify the product and brand. Reply with ONLY the product/brand name (read any visible text/logo on the package), no description.',
            max_tokens: 40,
          });
          name = (r.description || r.response || '').trim().split('\n')[0].slice(0, 60);
        }
        return json({ ok: true, name, info, usage, claim });
      } catch (e) { return json({ ok: false, error: String(e.message || e) }, 502); }
    }
    if (url.pathname !== '/price') return json({ ok: false, error: 'use /price?item=..&country=jp|kr' }, 404);

    let item = (url.searchParams.get('item') || '').trim();
    const country = url.searchParams.get('country') === 'kr' ? 'kr' : 'jp';
    const givenTerm = (url.searchParams.get('term') || '').trim();
    if (!item && !givenTerm) return json({ ok: false, error: 'missing item' }, 400);

    try {
      // 貼網址 → 抓商品頁的標題/圖片/價格
      let fromUrl = {};
      if (/^https?:\/\//i.test(item)) {
        fromUrl = await extractFromUrl(item);
        if (fromUrl.title) item = fromUrl.title;
      }
      const urlExtra = { resolved: fromUrl.title || '', resolvedImage: fromUrl.image || '', resolvedPrice: fromUrl.price || 0 };

      if (country === 'jp') {
        const jpyRate = (await rate('JPY')) || FALLBACK_RATE.JPY;
        const translated = givenTerm ? givenTerm : (await guessTerms(env, item, country))[0];
        return json({ ok: true, country: 'jp', raw: item, term: translated, terms: [translated], rate: jpyRate, currency: '¥', ...urlExtra });
      }

      // 韓國：worker 直接查。先原文搜，不足再翻譯搜。
      const krwRate = (await rate('KRW')) || FALLBACK_RATE.KRW;
      if (givenTerm) {
        const candidates = await naverCandidates(env, [givenTerm]);
        return json({ ok: true, country: 'kr', raw: givenTerm, term: givenTerm, terms: [givenTerm], rate: krwRate, currency: '₩', candidates, ...urlExtra });
      }
      let usedTerm = item;
      let candidates = await naverCandidates(env, [item]); // 原文先搜
      if (candidates.length < 3) {
        const translated = (await guessTerms(env, item, country))[0];
        if (translated && normalize(translated) !== normalize(item)) {
          const more = await naverCandidates(env, [translated]);
          const seen = new Set(candidates.map(c => c.title.slice(0, 14)));
          for (const m of more) { if (!seen.has(m.title.slice(0, 14))) { candidates.push(m); seen.add(m.title.slice(0, 14)); } }
          if (candidates.length) usedTerm = translated;
        }
      }
      return json({ ok: true, country: 'kr', raw: item, term: usedTerm, terms: [usedTerm], rate: krwRate, currency: '₩', candidates, ...urlExtra });
    } catch (e) {
      return json({ ok: false, error: String(e.message || e) }, 502);
    }
  },
};
