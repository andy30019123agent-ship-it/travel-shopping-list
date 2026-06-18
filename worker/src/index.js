// 免稅不是免費 — 價格後端 Worker
// GET /price?item=<中文>&country=jp|kr[&term=<指定關鍵字>]
//  1. AI 想 1~3 個可能的日文/韓文搜尋關鍵字（模糊搜尋）
//  2. 韓國：查 Naver 回「候選商品清單」(名稱/價格/圖)，由使用者選
//     日本：只回關鍵字＋匯率（前端瀏覽器自己直連樂天，因 Worker 帶不了 Referer）

const RAKUTEN_REFERER = 'https://andy30019123agent-ship-it.github.io/';
// pk_ 是可公開(publishable)金鑰、綁網域，放後端 OK；worker 自己帶 Referer 就能呼叫樂天
const RAKUTEN_APP_ID = '3ec6041d-d772-4a05-861a-9d15ec64dafa';
const RAKUTEN_ACCESS_KEY = 'pk_SuWs3ZCwNcFZS14BLH8QbOcDkOOBMKlyDRp7L3a2ANN';
// 取樂天該關鍵字第一筆商品的圖與價（worker 端帶 Referer 即可，實測可用）
async function rakutenFirst(term) {
  try {
    const url = `https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260401` +
      `?applicationId=${RAKUTEN_APP_ID}&accessKey=${RAKUTEN_ACCESS_KEY}&keyword=${encodeURIComponent(term)}&hits=3&format=json`;
    const r = await fetch(url, { headers: { Referer: RAKUTEN_REFERER, Origin: RAKUTEN_REFERER.replace(/\/$/, '') } });
    if (!r.ok) return null;
    const j = await r.json();
    const it = (j.Items || [])[0]?.Item || (j.Items || [])[0];
    if (!it) return null;
    const img = it.mediumImageUrls?.[0]?.imageUrl || it.mediumImageUrls?.[0] || it.imageUrl || '';
    return { image: (img || '').replace(/\?_ex=\d+x\d+$/, ''), price: it.itemPrice || 0 };
  } catch { return null; }
}
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

// ---- 後台管理頁（手機可用，密碼保護）----
const ADMIN_HTML = `<!DOCTYPE html><html lang="zh-Hant"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>熱門商品後台</title>
<style>
 body{font-family:-apple-system,system-ui,sans-serif;margin:0;background:#F6F0EA;color:#2E2420}
 header{background:#E0567C;color:#fff;padding:14px 16px;font-weight:800;font-size:17px;position:sticky;top:0;z-index:9}
 .wrap{padding:14px;max-width:720px;margin:0 auto}
 input{font:inherit;padding:8px 10px;border:1px solid #ECE1D8;border-radius:8px;width:100%;box-sizing:border-box;background:#fff}
 .tok{display:flex;gap:8px;margin-bottom:12px}
 .tabs{display:flex;gap:8px;margin:12px 0}
 .tab{flex:1;padding:10px;text-align:center;border-radius:10px;background:#fff;font-weight:700;border:1px solid #ECE1D8}
 .tab.on{background:#E0567C;color:#fff;border-color:#E0567C}
 .item{background:#fff;border-radius:12px;padding:10px;margin-bottom:10px;border:1px solid #ECE1D8}
 .row{display:flex;gap:6px;margin-bottom:6px;align-items:center}
 .row label{width:48px;color:#A89C92;font-size:12px;flex:none}
 .btns{display:flex;gap:6px;justify-content:flex-end}
 button{font:inherit;font-weight:700;border:0;border-radius:8px;padding:8px 12px;background:#E0567C;color:#fff}
 button.ghost{background:#fff;color:#7A6E66;border:1px solid #ECE1D8}
 button.sm{padding:4px 9px;font-size:13px}
 .cand{background:#FBF3E4;border-radius:10px;padding:8px 10px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;gap:8px}
 .save{position:sticky;bottom:0;background:#F6F0EA;padding:12px 0}
 .save button{width:100%;padding:14px;font-size:16px}
 h3{margin:18px 0 8px}
 .muted{color:#A89C92;font-size:12px}
 img.th{width:42px;height:42px;border-radius:6px;object-fit:cover;background:#eee;float:right}
</style></head><body>
<header>🛍️ 熱門商品後台</header>
<div class="wrap">
 <div class="tok"><input id="tok" placeholder="輸入管理密碼" type="password"><button onclick="load()">登入</button></div>
 <div id="app" style="display:none">
  <div class="tabs"><div class="tab on" id="t-jp" onclick="sw('jp')">🇯🇵 日本</div><div class="tab" id="t-kr" onclick="sw('kr')">🇰🇷 韓國</div></div>
  <button class="ghost sm" onclick="add()">＋ 新增一筆</button>
  <div id="list"></div>
  <h3>🤖 自動候選池 <span class="muted" id="candtime"></span></h3>
  <div class="muted">每週自動更新，點「加入」放進上方發布清單</div>
  <div id="cands"></div>
  <div class="save"><button onclick="save()">儲存發布清單</button></div>
 </div>
</div>
<script>
var TOKEN='',DATA={published:{jp:[],kr:[]},candidates:{jp:[],kr:[]}},CUR='jp';
function el(t,a,h){var e=document.createElement(t);if(a)for(var k in a)e.setAttribute(k,a[k]);if(h!=null)e.innerHTML=h;return e}
function load(){
 TOKEN=document.getElementById('tok').value.trim();if(!TOKEN)return;
 fetch('/admin/data?token='+encodeURIComponent(TOKEN)).then(function(r){return r.json()}).then(function(d){
  if(!d.ok){alert('密碼錯誤');return}
  DATA.published=d.published||{jp:[],kr:[]};DATA.candidates=d.candidates||{jp:[],kr:[]};
  if(!DATA.published.jp)DATA.published.jp=[];if(!DATA.published.kr)DATA.published.kr=[];
  localStorage.setItem('oytok',TOKEN);
  document.getElementById('app').style.display='block';render();
 }).catch(function(){alert('連線失敗')});
}
function sw(c){CUR=c;document.getElementById('t-jp').className='tab'+(c=='jp'?' on':'');document.getElementById('t-kr').className='tab'+(c=='kr'?' on':'');render()}
function fld(it,key,ph){var i=el('input');i.value=it[key]||'';i.placeholder=ph;i.oninput=function(){it[key]=i.value};var r=el('div',{class:'row'});r.appendChild(el('label',null,ph));r.appendChild(i);return r}
function render(){
 var list=document.getElementById('list');list.innerHTML='';
 var arr=DATA.published[CUR]||[];
 arr.forEach(function(it,i){
  var box=el('div',{class:'item'});
  if(it.image)box.appendChild(el('img',{class:'th',src:it.image}));
  box.appendChild(fld(it,'zh','名稱'));box.appendChild(fld(it,'term','關鍵字'));
  box.appendChild(fld(it,'c','分類'));box.appendChild(fld(it,'e','圖示'));
  box.appendChild(fld(it,'d','簡介'));box.appendChild(fld(it,'image','圖網址'));
  var b=el('div',{class:'btns'});
  var up=el('button',{class:'ghost sm'},'↑');up.onclick=function(){if(i>0){arr.splice(i-1,0,arr.splice(i,1)[0]);render()}};
  var dn=el('button',{class:'ghost sm'},'↓');dn.onclick=function(){if(i<arr.length-1){arr.splice(i+1,0,arr.splice(i,1)[0]);render()}};
  var del=el('button',{class:'ghost sm'},'刪除');del.onclick=function(){if(confirm('刪除這筆？')){arr.splice(i,1);render()}};
  b.appendChild(up);b.appendChild(dn);b.appendChild(del);box.appendChild(b);list.appendChild(box);
 });
 var cands=document.getElementById('cands');cands.innerHTML='';
 (DATA.candidates[CUR]||[]).forEach(function(it){
  var c=el('div',{class:'cand'});
  c.appendChild(el('div',null,(it.e||'')+' <b>'+(it.zh||'')+'</b><br><span class="muted">'+(it.c||'')+' · '+(it.term||'')+'</span>'));
  var a=el('button',{class:'sm'},'加入');a.onclick=function(){DATA.published[CUR].push(JSON.parse(JSON.stringify(it)));sw(CUR)};
  c.appendChild(a);cands.appendChild(c);
 });
 document.getElementById('candtime').textContent=DATA.candidates.updatedAt?('更新於 '+DATA.candidates.updatedAt):'';
}
function add(){DATA.published[CUR].push({zh:'',term:'',c:'',e:'🛍️',d:'',image:''});render()}
function save(){
 fetch('/admin/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:TOKEN,jp:DATA.published.jp,kr:DATA.published.kr})})
 .then(function(r){return r.json()}).then(function(d){alert(d.ok?'已儲存 ✅ App 重新整理即生效':'儲存失敗')}).catch(function(){alert('連線失敗')});
}
var saved=localStorage.getItem('oytok');if(saved){document.getElementById('tok').value=saved;load()}
</script></body></html>`;

// ---- 熱門清單 (KV) ----
// published：App 實際讀取的發布清單 {jp:[{zh,term,c,e,d,image}], kr:[...]}
// candidates：每週 Cron 自動更新的候選池（同結構），由後台挑進 published
const KV_PUBLISHED = 'published';
const KV_CANDIDATES = 'candidates';
async function kvGetJSON(env, key, fb) {
  try { const v = await env.POPULAR_KV.get(key); return v ? JSON.parse(v) : fb; } catch { return fb; }
}
const okAdmin = (env, token) => env.ADMIN_TOKEN && token === env.ADMIN_TOKEN;

// 每週自動產生熱門候選：AI 出當期趨勢候選 → 平台驗證（KR 用 Naver 查得到貨＋補圖）→ 存候選池
async function genCandidates(env, country) {
  const region = country === 'kr' ? '韓國' : '日本';
  const langWord = country === 'kr' ? '韓文' : '日文';
  const prompt =
    `列出 ${region} 目前最受台灣遊客歡迎、社群（小紅書/Dcard/YouTube/IG）討論度高的必買商品 15 個，` +
    `涵蓋「美妝・保養」「藥妝・保健」「零食・食品」三類。只回 JSON 陣列，每筆格式：` +
    `{"zh":"繁體中文商品名(品牌+品名)","term":"當地${langWord}搜尋關鍵字","c":"分類(三選一：美妝・保養 / 藥妝・保健 / 零食・食品)","e":"分類emoji(💄/💊/🍫 擇一)",` +
    `"info":"客觀說明這是什麼類型的產品與主要用途，一句話約40字，不要提國籍產地","usage":"使用方式；食品就寫口味或食用方式，約40字","claim":"主打效果與產品特色，約80字，用詞中性正面、避免誇大療效或負面字眼"}。` +
    `挑真正當紅、觀光客會買的，不要冷門或在地限定品。只回 JSON 陣列，不要多餘文字、不要 markdown。`;
  const oa = await openaiChat(env, prompt, 3000, 'gpt-4o-mini');
  let arr = [];
  try { const m = (oa || '').match(/\[[\s\S]*\]/); arr = m ? JSON.parse(m[0]) : []; } catch {}
  arr = arr.filter(x => x && x.zh && x.term).slice(0, 18);
  // 每品取「真的查得到的商品圖」(KR=Naver、JP=樂天)，沒圖不上架
  const out = [];
  for (const it of arr) {
    let image = '';
    try {
      if (country === 'kr') { const c = await naverCandidates(env, [it.term]); image = c[0]?.image || ''; }
      else { const r = await rakutenFirst(it.term); image = r?.image || ''; }
    } catch {}
    if (!image) continue;
    out.push({
      zh: it.zh, term: it.term, c: it.c || '', e: it.e || '🛍️', image,
      info: (it.info || '').trim().slice(0, 100), usage: (it.usage || '').trim().slice(0, 100), claim: (it.claim || '').trim().slice(0, 200),
      d: (it.info || '').trim().slice(0, 100),
    });
  }
  return out;
}
// 回填：把發布清單每筆補上「商品圖＋三段文案(info/usage/claim)」，沒圖的剔除（沒圖不上架）
async function enrichPublished(env, country) {
  const pub = await kvGetJSON(env, KV_PUBLISHED, { jp: [], kr: [] });
  const list = pub[country] || [];
  // 補圖（不刪沒圖的，保留資料；App 端只顯示有圖者＝沒圖不上架）
  const kept = [];
  for (const it of list) {
    let image = it.image || '';
    if (!image) {
      try {
        if (country === 'kr') { const c = await naverCandidates(env, [it.term || it.zh]); image = c[0]?.image || ''; }
        else { const r = await rakutenFirst(it.term || it.zh); image = r?.image || ''; }
      } catch {}
    }
    kept.push({ ...it, image });
  }
  // AI 產三段文案（沒 info 的才補）；CJK 輸出量大，分批每 8 筆避免被 token 上限截斷
  const need = kept.filter(it => !it.info);
  for (let i = 0; i < need.length; i += 8) {
    const chunk = need.slice(i, i + 8);
    const prompt = `為以下商品各寫產品文案，只回 JSON 陣列、順序與輸入相同，每筆：` +
      `{"zh":"原商品名","info":"客觀說明這是什麼與主要用途，約40字，不提國籍產地","usage":"使用或食用方式，約40字","claim":"主打效果與特色，約80字，用詞中性、避免誇大療效"}。` +
      `商品清單：${JSON.stringify(chunk.map(it => it.zh))}。只回 JSON 陣列，不要 markdown。`;
    const oa = await openaiChat(env, prompt, 2200, 'gpt-4o-mini');
    let arr = [];
    try { const m = (oa || '').match(/\[[\s\S]*\]/); arr = m ? JSON.parse(m[0]) : []; } catch {}
    const byName = {};
    for (const r of arr) { if (r && r.zh) byName[r.zh] = r; }
    chunk.forEach((it, idx) => {
      const r = byName[it.zh] || arr[idx] || {};
      it.info = (r.info || '').trim().slice(0, 100);
      it.usage = (r.usage || '').trim().slice(0, 100);
      it.claim = (r.claim || '').trim().slice(0, 200);
      it.d = it.info;
    });
  }
  pub[country] = kept;
  await env.POPULAR_KV.put(KV_PUBLISHED, JSON.stringify(pub));
  return { country, kept: kept.length, total: list.length };
}
async function refreshCandidates(env) {
  const [jp, kr] = await Promise.all([genCandidates(env, 'jp'), genCandidates(env, 'kr')]);
  const data = { jp, kr, updatedAt: new Date().toISOString().slice(0, 10) };
  await env.POPULAR_KV.put(KV_CANDIDATES, JSON.stringify(data));
  return data;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    if (url.pathname === '/rate') {
      const [jpy, krw] = await Promise.all([rate('JPY'), rate('KRW')]);
      return json({ ok: true, jpy: jpy || FALLBACK_RATE.JPY, krw: krw || FALLBACK_RATE.KRW });
    }
    // App 讀發布的熱門清單；沒有資料時回空陣列（前端會退回內建靜態清單）
    if (url.pathname === '/popular') {
      const pub = await kvGetJSON(env, KV_PUBLISHED, { jp: [], kr: [] });
      return json({ ok: true, jp: pub.jp || [], kr: pub.kr || [] });
    }
    // 後台：管理頁
    if (url.pathname === '/admin') {
      return new Response(ADMIN_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', ...CORS } });
    }
    if (url.pathname === '/admin/data') {
      if (!okAdmin(env, url.searchParams.get('token'))) return json({ ok: false, error: 'unauthorized' }, 401);
      return json({
        ok: true,
        published: await kvGetJSON(env, KV_PUBLISHED, { jp: [], kr: [] }),
        candidates: await kvGetJSON(env, KV_CANDIDATES, { jp: [], kr: [], updatedAt: '' }),
      });
    }
    if (url.pathname === '/admin/save') {
      if (request.method !== 'POST') return json({ ok: false, error: 'POST' }, 405);
      let body = {};
      try { body = await request.json(); } catch {}
      if (!okAdmin(env, body.token)) return json({ ok: false, error: 'unauthorized' }, 401);
      const pub = { jp: Array.isArray(body.jp) ? body.jp : [], kr: Array.isArray(body.kr) ? body.kr : [] };
      await env.POPULAR_KV.put(KV_PUBLISHED, JSON.stringify(pub));
      return json({ ok: true });
    }
    // 手動觸發候選更新（後台「立即更新候選」用，免等每週 Cron）
    if (url.pathname === '/admin/refresh') {
      if (!okAdmin(env, url.searchParams.get('token'))) return json({ ok: false, error: 'unauthorized' }, 401);
      const cand = await refreshCandidates(env);
      return json({ ok: true, candidates: cand });
    }
    // 回填發布清單的圖與文案（沒圖剔除）
    if (url.pathname === '/admin/enrich') {
      if (!okAdmin(env, url.searchParams.get('token'))) return json({ ok: false, error: 'unauthorized' }, 401);
      const c = url.searchParams.get('country') === 'jp' ? 'jp' : 'kr';
      return json({ ok: true, ...(await enrichPublished(env, c)) });
    }
    if (url.pathname === '/vision') {
      if (request.method !== 'POST') return json({ ok: false, error: 'POST image' }, 405);
      try {
        const body = await request.json();
        const b64 = (body.image || '').replace(/^data:image\/\w+;base64,/, '');
        // 限定便宜模型白名單，避免有人對公開端點指定昂貴模型消耗 OpenAI 額度
        const ALLOWED_VISION_MODELS = ['gpt-4.1-nano', 'gpt-4o-mini', 'gpt-4.1-mini', 'gpt-5-nano'];
        const visionModel = ALLOWED_VISION_MODELS.includes(body.model) ? body.model : 'gpt-4.1-nano';
        let name = '', info = '', usage = '', claim = '', oaAnswered = false, uncertain = false;
        // OpenAI 視覺辨識，回 JSON {name, info, usage, claim, confidence}。寧可認不出也不亂猜
        const oa = await openaiChat(env, [
          { type: 'text', text: '這是台灣遊客想買的商品照片。請只根據「包裝上實際看得到的文字、logo、圖案」辨識，不要憑空推測。\n辨識門檻(很重要)：只有能清楚讀出「具體商品名稱」時才辨識；以下情況一律回 name=UNKNOWN、不要猜——照片模糊或文字看不清、只看到品牌或製造商卻看不到產品名、只讀到通用類別字樣(如「第2類医薬品」「医薬品」「化粧品」這種法規分類不是商品名)。嚴禁從製造商或類別反推產品(看到「大正製薬」不可自己猜成感冒藥)。保健食品/補給品要讀出「成分名」(如藍莓、葉黃素、膠原蛋白、維他命C)才算辨識成功；只讀到品牌＋「營養素/補給品/サプリ/保健食品」這種泛稱，請回 UNKNOWN，不要自己湊一個。\n只回 JSON：{"name":"品牌+品名，簡潔好搜尋(例：numbuzin 無濾鏡提亮防曬精華)；規格(SPF/容量/色號)放 claim 不放 name；讀不到具體商品名就回 UNKNOWN","info":"客觀說明這是什麼類型的產品與主要用途，一句話，不要誇大效果，也不要提及品牌國籍或產地(約40字)","usage":"使用方式；食品就寫口味或食用方式(約40字；無法判斷給空字串)","claim":"主打效果與產品特色：先用「・」列出包裝主打的具體效果(例 SPF50+、保濕提亮)，再用一兩句補充產品特色(質地、適用對象、設計、情境)，約80~100字。用詞中性正面，避免爭議性、誇大療效或負面字眼(無法判斷給空字串)","confidence":"high 或 low：你對 name 是否為正確且具體商品名稱的把握度，只要有任何不確定就回 low"}。格式：各欄位只填內容本身，不要把欄位名稱或冒號寫進值裡。鐵則：產地、國籍、價格、療效、症狀、適應症、成分含量等「包裝上看不到或無法確認」的資訊一律不要編造，看不到就留空字串。繁體中文。不要多餘文字、不要 markdown。' },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } },
        ], 550, visionModel);
        if (oa) {
          try {
            const m = oa.match(/\{[\s\S]*\}/);
            const obj = m ? JSON.parse(m[0]) : {};
            oaAnswered = true; // OpenAI 有正常回應(不論認不認得出)→ 不再退 llava 亂猜
            const n = (obj.name || '').trim().slice(0, 60);
            const conf = String(obj.confidence || '').toLowerCase();
            const unreadable = /UNKNOWN|無法|抱歉|sorry|cannot|can't|unable/i.test(n);
            // name 仍夾帶「第X類/医薬品/化粧品」這種法規類別 = 沒讀到真正品名 → 視為認不出
            const categoryLeak = /医薬品|醫藥品|医薬部外品|医療機器|第[0-9０-９]+\s*類|化粧品(?!水)|營養素|營養劑|營養補給|補給品|保健食品|健康食品|サプリメント|\bsupplement/i.test(n) || n.replace(/\s/g, '').length <= 2;
            if (n && !unreadable && !categoryLeak) {
              name = n;
              if (conf === 'low') {
                uncertain = true; // 有猜測但沒十足把握 → 前端跳「你要找的是 XXX 嗎」，不附介紹/效果(避免把沒把握的當真)
              } else {
                info = (obj.info || '').trim().slice(0, 100);
                usage = (obj.usage || '').trim().slice(0, 100);
                claim = (obj.claim || '').trim().slice(0, 200);
              }
            }
            // 完全看不清/只讀到品牌或法規類別 → name 留空白 = 認不出，前端請使用者重拍或改文字輸入
          } catch {}
        }
        if (!name && !oaAnswered) {
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
        return json({ ok: true, name, info, usage, claim, uncertain });
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
      // 先用 OpenAI(或對照表)解析成確切商品的韓文關鍵字再搜，較精準；不足再補搜原文
      const resolved = (await guessTerms(env, item, country))[0];
      let usedTerm = (resolved && resolved.trim()) ? resolved : item;
      let candidates = await naverCandidates(env, [usedTerm]);
      if (candidates.length < 3 && normalize(usedTerm) !== normalize(item)) {
        const more = await naverCandidates(env, [item]);
        const seen = new Set(candidates.map(c => c.title.slice(0, 14)));
        for (const m of more) { if (!seen.has(m.title.slice(0, 14))) { candidates.push(m); seen.add(m.title.slice(0, 14)); } }
      }
      return json({ ok: true, country: 'kr', raw: item, term: usedTerm, terms: [usedTerm], rate: krwRate, currency: '₩', candidates, ...urlExtra });
    } catch (e) {
      return json({ ok: false, error: String(e.message || e) }, 502);
    }
  },
  // 每週 Cron：自動更新熱門候選池
  async scheduled(event, env, ctx) {
    ctx.waitUntil(refreshCandidates(env));
  },
};
