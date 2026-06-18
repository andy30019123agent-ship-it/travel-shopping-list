import { useEffect, useMemo, useRef, useState } from 'react';
import {
  SafeAreaView, View, Text, TextInput, TouchableOpacity, Image, Modal,
  ScrollView, StyleSheet, StatusBar, Platform, ActivityIndicator, Animated, Linking,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';
import { GestureHandlerRootView, Swipeable } from 'react-native-gesture-handler';

const SWIPE_ENABLED = Platform.OS !== 'web';

const STORE_KEY = 'travel-shopping-list-v1';
const SETTINGS_KEY = 'travel-shopping-settings-v1';
const WORKER_URL = 'https://menshui-price.andy30019123agent.workers.dev';
const RAKUTEN_APP_ID = '3ec6041d-d772-4a05-861a-9d15ec64dafa';
const RAKUTEN_ACCESS_KEY = 'pk_SuWs3ZCwNcFZS14BLH8QbOcDkOOBMKlyDRp7L3a2ANN';
const TAXFREE = { jp: 5000, kr: 15000 }; // 參考免稅/退稅門檻（當地幣別）

const CO = {
  jp: { flag: '🇯🇵', label: '日本', cur: '¥', curLabel: '日圓' },
  kr: { flag: '🇰🇷', label: '韓國', cur: '₩', curLabel: '韓元' },
};
// 精品/知名品牌官網（jp / kr），辨識到就附官網連結供你看官方定價
const BRAND_SITES = [
  { k: ['chanel', '香奈兒', '香奈尔'], jp: 'https://www.chanel.com/jp/', kr: 'https://www.chanel.com/kr/' },
  { k: ['louis vuitton', 'lv', '路易威登'], jp: 'https://jp.louisvuitton.com/', kr: 'https://kr.louisvuitton.com/' },
  { k: ['gucci', '古馳'], jp: 'https://www.gucci.com/jp/', kr: 'https://www.gucci.com/kr/' },
  { k: ['dior', '迪奧'], jp: 'https://www.dior.com/ja_jp', kr: 'https://www.dior.com/ko_kr' },
  { k: ['hermes', 'hermès', '愛馬仕'], jp: 'https://www.hermes.com/jp/ja/', kr: 'https://www.hermes.com/kr/ko/' },
  { k: ['ysl', 'saint laurent', '聖羅蘭'], jp: 'https://www.ysl.com/ja-jp', kr: 'https://www.ysl.com/ko-kr' },
  { k: ['prada', '普拉達'], jp: 'https://www.prada.com/jp/ja.html', kr: 'https://www.prada.com/kr/ko.html' },
  { k: ['sk-ii', 'sk2', 'skii'], jp: 'https://www.sk-ii.jp/', kr: 'https://www.sk-ii.co.kr/' },
  { k: ['雅詩蘭黛', 'estee lauder', 'estée'], jp: 'https://www.esteelauder.jp/', kr: 'https://www.esteelauder.co.kr/' },
];
function brandSite(name, country) {
  const q = (name || '').toLowerCase();
  for (const b of BRAND_SITES) if (b.k.some(x => q.includes(x))) return b[country];
  return '';
}
const openUrl = u => { if (u) Linking.openURL(u).catch(() => {}); };
const fmt = n => (n == null ? '' : Math.round(n).toLocaleString('en-US'));
const enc = encodeURIComponent;
const isUrl = s => /^https?:\/\//i.test((s || '').trim());
const MONO = Platform.select({ web: 'ui-monospace, SFMono-Regular, Menlo, monospace', ios: 'Menlo', android: 'monospace', default: 'monospace' });
// 移除 react-native-web 點擊輸入框時的瀏覽器預設藍色外框
const NO_OUTLINE = Platform.OS === 'web' ? { outlineStyle: 'none', outlineWidth: 0 } : {};

function dedupeBy(arr, keyFn) {
  const seen = new Set(); const out = [];
  for (const x of arr) { const k = keyFn(x); if (!seen.has(k)) { seen.add(k); out.push(x); } }
  return out;
}

// 過濾搜尋雜訊：福袋、ふるさと納税、套組、二手等會干擾單品比價
const NOISE_RE = /ふるさと納税|ふるさと|福袋|詰め合わせ|詰合せ|まとめ買い|セット|中古|訳あり|セット販売|선물세트|세트|묶음|중고|리퍼/i;
function cleanCandidates(cands) {
  const filtered = cands.filter(c => c.title && c.price > 0 && !NOISE_RE.test(c.title));
  return filtered.length ? filtered : cands; // 全被濾掉就退回原始，避免變空
}
// 自動選價：取中位數那筆（避開怪低/怪高），比「選第一個」準
function pickBest(cands) {
  if (!cands.length) return null;
  const sorted = [...cands].sort((a, b) => a.price - b.price);
  return sorted[Math.floor((sorted.length - 1) / 2)];
}
// 一鍵到當地購物網站看完整結果
function localSearchUrl(country, term) {
  const q = enc(term || '');
  // 韓國改導 Google：Naver 購物搜尋頁會跳人機驗證 → 連結等於失效
  return country === 'kr'
    ? `https://www.google.com/search?q=${q}`
    : `https://search.rakuten.co.jp/search/mall/${q}/`;
}
const sourceUrl = (it) => it.country === 'kr'
  ? `https://www.google.com/search?q=${enc(it.price?.title || it.name || '')}`
  : (it.price?.url || '');

// 熱門必買商品庫（日/韓代購常見品，term 已對好當地關鍵字，查價更準）
const POPULAR = {
  jp: [
    { c: '藥妝・保健', e: '💊', list: [
      { zh: '龍角散喉糖', term: '龍角散 のど飴', d: '草本喉糖，潤喉緩解乾癢，外出常備。' },
      { zh: 'EVE 止痛藥', term: 'イブ 鎮痛', d: '日本熱賣止痛藥，緩解頭痛、生理痛。' },
      { zh: '太田胃散', term: '太田胃散', d: '百年胃腸藥，緩解胃脹、消化不良。' },
      { zh: '命之母', term: '命の母', d: '女性生理與更年期調理保健品。' },
      { zh: '合利他命', term: 'アリナミン EX', d: '維他命 B 群，緩解疲勞、肩頸痠痛。' },
      { zh: '休足時間', term: '休足時間 シート', d: '貼式舒緩貼片，久站走路後敷腿。' },
      { zh: '小林退熱貼', term: '熱さまシート', d: '退熱貼片，發燒降溫、消暑用。' },
      { zh: '樂敦 Vita40 眼藥水', term: 'ロート Vロート', d: '含維他命眼藥水，舒緩疲勞乾澀。' },
      { zh: '表飛鳴整腸', term: '新ビオフェルミンS', d: '益生菌整腸，改善脹氣、調整腸道。' },
    ]},
    { c: '保健食品（DHC）', e: '🫐', list: [
      { zh: 'DHC 藍莓精華', term: 'DHC ブルーベリー', d: '藍莓萃取護眼保健，3C 族愛用。' },
      { zh: 'DHC 葉黃素', term: 'DHC ルテイン', d: '葉黃素補給，長時間用眼者保養。' },
      { zh: 'DHC 維他命C', term: 'DHC ビタミンC', d: '高單位維他命 C，抗氧化養顏。' },
      { zh: 'DHC 膠原蛋白', term: 'DHC コラーゲン', d: '膠原蛋白補給，養顏美容。' },
      { zh: 'DHC 維他命B群', term: 'DHC ビタミンBミックス', d: 'B 群補給，提振精神、幫助代謝。' },
      { zh: 'DHC 魚油 DHA', term: 'DHC DHA', d: '深海魚油 DHA，補腦健康保健。' },
    ]},
    { c: '美妝・保養', e: '💄', list: [
      { zh: '花王蒸氣眼罩', term: 'めぐりズム 蒸気でホットアイマスク', d: '蒸氣熱敷眼罩，放鬆紓壓助眠。' },
      { zh: 'Senka 洗面乳', term: '専科 パーフェクトホイップ', d: '綿密泡泡洗面乳，溫和潔顏。' },
      { zh: 'DHC 護唇膏', term: 'DHC 薬用リップクリーム', d: '保濕護唇膏，滋潤修護乾唇。' },
      { zh: '曼秀雷敦 AD 乳液', term: 'メンソレータム AD クリーム', d: '止癢保濕乳，乾癢敏感肌適用。' },
      { zh: 'CANMAKE 腮紅', term: 'キャンメイク クリームチーク', d: '平價膏狀腮紅，自然好上色。' },
      { zh: 'KOSE 雪肌精', term: 'コーセー 雪肌精', d: '經典美白化妝水，提亮保濕。' },
    ]},
    { c: '零食・食品', e: '🍫', list: [
      { zh: '白色戀人', term: '白い恋人', d: '北海道貓舌餅夾白巧克力，經典伴手禮。' },
      { zh: '薯條三兄弟', term: 'じゃがポックル', d: '北海道薯條餅乾，香脆涮嘴。' },
      { zh: 'KitKat 抹茶', term: 'キットカット 抹茶', d: '抹茶威化巧克力，日本限定口味。' },
      { zh: 'Royce 生巧克力', term: 'ロイズ 生チョコレート', d: '入口即化生巧克力，需冷藏。' },
      { zh: '東京香蕉', term: '東京ばな奈', d: '香蕉造型海綿蛋糕，東京名產。' },
      { zh: 'Jagabee 薯條', term: 'じゃがビー', d: '真材實料薯條餅，原味鹹香。' },
    ]},
  ],
  kr: [
    { c: '美妝・保養', e: '💄', list: [
      { zh: '雪花秀潤燥精華', term: '설화수 자음생에센스', d: '韓方高級保養，滋潤抗老精華。' },
      { zh: 'numbuzin 數字面膜', term: '넘버즈인 마스크팩', d: '數字系列面膜，主打提亮保濕。' },
      { zh: 'Anua 魚腥草化妝水', term: '아누아 어성초 토너', d: '魚腥草舒緩化妝水，鎮定泛紅肌。' },
      { zh: 'Torriden 玻尿酸精華', term: '토리든 다이브인 세럼', d: '低分子玻尿酸，深層保濕補水。' },
      { zh: 'medicube 膠原緊緻精華', term: '메디큐브 콜라겐', d: '當紅醫美級品牌，膠原緊緻保養。' },
      { zh: 'TIRTIR 氣墊粉底', term: '티르티르 마스크핏 쿠션', d: '高遮瑕氣墊，持妝服貼爆紅。' },
      { zh: '魔女工廠卸妝油', term: '마녀공장 퓨어 클렌징오일', d: '溫和卸妝油，乳化快、不殘妝。' },
      { zh: 'skin1004 積雪草安瓶', term: '스킨천사 센텔라 앰플', d: '積雪草安瓶，鎮定修護敏弱肌。' },
      { zh: 'VT 微針面膜 리들샷', term: '브이티 리들샷', d: '微針保養（리들샷），緊緻平滑爆紅。' },
      { zh: '蘭芝睡眠唇膜', term: '라네즈 슬리핑 마스크', d: '晚安唇膜，過夜修護乾唇。' },
      { zh: 'Mediheal 面膜', term: '메디힐 마스크팩', d: '國民面膜，多機能、CP 值高。' },
      { zh: '朝鮮美女精華／防曬', term: '조선미녀 맑은쌀 선크림', d: '米萃取溫和保養，防曬也熱賣。' },
    ]},
    { c: '保健・生活', e: '💊', list: [
      { zh: '馬油', term: '마유 크림', d: '保濕馬油霜，乾燥肌全身可用。' },
      { zh: '正官庄紅蔘', term: '정관장 홍삼', d: '高麗紅蔘補品，補氣養生、送禮。' },
      { zh: '蜂蜜柚子茶', term: '꿀 유자차', d: '柚子蜂蜜茶醬，沖泡暖飲。' },
      { zh: '韓國益生菌', term: '유산균', d: '腸道益生菌補給，調整體質。' },
    ]},
    { c: '零食・泡麵', e: '🍜', list: [
      { zh: '辛拉麵', term: '신라면', d: '國民辣味泡麵，經典必買。' },
      { zh: '火雞辣雞麵', term: '삼양 불닭볶음면', d: '超人氣辣雞炒麵，挑戰辣度。' },
      { zh: '炸醬泡麵', term: '짜파게티', d: '國民炸醬泡麵，香濃微甜。' },
      { zh: '韓國海苔', term: '김 조미김', d: '調味海苔，下飯、零嘴皆宜。' },
      { zh: '蜂蜜奶油杏仁', term: '허니버터아몬드', d: 'HBAF 蜂蜜奶油杏仁，甜鹹涮嘴。' },
      { zh: '烏龜玉米餅 꼬북칩', term: '꼬북칩', d: '4 層酥脆玉米餅，玉米濃湯味爆紅。' },
      { zh: '香蕉牛奶', term: '바나나맛 우유', d: '人氣香蕉牛奶，香甜濃郁。' },
      { zh: '巧克力派', term: '오리온 초코파이', d: '棉花糖夾心巧克力派，經典。' },
    ]},
  ],
};
// 邊打邊建議：從攤平清單比對
function popularMatches(list, q) {
  const s = (q || '').trim().toLowerCase();
  if (!s) return [];
  return (list || []).filter(it => (it.zh || '').toLowerCase().includes(s) || (it.term || '').toLowerCase().includes(s)).slice(0, 6);
}
// 靜態熱門攤平成 {jp:[{zh,term,c,e,d,image}], kr:[...]}，當遠端清單的 fallback
const STATIC_FLAT = { jp: [], kr: [] };
for (const cc of ['jp', 'kr']) for (const g of (POPULAR[cc] || [])) for (const it of g.list)
  STATIC_FLAT[cc].push({ zh: it.zh, term: it.term, c: g.c, e: g.e, d: it.d || '', image: '' });
// 攤平清單依分類分組給面板渲染
function groupFlat(arr) {
  const groups = [], idx = {};
  for (const it of (arr || [])) {
    const c = it.c || '其他';
    if (!(c in idx)) { idx[c] = groups.length; groups.push({ c, e: it.e || '🛍️', list: [] }); }
    groups[idx[c]].list.push(it);
  }
  return groups;
}
// 分類內再依品牌分組：同品牌多品項→品牌標題+品項；單品項→直接顯示
function groupByBrand(items) {
  const order = [], map = {};
  for (const it of (items || [])) {
    // 有 brand 欄位優先；沒有就用「有空格時的首字」當品牌(讓舊資料如 DHC 葉黃素 也能歸類)
    const z = (it.zh || '').trim();
    const b = (it.brand || '').trim() || (z.includes(' ') ? z.split(/\s+/)[0] : '');
    const key = b || ('__' + z);
    if (!(key in map)) { map[key] = { brand: b, items: [] }; order.push(key); }
    map[key].items.push(it);
  }
  return order.map(k => map[k]);
}
// 品牌標題下的品項顯示名（去掉品牌前綴）
const stripBrand = (zh, brand) => { const s = (zh || '').replace(new RegExp('^\\s*' + (brand || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '').trim(); return s || zh; };

// 樂天市場商品搜尋（單一賣場的商品列表）
async function rakutenSearch(term, hits = 20) {
  const url = `https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260401` +
    `?applicationId=${RAKUTEN_APP_ID}&accessKey=${RAKUTEN_ACCESS_KEY}&keyword=${enc(term)}&hits=${hits}&format=json`;
  const rk = await fetch(url);
  if (!rk.ok) throw new Error(`樂天查詢失敗 (${rk.status})`);
  const rj = await rk.json();
  const out = [];
  for (const x of (rj.Items || [])) {
    const i = x.Item || x;
    if (!i.itemName || !i.itemPrice) continue;
    out.push({ title: i.itemName, price: i.itemPrice, image: i.mediumImageUrls?.[0]?.imageUrl || i.smallImageUrls?.[0]?.imageUrl || '', url: i.itemUrl || '' });
  }
  return out;
}
// 樂天商品價格導航（比價型：每個商品含多店價格區間 min/avg/max）
async function rakutenProductSearch(term, hits = 20) {
  const url = `https://openapi.rakuten.co.jp/ichibaproduct/api/Product/Search/20250801` +
    `?applicationId=${RAKUTEN_APP_ID}&accessKey=${RAKUTEN_ACCESS_KEY}&keyword=${enc(term)}&hits=${hits}&format=json`;
  const rk = await fetch(url);
  if (!rk.ok) throw new Error(`樂天比價失敗 (${rk.status})`);
  const rj = await rk.json();
  const out = [];
  for (const x of (rj.Products || [])) {
    const p = x.Product || x;
    const pmin = p.minPrice || p.salesMinPrice;
    const pmax = p.maxPrice || p.salesMaxPrice;
    const price = p.averagePrice || pmin || pmax;
    if (!p.productName || !price) continue;
    out.push({ title: p.productName, price: Math.round(price), priceMin: pmin, priceMax: pmax, image: p.mediumImageUrl || p.smallImageUrl || '', url: p.productUrlPC || '' });
  }
  return out;
}

async function fetchCandidates(item) {
  const q = item.term ? `term=${enc(item.term)}` : `item=${enc(item.name)}`;
  const res = await fetch(`${WORKER_URL}/price?country=${item.country}&${q}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || '查詢失敗');
  const term = data.term || (data.terms && data.terms[0]) || item.term || '';
  const currency = data.currency || CO[item.country].cur;
  const rate = data.rate || (item.country === 'kr' ? 0.021 : 0.197);
  let cands;
  if (item.country === 'kr') {
    cands = (data.candidates || []).map(c => ({ title: c.title, price: c.price, image: c.image, url: c.url || '' }));
  } else {
    // 日本：先用「商品價格導航」(比價型) 查，原文→翻譯詞；不足再退回市場商品搜尋
    let raw = data.raw || item.name;
    cands = await rakutenProductSearch(raw).catch(() => []);
    if (cands.length < 3 && term && term !== raw) {
      cands = dedupeBy([...cands, ...await rakutenProductSearch(term).catch(() => [])], c => c.title.slice(0, 12));
    }
    if (cands.length < 3) {
      const items = await rakutenSearch(term || raw).catch(() => []);
      cands = dedupeBy([...cands, ...items], c => c.title.slice(0, 12));
    }
  }
  cands = cleanCandidates(cands).slice(0, 12).map(c => ({ ...c, twd: Math.round(c.price * rate) }));
  return { term, currency, candidates: cands, rate };
}

function AnimatedCard({ children, style }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.timing(a, { toValue: 1, duration: 240, useNativeDriver: true }).start(); }, []);
  return <Animated.View style={[style, { opacity: a, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }]}>{children}</Animated.View>;
}
function Skeleton() {
  const a = useRef(new Animated.Value(0.4)).current;
  useEffect(() => { Animated.loop(Animated.sequence([Animated.timing(a, { toValue: 1, duration: 650, useNativeDriver: true }), Animated.timing(a, { toValue: 0.4, duration: 650, useNativeDriver: true })])).start(); }, []);
  return (
    <View style={{ flex: 1 }}>
      <Animated.View style={{ opacity: a, height: 16, borderRadius: 6, backgroundColor: '#ECE1D8', width: '55%' }} />
      <Animated.View style={{ opacity: a, height: 11, borderRadius: 6, backgroundColor: '#ECE1D8', width: '80%', marginTop: 7 }} />
    </View>
  );
}
function PriceTag({ twd }) {
  const s = useRef(new Animated.Value(0.8)).current;
  useEffect(() => { s.setValue(0.8); Animated.spring(s, { toValue: 1, friction: 5, tension: 150, useNativeDriver: true }).start(); }, [twd]);
  return <Animated.View style={[styles.priceTag, { transform: [{ scale: s }] }]}><Text style={styles.priceTagCur}>NT$</Text><Text style={styles.priceTagNum}>{fmt(twd)}</Text></Animated.View>;
}

export default function App() {
  const [items, setItems] = useState([]);
  const [input, setInput] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState({});
  const [picker, setPicker] = useState(null);
  const [zoom, setZoom] = useState(null);
  const [calc, setCalc] = useState(null);
  const [country, setCountry] = useState('jp');
  const [sort, setSort] = useState('added');
  const [tab, setTab] = useState('list');
  const [stores, setStores] = useState([]); // 記住的常用店家
  const [storeEdit, setStoreEdit] = useState(null); // 正在編輯店家的 item id
  const [budget, setBudget] = useState(0); // 整趟預算(台幣)
  const [budgetEdit, setBudgetEdit] = useState(null);
  const [priceEdit, setPriceEdit] = useState(null); // 自填價格 {id, val, currency}
  const [toast, setToast] = useState(null); // {msg, undo}
  const [expanded, setExpanded] = useState({}); // 卡片「更多」展開
  const [onboard, setOnboard] = useState(false);
  const [inputFocus, setInputFocus] = useState(false);
  const [showPopular, setShowPopular] = useState(false);
  const [endTrip, setEndTrip] = useState(null); // null | 'summary' | 'confirm'
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const toastTimer = useRef(null);
  const showToast = (msg, undo) => { setToast({ msg, undo }); if (toastTimer.current) clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(null), undo ? 4500 : 2500); };
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null); // 拍照識物卡 {uri, name, info, usage, claim}
  const [scanAsk, setScanAsk] = useState(null); // 低信心確認 {uri, name}
  const [aiTip, setAiTip] = useState(false); // 首次拍照提示彈窗
  const [aiTipSeen, setAiTipSeen] = useState(false); // 是否看過首次提示(存 settings)
  const [guide, setGuide] = useState(false); // 使用說明彈窗
  const [popInfo, setPopInfo] = useState(null); // 熱門品介紹卡 {zh, term, d, e, image}
  const [remotePopular, setRemotePopular] = useState(null); // 從 worker 讀的發布熱門清單 {jp,kr}
  const [addBought, setAddBought] = useState(null); // 記帳頁手動新增已買 {country,name,val,store,note}
  const [rates, setRates] = useState({ jpy: 0.197, krw: 0.021 });
  useFonts(Ionicons.font);

  useEffect(() => {
    AsyncStorage.getItem(STORE_KEY).then(r => { if (r) setItems(JSON.parse(r)); setLoaded(true); });
    AsyncStorage.getItem(SETTINGS_KEY).then(r => { const s = r ? JSON.parse(r) : {}; if (s.country) setCountry(s.country); if (s.sort) setSort(s.sort); if (s.stores) setStores(s.stores); if (s.budget) setBudget(s.budget); if (s.aiTipSeen) setAiTipSeen(true); if (!s.onboardSeen) setOnboard(true); setSettingsLoaded(true); });
    fetch(`${WORKER_URL}/rate`).then(r => r.json()).then(d => { if (d.ok) setRates({ jpy: d.jpy, krw: d.krw }); }).catch(() => {});
  }, []);
  useEffect(() => { fetch(`${WORKER_URL}/popular`).then(r => r.json()).then(d => { if (d.ok) setRemotePopular({ jp: d.jp || [], kr: d.kr || [] }); }).catch(() => {}); }, []);
  // picker 開啟時，把候選標題批次翻成繁中（一次一個 AI 呼叫）
  useEffect(() => {
    if (!picker || !(picker.candidates && picker.candidates.length) || picker.translating) return;
    if (picker.trans && picker.trans[picker.candidates[0].title]) return; // 已翻譯（含重搜後新候選）
    const titles = picker.candidates.map(c => c.title);
    setPicker(p => p ? { ...p, translating: true } : p);
    fetch(`${WORKER_URL}/translate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ titles }) })
      .then(r => r.json()).then(d => {
        const map = {}; if (d.ok && Array.isArray(d.zh)) titles.forEach((t, i) => { if (d.zh[i]) map[t] = d.zh[i]; });
        setPicker(p => p ? { ...p, trans: { ...(p.trans || {}), ...map }, translating: false } : p);
      }).catch(() => setPicker(p => p ? { ...p, translating: false } : p));
  }, [picker]);
  useEffect(() => { if (loaded) AsyncStorage.setItem(STORE_KEY, JSON.stringify(items)); }, [items, loaded]);
  useEffect(() => { if (settingsLoaded) AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({ country, sort, stores, budget, onboardSeen: !onboard, aiTipSeen })); }, [country, sort, stores, budget, onboard, aiTipSeen, settingsLoaded]);

  const rateOf = c => (c === 'kr' ? rates.krw : rates.jpy);
  const update = (id, patch) => setItems(prev => prev.map(it => (it.id === id ? { ...it, ...patch } : it)));
  const remove = id => setItems(prev => prev.filter(it => it.id !== id));
  const rememberStore = name => { const n = name.trim(); if (n && !stores.includes(n)) setStores(prev => [n, ...prev].slice(0, 8)); };

  const addItem = (nameArg) => {
    const name = (nameArg ?? input).trim();
    if (!name) return;
    const it = { id: Date.now().toString() + Math.random().toString(36).slice(2, 5), name, country, qty: 1, note: '', term: '', image: '', imageManual: false, status: 'todo', price: null, candidates: null, currency: CO[country].cur };
    setItems(prev => [it, ...prev]);
    setInput('');
    showToast(`已加入：${name}`);
    return it;
  };

  async function queryOne(item, opts = {}) {
    setBusy(b => ({ ...b, [item.id]: true }));
    try {
      const { term, currency, candidates, rate } = await fetchCandidates(item);
      const patch = { term, currency, candidates };
      if (!candidates.length) { patch.noResult = true; patch.price = null; patch.range = null; }
      else {
        patch.noResult = false;
        // 參考價區間：候選中的最低～最高（當地幣）
        const prices = candidates.map(c => c.price).filter(p => p > 0);
        patch.range = prices.length ? { min: Math.min(...prices), max: Math.max(...prices) } : null;
        const c = pickBest(candidates); // 取中位數價那筆當參考
        patch.price = { price: c.price, twd: c.twd, currency, title: c.title, url: c.url };
        if (c.image && !item.imageManual) patch.image = c.image;
      }
      update(item.id, patch);
      setBusy(b => ({ ...b, [item.id]: false }));
      // 跳「圖片牆」：手動查價、或貼網址(讓你和搜到的同款比價)，多筆候選才跳
      if (opts.pick && candidates.length > 1) {
        setPicker({ itemId: item.id, currency, candidates, name: item.name, term });
      }
      return;
    } catch (e) {
      setBusy(b => ({ ...b, [item.id]: 'err' })); setTimeout(() => setBusy(b => ({ ...b, [item.id]: false })), 2500); return;
    }
  }
  async function queryAll() {
    const todo = items.filter(it => it.status === 'todo' && !it.price);
    for (const it of todo) { await queryOne(it); } // 批次：自動選中位數，不逐一跳窗
  }
  function openPicker(item) {
    if (item.candidates && item.candidates.length) setPicker({ itemId: item.id, currency: item.currency, candidates: item.candidates, name: item.name, term: item.term || '' });
    else queryOne(item);
  }
  // 「看當地全部」：在 App 內撈更廣的結果（更多筆、不濾雜訊），跳圖片牆讓你挑
  async function openMore(item) {
    setBusy(b => ({ ...b, [item.id]: true }));
    try {
      const term = item.term || item.name;
      const rate = rateOf(item.country);
      let cands;
      if (item.country === 'kr') {
        cands = item.candidates && item.candidates.length ? item.candidates : (await fetchCandidates(item)).candidates;
      } else {
        const a = await rakutenProductSearch(term, 30).catch(() => []);
        const b = await rakutenSearch(term, 30).catch(() => []);
        cands = dedupeBy([...a, ...b], c => c.title.slice(0, 14)).filter(c => c.title && c.price > 0).slice(0, 30).map(c => ({ ...c, twd: Math.round(c.price * rate) }));
      }
      setBusy(b => ({ ...b, [item.id]: false }));
      if (cands && cands.length) setPicker({ itemId: item.id, currency: item.currency || CO[item.country].cur, candidates: cands, name: item.name, term });
      else openUrl(localSearchUrl(item.country, term));
    } catch (e) { setBusy(b => ({ ...b, [item.id]: false })); openUrl(localSearchUrl(item.country, item.term || item.name)); }
  }
  function choosePick(c) {
    const { itemId, currency } = picker;
    // 使用者「主動點選某商品」＝確認這就是要買的→一律換上該商品官方圖（含拍照存的照片也覆蓋）
    setItems(prev => prev.map(it => it.id === itemId ? { ...it, price: { price: c.price, twd: c.twd, currency, title: c.title, url: c.url }, image: c.image || it.image, imageManual: c.image ? false : it.imageManual, noResult: false } : it));
    setPicker(null);
  }
  async function repickWithTerm() {
    const id = picker.itemId; const t = picker.term.trim();
    setPicker(null);
    const it = items.find(x => x.id === id); if (!it) return;
    update(id, { term: t });
    await queryOne({ ...it, term: t });
  }
  async function pickImage(id) {
    try { const res = await ImagePicker.launchImageLibraryAsync({ quality: 0.6 }); if (!res.canceled && res.assets?.[0]) update(id, { image: res.assets[0].uri, imageManual: true }); } catch (e) {}
  }
  // 拍照/選圖搜圖
  async function scanImage(fromCamera) {
    try {
      const res = fromCamera
        ? await ImagePicker.launchCameraAsync({ quality: 0.5, base64: true })
        : await ImagePicker.launchImageLibraryAsync({ quality: 0.5, base64: true });
      if (res.canceled || !res.assets?.[0]) return;
      setScanning(true);
      const a = res.assets[0];
      let b64 = a.base64;
      if (!b64) { setScanning(false); return; }
      const r = await fetch(`${WORKER_URL}/vision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: b64 }) });
      const d = await r.json();
      setScanning(false);
      // 三層：認不出→提示；沒十足把握(uncertain)→跳「是不是 XXX」確認；有把握→正常識物卡
      if (d.ok && d.name) {
        if (d.uncertain) setScanAsk({ uri: a.uri, name: d.name });
        else setScanResult({ uri: a.uri, name: d.name, info: d.info || '', usage: d.usage || '', claim: d.claim || '' });
      } else alert('這張不太確定是什麼 🤔\n建議正面對準包裝上的商品名稱、拍清楚一點再試，或直接用文字輸入商品名。');
    } catch (e) { setScanning(false); }
  }
  // 識物卡→加入清單並查價比價（查完跳圖片牆挑）
  function addFromScan() {
    const r = scanResult; setScanResult(null);
    const name = (r.name || '').trim();
    if (!name) return;
    const it = addItem(name);
    if (it) { update(it.id, { image: r.uri, imageManual: true }); queryOne({ ...it, name }, { pick: true }); }
  }
  // 低信心確認框→確認後才加入清單查價
  function addFromAsk() {
    const r = scanAsk; setScanAsk(null);
    const name = (r.name || '').trim();
    if (!name) return;
    const it = addItem(name);
    if (it) { update(it.id, { image: r.uri, imageManual: true }); queryOne({ ...it, name }, { pick: true }); }
  }

  function switchCountry(c) {
    if (c === country) return;
    setCountry(c);
    const updated = items.map(it => it.status === 'todo' ? { ...it, country: c, term: '', price: null, range: null, actual: null, candidates: null, noResult: false, image: it.imageManual ? it.image : '' } : it);
    setItems(updated);
  }
  // 從熱門庫/建議加入：term 先對好當地關鍵字，加完自動查價（中位數）
  // 實際把熱門品加入清單並查價
  const addPopularItem = (p) => { const it = addItem(p.zh); if (it) { update(it.id, { term: p.term }); queryOne({ ...it, term: p.term }); } };
  // 熱門必買面板：點擊先跳介紹卡，再決定加入
  // 熱門品點擊：先跳介紹卡；若沒圖就即時抓一張商品圖補上
  const addPopular = (p) => {
    setShowPopular(false); // 先關熱門面板，介紹卡才不會被蓋住
    setPopInfo(p);
    if (!p.image) {
      fetch(`${WORKER_URL}/price?item=${encodeURIComponent(p.term || p.zh)}&country=${country}`)
        .then(r => r.json()).then(d => { const img = d.candidates?.[0]?.image; if (img) setPopInfo(cur => (cur && cur.zh === p.zh) ? { ...cur, image: img } : cur); }).catch(() => {});
    }
  };
  const confirmAddPopular = () => { const p = popInfo; setPopInfo(null); if (p) addPopularItem(p); };
  // 熱門清單：優先用 worker 發布清單，沒有才退回內建靜態
  // 只顯示「有圖」的熱門品（沒圖不上架）；遠端都沒有時才退回內建靜態
  const popList = useMemo(() => { const withImg = (remotePopular?.[country] || []).filter(x => x.image); return withImg.length ? withImg : STATIC_FLAT[country]; }, [remotePopular, country]);
  const popGroups = useMemo(() => groupFlat(popList), [popList]);
  const suggestions = useMemo(() => popularMatches(popList, input), [input, popList]);

  function completeItem(item) { update(item.id, { status: 'bought', store: item.store || '', boughtLocal: effLocal(item) }); showToast(`已移到記帳：${item.name}`, () => update(item.id, { status: 'todo' })); }
  function unbuy(item) { update(item.id, { status: 'todo' }); }
  // 記帳頁手動新增一筆已買（不經待買清單）
  function saveAddBought() {
    const f = addBought; const name = (f.name || '').trim();
    if (!name) { setAddBought(null); return; }
    const v = parseFloat(f.val) || 0;
    const c = f.country || country;
    const it = { id: Date.now().toString() + Math.random().toString(36).slice(2, 5), name, country: c, qty: 1, note: (f.note || '').trim(), term: '', image: '', imageManual: false, status: 'bought', price: null, currency: CO[c].cur, store: (f.store || '').trim(), boughtLocal: v };
    setItems(prev => [it, ...prev]);
    if (f.store) rememberStore(f.store.trim());
    setAddBought(null);
    showToast(`已新增已買：${name}`);
  }
  function removeItem(id) { const it = items.find(x => x.id === id); setItems(prev => prev.filter(x => x.id !== id)); if (it) showToast(`已刪除：${it.name}`, () => setItems(prev => [it, ...prev])); }

  const todoItems = useMemo(() => {
    const sorter = { added: (a, b) => (a.id < b.id ? 1 : -1), priceHigh: (a, b) => (b.price?.twd || 0) * b.qty - (a.price?.twd || 0) * a.qty, priceLow: (a, b) => ((a.price?.twd || 1e12) * a.qty) - ((b.price?.twd || 1e12) * b.qty) }[sort];
    return items.filter(i => i.status === 'todo').sort(sorter);
  }, [items, sort]);
  const boughtItems = useMemo(() => items.filter(i => i.status === 'bought'), [items]);

  // 每件「有效當地單價」：優先用實際購入價，否則用參考區間中位數，再否則用挑到的那筆
  const effLocal = (it) => it.actual != null ? it.actual : (it.range ? Math.round((it.range.min + it.range.max) / 2) : (it.price ? it.price.price : 0));
  const todoTotal = useMemo(() => todoItems.reduce((s, it) => s + Math.round(effLocal(it) * rateOf(it.country)) * it.qty, 0), [todoItems, rates]);
  // 記帳：依店家分組
  const ledger = useMemo(() => {
    const groups = {};
    for (const it of boughtItems) {
      const key = (it.store || '').trim() || '__none__';
      if (!groups[key]) groups[key] = { store: key === '__none__' ? '' : key, items: [], local: 0, twd: 0, country: it.country };
      const localUnit = it.boughtLocal != null ? it.boughtLocal : (it.price ? it.price.price : 0);
      groups[key].items.push(it);
      groups[key].local += localUnit * it.qty;
      groups[key].twd += Math.round(localUnit * rateOf(it.country)) * it.qty;
    }
    return Object.values(groups);
  }, [boughtItems, rates]);
  const spentTotal = useMemo(() => ledger.reduce((s, g) => s + g.twd, 0), [ledger]);

  // 旅行結束結算：依「花費 vs 預算」給不同等級文案
  function tripVerdict() {
    const spent = spentTotal, n = boughtItems.length, stores = ledger.length;
    if (!budget) return { color: C.rose, emoji: '✈️', title: '旅程結算', line: `這趟買了 ${n} 件・${stores} 家店，辛苦啦！`, big: spent };
    const ratio = spent / budget;
    if (spent > budget) return { color: '#E04848', emoji: '💸', title: '免稅不是免費啊啊啊！！', line: `超出預算 NT$${fmt(spent - budget)}…不過快樂無價啦 🥹`, big: spent };
    if (ratio >= 2 / 3) return { color: '#E8912E', emoji: '🎉', title: '漂亮！剛好守住預算線', line: `還剩 NT$${fmt(budget - spent)}，是個精打細算的旅人 👛`, big: spent };
    return { color: C.green, emoji: '👏', title: '這趟你超克制', line: `只花了預算的 ${Math.round(ratio * 100)}%，荷包毫髮無傷 💚`, big: spent };
  }
  function endTripClear() { setItems([]); setEndTrip(null); showToast('已結算清空，祝下趟旅程愉快 ✈️'); }

  const SORT_LABEL = { added: '加入順序', priceHigh: '價格高→低', priceLow: '價格低→高' };
  const cycleSort = () => setSort(s => (s === 'added' ? 'priceHigh' : s === 'priceHigh' ? 'priceLow' : 'added'));

  // ---- 待買卡片 ----
  const renderTodo = it => {
    const state = busy[it.id];
    const isOpen = expanded[it.id];
    const inner = (
      <View style={styles.card}>
        <View style={styles.rowTop}>
          <Text style={styles.name} numberOfLines={2}>{it.name}</Text>
          {!SWIPE_ENABLED && <TouchableOpacity onPress={() => removeItem(it.id)} hitSlop={10} accessibilityLabel="刪除"><Ionicons name="close" size={20} color="#cbbdb2" /></TouchableOpacity>}
        </View>
        <View style={styles.body}>
          <TouchableOpacity style={styles.imgWrap} onPress={() => it.image ? setZoom({ url: it.image, itemId: it.id }) : pickImage(it.id)} activeOpacity={0.85} accessibilityLabel="商品圖片">
            {it.image ? <Image source={{ uri: it.image }} style={styles.img} /> : <View style={styles.imgEmpty}><Ionicons name="camera-outline" size={22} color={C.muted} /><Text style={styles.imgEmptyTxt}>加圖</Text></View>}
          </TouchableOpacity>
          <View style={[styles.bodyRight, { justifyContent: 'space-between' }]}>
            {state === true ? (
              <View style={styles.priceRowTight}><Skeleton /></View>
            ) : (it.price || it.actual != null) ? (
              <View style={styles.priceBlock}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.refLine} numberOfLines={1}>參考均價 <Text style={styles.refLineTwd}>{it.price ? `NT$${fmt(it.price.twd * it.qty)}` : '—'}</Text>{it.range ? <Text style={styles.refLineLocal}>　{it.currency || CO[it.country].cur}{fmt(it.range.min)}~{fmt(it.range.max)}</Text> : null}</Text>
                  <TouchableOpacity onPress={() => setPriceEdit({ id: it.id, val: it.actual != null ? String(it.actual) : '', currency: it.currency || it.price?.currency || CO[it.country].cur })} activeOpacity={0.7} accessibilityLabel="填實際購入價" style={styles.actualLine}>
                    {it.actual != null ? (
                      <Text style={styles.actualLineOn} numberOfLines={1}>我的實付 NT${fmt(Math.round(it.actual * rateOf(it.country)) * it.qty)} <Text style={styles.actualLineLocal}>{it.currency || CO[it.country].cur}{fmt(it.actual)}{it.qty > 1 ? ` ×${it.qty}` : ''}</Text></Text>
                    ) : (
                      <><Ionicons name="add-circle" size={14} color={C.roseDeep} /><Text style={styles.actualLineFill}>填我的實付價</Text></>
                    )}
                  </TouchableOpacity>
                </View>
                {it.candidates && it.candidates.length ? <TouchableOpacity style={styles.changeBtn} onPress={() => openPicker(it)} activeOpacity={0.8} accessibilityLabel="更換商品"><Ionicons name="swap-horizontal" size={14} color={C.roseDeep} /></TouchableOpacity> : null}
              </View>
            ) : (
              <View style={styles.priceRowTight}>
                <TouchableOpacity style={styles.queryBtn} onPress={() => queryOne(it, { pick: true })} activeOpacity={0.85}><Ionicons name="search" size={15} color="#fff" /><Text style={styles.queryBtnTxt}>查價</Text></TouchableOpacity>
                <TouchableOpacity style={styles.changeBtn} onPress={() => setPriceEdit({ id: it.id, val: '', currency: CO[it.country].cur })} activeOpacity={0.8}><Text style={styles.changeBtnTxt}>自填價格</Text></TouchableOpacity>
              </View>
            )}
            {(state === 'err' || it.noResult) && (
              <View style={styles.errRow}>
                <Text style={styles.errTxt}>{state === 'err' ? '連線出錯，再試一次' : '查無結果'}</Text>
                {it.noResult && <TouchableOpacity onPress={() => openMore(it)}><Text style={styles.errLink}>到{CO[it.country].label}網站找 ›</Text></TouchableOpacity>}
              </View>
            )}
            <View style={styles.bodyRow}>
              <View style={styles.miniSeg}>
                {['jp', 'kr'].map(c => (
                  <TouchableOpacity key={c} style={[styles.miniSegBtn, it.country === c && styles.miniSegOn]} onPress={() => { if (it.country !== c) update(it.id, { country: c, term: '', price: null, range: null, actual: null, candidates: null, noResult: false, image: it.imageManual ? it.image : '' }); }} accessibilityLabel={CO[c].label}><Text style={[styles.miniSegTxt, it.country === c && styles.miniSegTxtOn]}>{CO[c].flag}</Text></TouchableOpacity>
                ))}
              </View>
              <View style={styles.qty}>
                <TouchableOpacity style={styles.qtyBtn} onPress={() => update(it.id, { qty: Math.max(1, it.qty - 1) })} accessibilityLabel="減少"><Ionicons name="remove" size={17} color={C.ink} /></TouchableOpacity>
                <Text style={styles.qtyNum}>{it.qty}</Text>
                <TouchableOpacity style={styles.qtyBtn} onPress={() => update(it.id, { qty: it.qty + 1 })} accessibilityLabel="增加"><Ionicons name="add" size={17} color={C.ink} /></TouchableOpacity>
              </View>
            </View>
          </View>
        </View>

        {isOpen && (
          <View style={styles.moreBox}>
            <TextInput style={styles.note} placeholder="備註：給媽媽 / 無香料…" placeholderTextColor="#c3b6ab" value={it.note} onChangeText={t => update(it.id, { note: t })} />
            <View style={styles.linkRow}>
              <TouchableOpacity onPress={() => setPriceEdit({ id: it.id, val: it.actual != null ? String(it.actual) : '', currency: it.currency || CO[it.country].cur })}><Text style={styles.linkTxt}>✏️ 填實際價</Text></TouchableOpacity>
              {it.price?.url ? <TouchableOpacity onPress={() => openUrl(sourceUrl(it))}><Text style={styles.linkTxt}>🔗 來源頁</Text></TouchableOpacity> : null}
              <TouchableOpacity onPress={() => openMore(it)}><Text style={styles.linkTxt}>🔎 看當地全部</Text></TouchableOpacity>
              {brandSite(it.name, it.country) ? <TouchableOpacity onPress={() => openUrl(brandSite(it.name, it.country))}><Text style={styles.linkTxt}>🏷️ 官網</Text></TouchableOpacity> : null}
            </View>
          </View>
        )}

        <View style={styles.cardFoot}>
          <TouchableOpacity style={styles.moreToggle} onPress={() => setExpanded(e => ({ ...e, [it.id]: !isOpen }))} hitSlop={6}>
            <Text style={styles.moreTxt}>{isOpen ? '收起' : (it.note ? '備註 ✓ ・更多' : '備註・更多')}</Text>
            <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={13} color={C.muted} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.doneBtn2} onPress={() => completeItem(it)} activeOpacity={0.85} accessibilityLabel="買到了，移到記帳">
            <Ionicons name="checkmark-circle" size={17} color="#fff" /><Text style={styles.doneBtnTxt}>買到了</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
    const card = SWIPE_ENABLED ? (
      <Swipeable
        renderRightActions={() => <TouchableOpacity style={styles.swipeDelete} onPress={() => removeItem(it.id)}><Ionicons name="trash-outline" size={22} color="#fff" /><Text style={styles.swipeTxt}>刪除</Text></TouchableOpacity>}
        renderLeftActions={() => <TouchableOpacity style={styles.swipeDone} onPress={() => completeItem(it)}><Ionicons name="checkmark-circle" size={22} color="#fff" /><Text style={styles.swipeTxt}>買到了</Text></TouchableOpacity>}
      >{inner}</Swipeable>
    ) : inner;
    return <AnimatedCard key={it.id} style={{ marginBottom: 12 }}>{card}</AnimatedCard>;
  };
  // 效能：只在清單/查價狀態/展開改變時重算卡片，打字搜尋時不重畫整列 → 捲動更順
  const todoCards = useMemo(() => todoItems.map(renderTodo), [todoItems, busy, expanded, rates]);

  // ---- 記帳卡片 ----
  const renderBought = it => {
    const localUnit = it.boughtLocal != null ? it.boughtLocal : (it.price ? it.price.price : 0);
    const twd = Math.round(localUnit * rateOf(it.country)) * it.qty;
    return (
      <View key={it.id} style={styles.ledgerItem}>
        {it.image ? <TouchableOpacity onPress={() => setZoom({ url: it.image })}><Image source={{ uri: it.image }} style={styles.ledgerImg} /></TouchableOpacity> : <View style={styles.ledgerImg} />}
        <View style={{ flex: 1 }}>
          <Text style={styles.ledgerName} numberOfLines={1}>{it.name}{it.qty > 1 ? ` ×${it.qty}` : ''}</Text>
          <View style={styles.ledgerPriceRow}>
            <Text style={styles.ledgerLocal}>{CO[it.country].cur}</Text>
            <TextInput style={styles.ledgerInput} keyboardType="numeric" value={String(localUnit || '')} onChangeText={t => update(it.id, { boughtLocal: parseFloat(t.replace(/[^0-9.]/g, '')) || 0 })} accessibilityLabel="實付金額" />
            <Text style={styles.ledgerTwd}>≈ NT${fmt(twd)}</Text>
          </View>
          <View style={styles.ledgerNoteRow}>
            <Ionicons name="create-outline" size={12} color={C.muted} />
            <TextInput style={styles.ledgerNote} value={it.note} placeholder="備註…" placeholderTextColor="#c3b6ab" onChangeText={t => update(it.id, { note: t })} accessibilityLabel="備註" />
          </View>
        </View>
        <TouchableOpacity onPress={() => unbuy(it)} hitSlop={8} accessibilityLabel="移回待買" style={{ padding: 4 }}><Ionicons name="arrow-undo-outline" size={18} color={C.muted} /></TouchableOpacity>
        <TouchableOpacity onPress={() => removeItem(it.id)} hitSlop={8} accessibilityLabel="刪除" style={{ padding: 4 }}><Ionicons name="close" size={18} color="#cbbdb2" /></TouchableOpacity>
      </View>
    );
  };

  const calcResult = () => { if (!calc) return ''; const amt = parseFloat(calc.amt) || 0; const r = rateOf(calc.cur); return calc.dir === 'toTWD' ? amt * r : amt / r; };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />

      {/* HERO */}
      <View style={styles.hero}>
        <View style={[styles.heroBlob, styles.heroBlob1]} />
        <View style={[styles.heroBlob, styles.heroBlob2]} />
        <View style={styles.heroTop}>
          <Text style={styles.heroBrand}>免稅不是免費</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity style={styles.scanBtn} onPress={() => aiTipSeen ? scanImage(true) : setAiTip(true)} activeOpacity={0.85} accessibilityLabel="AI 產品辨識"><Ionicons name="camera" size={18} color={C.roseDeep} /><Text style={styles.scanBtnTxt}>AI 產品辨識</Text></TouchableOpacity>
            <TouchableOpacity style={styles.calcBtn} onPress={() => setCalc({ cur: country, dir: 'toTWD', amt: '' })} activeOpacity={0.8} accessibilityLabel="匯率計算機"><Ionicons name="calculator-outline" size={20} color="#fff" /></TouchableOpacity>
          </View>
        </View>
        <View style={styles.heroSeg}>
          {['jp', 'kr'].map(c => (
            <TouchableOpacity key={c} style={[styles.heroSegBtn, country === c && styles.heroSegOn]} onPress={() => switchCountry(c)} activeOpacity={0.85}><Text style={[styles.heroSegTxt, country === c && styles.heroSegTxtOn]}>{CO[c].flag} {CO[c].label}</Text></TouchableOpacity>
          ))}
        </View>
        <Text style={styles.heroLabel}>{tab === 'list' ? '待買預估' : '已花費'}</Text>
        <Text style={styles.heroTotal}>NT${fmt(tab === 'list' ? todoTotal : spentTotal)}</Text>
        <Text style={styles.heroSub}>{tab === 'list' ? `待買 ${todoItems.length} 件` : `已買 ${boughtItems.length} 件 ・ ${ledger.length} 店`}　·　1 {CO[country].curLabel} ≈ NT${rateOf(country).toFixed(country === 'kr' ? 3 : 2)}</Text>
      </View>

      {/* 分頁 */}
      <View style={styles.tabs}>
        {[['list', '待買清單', 'list-outline'], ['ledger', '記帳', 'wallet-outline']].map(([k, label, icon]) => (
          <TouchableOpacity key={k} style={[styles.tab, tab === k && styles.tabOn]} onPress={() => setTab(k)} activeOpacity={0.8}>
            <Ionicons name={icon} size={18} color={tab === k ? C.rose : C.muted} />
            <Text style={[styles.tabTxt, tab === k && styles.tabTxtOn]}>{label}{k === 'ledger' && boughtItems.length ? ` ${boughtItems.length}` : ''}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'list' ? (
        <>
          <View style={styles.addBar}>
            <View style={[styles.addInputWrap, inputFocus && styles.addInputWrapFocus]}>
              <Ionicons name="search" size={18} color={inputFocus ? C.rose : C.muted} />
              <TextInput style={styles.addInput} placeholder="輸入商品名稱" placeholderTextColor="#bca99c" value={input} onChangeText={setInput} onFocus={() => setInputFocus(true)} onBlur={() => setInputFocus(false)} onSubmitEditing={() => { const it = addItem(); if (it) queryOne(it, { pick: true }); }} returnKeyType="search" />
            </View>
            <TouchableOpacity style={styles.addBtn} onPress={() => addItem()} activeOpacity={0.85} accessibilityLabel="加入清單"><Ionicons name="add" size={26} color="#fff" /></TouchableOpacity>
          </View>

          {suggestions.length > 0 && (
            <View style={styles.suggestBox}>
              {suggestions.map((s, i) => (
                <TouchableOpacity key={s.zh} style={[styles.suggestRow, i > 0 && styles.suggestDivider]} onPress={() => addPopular(s)} activeOpacity={0.7} accessibilityLabel={`加入 ${s.zh}`}>
                  <Text style={styles.suggestEmoji}>{s.e}</Text>
                  <Text style={styles.suggestZh} numberOfLines={1}>{s.zh}</Text>
                  <Text style={styles.suggestTerm} numberOfLines={1}>{s.term}</Text>
                  <Ionicons name="add-circle" size={20} color={C.rose} />
                </TouchableOpacity>
              ))}
            </View>
          )}

          <View style={styles.toolRow}>
            <TouchableOpacity style={styles.toolChip} onPress={() => setShowPopular(true)} activeOpacity={0.85}><Ionicons name="flame" size={14} color={C.rose} /><Text style={[styles.toolChipTxt, { color: C.roseDeep }]}>熱門必買</Text></TouchableOpacity>
            {todoItems.length > 0 && <TouchableOpacity style={styles.toolChip} onPress={cycleSort} activeOpacity={0.8}><Ionicons name="swap-vertical" size={14} color={C.inkSoft} /><Text style={styles.toolChipTxt}>{SORT_LABEL[sort]}</Text></TouchableOpacity>}
            {todoItems.length > 0 && <TouchableOpacity style={[styles.toolChip, styles.toolChipPrimary]} onPress={queryAll} activeOpacity={0.85}><Ionicons name="search" size={14} color="#fff" /><Text style={[styles.toolChipTxt, { color: '#fff' }]}>全部查價</Text></TouchableOpacity>}
          </View>

          <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
            {todoItems.length === 0 && (
              <View style={styles.emptyWrap}><View style={styles.emptyIcon}><Ionicons name="bag-handle-outline" size={40} color={C.rose} /></View><Text style={styles.emptyBig}>清單還是空的</Text><Text style={styles.empty}>打上商品名稱，或用右上「AI 產品辨識」拍照{'\n'}加好後按「查價」，幫你比當地價、即時換算台幣 💰</Text></View>
            )}
            {todoCards}
            <TouchableOpacity style={styles.guideLink} onPress={() => setGuide(true)} activeOpacity={0.7}><Ionicons name="help-circle-outline" size={15} color={C.muted} /><Text style={styles.guideLinkTxt}>使用說明</Text></TouchableOpacity>
          </ScrollView>
        </>
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
          {(() => {
            if (!budget) return (
              <TouchableOpacity style={styles.budgetSet} onPress={() => setBudgetEdit({ val: '' })} activeOpacity={0.85}><Ionicons name="add-circle-outline" size={18} color={C.rose} /><Text style={styles.budgetSetTxt}>設定本趟預算</Text></TouchableOpacity>
            );
            const ratio = spentTotal / budget;
            const col = ratio >= 0.75 ? '#E04848' : ratio >= 2 / 3 ? '#E8912E' : C.green;
            const left = budget - spentTotal;
            return (
              <TouchableOpacity style={styles.budgetCard} onPress={() => setBudgetEdit({ val: String(budget) })} activeOpacity={0.9}>
                <View style={styles.budgetTop}>
                  <Text style={styles.budgetLabel}>預算 NT${fmt(budget)}　<Ionicons name="create-outline" size={12} color={C.muted} /></Text>
                  <Text style={[styles.budgetLeft, { color: left < 0 ? '#E04848' : C.inkSoft }]}>{left < 0 ? `超支 NT$${fmt(-left)}` : `剩 NT$${fmt(left)}`}</Text>
                </View>
                <View style={styles.budgetTrack}><View style={[styles.budgetFill, { width: `${Math.min(100, ratio * 100)}%`, backgroundColor: col }]} /></View>
                <Text style={styles.budgetSpent}>已花 <Text style={{ color: col, fontWeight: '900' }}>NT${fmt(spentTotal)}</Text>　·　{Math.round(ratio * 100)}%</Text>
              </TouchableOpacity>
            );
          })()}
          <TouchableOpacity style={styles.addBoughtBtn} onPress={() => setAddBought({ country, name: '', val: '', store: '', note: '' })} activeOpacity={0.85}><Ionicons name="add-circle-outline" size={18} color={C.rose} /><Text style={styles.addBoughtTxt}>手動新增已買項目</Text></TouchableOpacity>
          {boughtItems.length === 0 && (
            <View style={styles.emptyWrap}><View style={styles.emptyIcon}><Ionicons name="receipt-outline" size={38} color={C.rose} /></View><Text style={styles.emptyBig}>還沒有花費</Text><Text style={styles.empty}>在「待買清單」把買到的打「買到了」，或上方「手動新增已買」{'\n'}就會移到這裡記帳、依店家算免稅門檻</Text></View>
          )}
          {ledger.map((g, gi) => {
            const thr = TAXFREE[g.country] || 5000;
            const reached = g.local >= thr;
            const left = Math.max(0, thr - g.local);
            return (
              <View key={gi} style={styles.storeGroup}>
                <View style={styles.storeHead}>
                  <TouchableOpacity style={styles.storeNameBtn} onPress={() => setStoreEdit({ ids: g.items.map(i => i.id), val: g.store })} activeOpacity={0.7}>
                    <Ionicons name="storefront-outline" size={15} color={C.inkSoft} />
                    <Text style={styles.storeName}>{g.store || '未指定店家'}</Text>
                    <Ionicons name="create-outline" size={13} color={C.muted} />
                  </TouchableOpacity>
                  <Text style={styles.storeTwd}>NT${fmt(g.twd)}</Text>
                </View>
                <View style={[styles.taxBar, reached && styles.taxBarOk]}>
                  <Ionicons name={reached ? 'checkmark-circle' : 'information-circle-outline'} size={15} color={reached ? C.green : C.gold} />
                  <Text style={[styles.taxTxt, reached && { color: C.green }]}>
                    {reached ? `已達免稅門檻（${CO[g.country].cur}${fmt(thr)}）` : `距免稅門檻還差 ${CO[g.country].cur}${fmt(left)}（滿 ${CO[g.country].cur}${fmt(thr)}）`}
                  </Text>
                </View>
                {g.items.map(renderBought)}
              </View>
            );
          })}
          {boughtItems.length > 0 && (
            <TouchableOpacity style={styles.endTripBtn} onPress={() => setEndTrip('summary')} activeOpacity={0.85}>
              <Ionicons name="flag" size={16} color={C.rose} /><Text style={styles.endTripTxt}>結束這趟旅行・看結算</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.guideLink} onPress={() => setGuide(true)} activeOpacity={0.7}><Ionicons name="help-circle-outline" size={15} color={C.muted} /><Text style={styles.guideLinkTxt}>使用說明</Text></TouchableOpacity>
        </ScrollView>
      )}

      {scanning && <View style={styles.scanOverlay}><ActivityIndicator size="large" color="#fff" /><Text style={styles.scanTxt}>辨識商品中…</Text></View>}

      {/* 拍照識物卡 */}
      <Modal visible={!!scanResult} transparent animationType="fade" onRequestClose={() => setScanResult(null)}>
        <View style={styles.centerBackdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setScanResult(null)} />
          <View style={styles.storeModal}>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ maxHeight: 560 }}>
              <Text style={styles.sheetKicker}>📷 AI 辨識結果</Text>
              {scanResult?.uri ? <Image source={{ uri: scanResult.uri }} style={styles.scanPreview} resizeMode="contain" /> : null}
              <Text style={styles.scanLabel}>商品名稱（可修改）</Text>
              <TextInput style={styles.storeInput} value={scanResult?.name} placeholder="商品名稱" placeholderTextColor="#cdbdb0" onChangeText={t => setScanResult(s => ({ ...s, name: t }))} />
              {scanResult?.info ? <View style={styles.scanInfoBox}><Ionicons name="information-circle" size={15} color={C.gold} /><Text style={styles.scanInfo}>{scanResult.info}</Text></View> : null}
              {scanResult?.claim ? (
                <View style={styles.claimBox}>
                  <Text style={styles.claimLabel}>✨ 主打效果（廠商宣稱／社群分享）</Text>
                  <Text style={styles.claimTxt}>{scanResult.claim}</Text>
                  <Text style={styles.claimNote}>以上為產品宣傳說法，效果因人而異</Text>
                </View>
              ) : null}
              {scanResult?.name ? (
                <TouchableOpacity style={styles.scanReviewBtn} onPress={() => openUrl(`https://www.google.com/search?q=${encodeURIComponent((scanResult.name || '') + ' 推薦 評價 心得')}`)} activeOpacity={0.85}>
                  <Ionicons name="search-outline" size={14} color={C.inkSoft} />
                  <Text style={styles.scanReviewTxt}>看網友推薦・評價（部落格／社群）›</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity style={[styles.storeSave, { marginTop: 16 }]} onPress={addFromScan} activeOpacity={0.85}><Text style={styles.storeSaveTxt}>加入清單並比價</Text></TouchableOpacity>
              <TouchableOpacity style={{ paddingVertical: 11 }} onPress={() => setScanResult(null)}><Text style={styles.endBack}>取消</Text></TouchableOpacity>
              <Text style={styles.scanDisclaim}>僅提供產品資訊參考，不作為購物建議</Text>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* 首次使用 AI 辨識提示 */}
      <Modal visible={aiTip} transparent animationType="fade" onRequestClose={() => setAiTip(false)}>
        <View style={styles.centerBackdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setAiTip(false)} />
          <View style={styles.storeModal}>
            <Text style={styles.aiTipEmoji}>📸</Text>
            <Text style={styles.aiTipTitle}>拍照小撇步</Text>
            <Text style={styles.aiTipBody}>盡量拍到<Text style={{ fontWeight: '800' }}>完整包裝與品牌 Logo</Text>，並對準商品名稱、光線充足、避免反光與模糊，辨識會更準喔！</Text>
            <TouchableOpacity style={[styles.storeSave, { marginTop: 18 }]} onPress={() => { setAiTip(false); setAiTipSeen(true); scanImage(true); }} activeOpacity={0.85}><Text style={styles.storeSaveTxt}>知道了，開始拍照</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 熱門品介紹卡：點熱門品先看介紹再決定加入 */}
      <Modal visible={!!popInfo} transparent animationType="fade" onRequestClose={() => setPopInfo(null)}>
        <View style={styles.centerBackdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setPopInfo(null)} />
          <View style={styles.storeModal}>
            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 540 }}>
              {popInfo?.image ? <Image source={{ uri: popInfo.image }} style={styles.popInfoImg} resizeMode="contain" /> : <Text style={styles.popInfoEmoji}>{popInfo?.e || '🛍️'}</Text>}
              <Text style={styles.popInfoName}>{popInfo?.zh}</Text>
              {(popInfo?.info || popInfo?.d) ? <View style={styles.scanInfoBox}><Ionicons name="information-circle" size={15} color={C.gold} /><Text style={styles.scanInfo}>{popInfo.info || popInfo.d}</Text></View> : null}
              {popInfo?.claim ? (
                <View style={styles.claimBox}>
                  <Text style={styles.claimLabel}>✨ 主打效果（廠商宣稱／社群分享）</Text>
                  <Text style={styles.claimTxt}>{popInfo.claim}</Text>
                  <Text style={styles.claimNote}>以上為產品宣傳說法，效果因人而異</Text>
                </View>
              ) : null}
              {popInfo?.zh ? (
                <TouchableOpacity style={styles.scanReviewBtn} onPress={() => openUrl(`https://www.google.com/search?q=${encodeURIComponent((popInfo.zh || '') + ' 推薦 評價 心得')}`)} activeOpacity={0.85}>
                  <Ionicons name="search-outline" size={14} color={C.inkSoft} />
                  <Text style={styles.scanReviewTxt}>看網友推薦・評價（部落格／社群）›</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity style={[styles.storeSave, { marginTop: 14 }]} onPress={confirmAddPopular} activeOpacity={0.85}><Text style={styles.storeSaveTxt}>加入清單並比價</Text></TouchableOpacity>
              <TouchableOpacity style={{ paddingVertical: 11 }} onPress={() => setPopInfo(null)}><Text style={styles.endBack}>取消</Text></TouchableOpacity>
              <Text style={styles.scanDisclaim}>僅提供產品資訊參考，不作為購物建議</Text>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* 低信心確認：你要找的是 XXX 嗎 */}
      <Modal visible={!!scanAsk} transparent animationType="fade" onRequestClose={() => setScanAsk(null)}>
        <View style={styles.centerBackdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setScanAsk(null)} />
          <View style={styles.storeModal}>
            <Text style={styles.sheetKicker}>🤔 不太確定…</Text>
            {scanAsk?.uri ? <Image source={{ uri: scanAsk.uri }} style={styles.scanPreview} resizeMode="contain" /> : null}
            <Text style={styles.scanLabel}>你要找的是這個嗎？（可修改）</Text>
            <TextInput style={styles.storeInput} value={scanAsk?.name} placeholder="商品名稱" placeholderTextColor="#cdbdb0" onChangeText={t => setScanAsk(s => ({ ...s, name: t }))} />
            <Text style={styles.scanAskHint}>AI 對這張照片把握不大，確認商品名後再查價會更準</Text>
            <TouchableOpacity style={[styles.storeSave, { marginTop: 14 }]} onPress={addFromAsk} activeOpacity={0.85}><Text style={styles.storeSaveTxt}>是，用這個查價</Text></TouchableOpacity>
            <TouchableOpacity style={{ paddingVertical: 11 }} onPress={() => setScanAsk(null)}><Text style={styles.endBack}>不是，關閉</Text></TouchableOpacity>
            <Text style={styles.scanDisclaim}>僅提供產品資訊參考，不作為購物建議</Text>
          </View>
        </View>
      </Modal>

      {/* 候選選擇器（含改關鍵字） */}
      <Modal visible={!!picker} transparent animationType="slide" onRequestClose={() => setPicker(null)}>
        <View style={styles.sheetBackdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setPicker(null)} />
          <View style={styles.sheet}>
            <View style={styles.grip} />
            <View style={styles.sheetHead}>
              <View style={{ flex: 1 }}><Text style={styles.sheetKicker} numberOfLines={1}>{picker?.name}</Text><Text style={styles.sheetTitle}>選一個正確的</Text></View>
              <TouchableOpacity onPress={() => setPicker(null)} hitSlop={10}><Ionicons name="close" size={24} color={C.muted} /></TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.pickerNone} onPress={() => { const id = picker.itemId; const it = items.find(i => i.id === id); setPicker(null); update(id, { price: null, range: null, candidates: null, noResult: false, image: it?.imageManual ? it.image : '' }); }} activeOpacity={0.85}>
              <Ionicons name="close-circle-outline" size={16} color={C.roseDeep} />
              <Text style={styles.pickerNoneTxt}>都不是我要的 → 回卡片自填價格、上傳照片</Text>
            </TouchableOpacity>
            <View style={styles.repickRow}>
              <Ionicons name="search-outline" size={15} color={C.gold} />
              <TextInput style={styles.repickInput} value={picker?.term} placeholder="找不到？改關鍵字" placeholderTextColor="#cdbdb0" onChangeText={t => setPicker(p => ({ ...p, term: t }))} />
              <TouchableOpacity style={styles.repickBtn} onPress={repickWithTerm} activeOpacity={0.85}><Text style={styles.repickBtnTxt}>重搜</Text></TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false}>
              {(picker?.candidates || []).map((c, i) => (
                <TouchableOpacity key={i} style={styles.cand} onPress={() => choosePick(c)} activeOpacity={0.7}>
                  {c.image ? <TouchableOpacity onPress={() => setZoom({ url: c.image })} activeOpacity={0.8}><Image source={{ uri: c.image }} style={styles.candImg} /></TouchableOpacity> : <View style={styles.candImg} />}
                  <View style={{ flex: 1 }}><Text style={styles.candTitle} numberOfLines={2}>{c.title}</Text>{picker.trans?.[c.title] ? <Text style={styles.candTrans} numberOfLines={1}>🔁 {picker.trans[c.title]}</Text> : (picker.translating ? <Text style={styles.candTransLoading}>🔁 翻譯中…</Text> : null)}<Text style={styles.candPrice}>{picker.currency}{fmt(c.price)}<Text style={styles.candTwd}>　NT${fmt(c.twd)}</Text></Text></View>
                  <View style={styles.candPick}><Text style={styles.candPickTxt}>選</Text></View>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={styles.seeAllBtn} onPress={() => { const t = picker.term || picker.name; setPicker(null); openUrl(localSearchUrl(items.find(i => i.id === picker.itemId)?.country || country, t)); }} activeOpacity={0.85}>
              <Ionicons name="open-outline" size={15} color={C.inkSoft} />
              <Text style={styles.seeAllTxt}>用瀏覽器開官網看全部</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 熱門必買 */}
      <Modal visible={showPopular} transparent animationType="slide" onRequestClose={() => setShowPopular(false)}>
        <View style={styles.sheetBackdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setShowPopular(false)} />
          <View style={[styles.sheet, { maxHeight: '82%' }]}>
            <View style={styles.grip} />
            <View style={styles.sheetHead}>
              <View style={{ flex: 1 }}><Text style={styles.sheetKicker}>{CO[country].flag} {CO[country].label}・代購人氣</Text><Text style={styles.sheetTitle}>熱門必買，點一下加入</Text></View>
              <TouchableOpacity onPress={() => setShowPopular(false)} hitSlop={10}><Ionicons name="close" size={24} color={C.muted} /></TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {popGroups.map(g => (
                <View key={g.c} style={{ marginBottom: 16 }}>
                  <Text style={styles.popCat}>{g.e} {g.c}</Text>
                  {groupByBrand(g.list).map((bg, bi) => {
                    const grouped = bg.brand && bg.items.length >= 2;
                    return (
                      <View key={bg.brand || ('s' + bi)} style={grouped ? styles.brandGroup : null}>
                        {grouped && (
                          <View style={styles.brandHead}>
                            <Text style={styles.brandName}>{bg.brand}</Text>
                            <TouchableOpacity onPress={() => openUrl(`https://www.google.com/search?q=${encodeURIComponent(bg.brand + ' 熱門 推薦')}`)} hitSlop={8} activeOpacity={0.7}><Text style={styles.brandMore}>了解更多 ›</Text></TouchableOpacity>
                          </View>
                        )}
                        <View style={styles.popWrap}>
                          {bg.items.map(p => (
                            <TouchableOpacity key={p.zh} style={styles.popCard} onPress={() => addPopular(p)} activeOpacity={0.85} accessibilityLabel={`查看 ${p.zh}`}>
                              {p.image ? <Image source={{ uri: p.image }} style={styles.popThumb} /> : <View style={[styles.popThumb, styles.popThumbEmpty]}><Ionicons name="image-outline" size={20} color={C.muted} /></View>}
                              <Text style={styles.popCardTxt} numberOfLines={2}>{grouped ? stripBrand(p.zh, bg.brand) : p.zh}</Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>
                    );
                  })}
                </View>
              ))}
              <Text style={styles.popHint}>點一下會先看產品介紹，再決定要不要加入比價</Text>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* 店家編輯 */}
      <Modal visible={!!storeEdit} transparent animationType="fade" onRequestClose={() => setStoreEdit(null)}>
        <View style={styles.centerBackdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setStoreEdit(null)} />
          <View style={styles.storeModal}>
            <Text style={styles.sheetTitle}>這批在哪家買？</Text>
            <TextInput style={styles.storeInput} value={storeEdit?.val} placeholder="店家名稱，例如 唐吉訶德 梅田店" placeholderTextColor="#cdbdb0" autoFocus onChangeText={t => setStoreEdit(s => ({ ...s, val: t }))} />
            {stores.length > 0 && (
              <View style={styles.storeChips}>{stores.map(s => <TouchableOpacity key={s} style={styles.storeChip} onPress={() => setStoreEdit(e => ({ ...e, val: s }))}><Text style={styles.storeChipTxt}>{s}</Text></TouchableOpacity>)}</View>
            )}
            <TouchableOpacity style={styles.storeSave} onPress={() => { const v = (storeEdit.val || '').trim(); setItems(prev => prev.map(it => storeEdit.ids.includes(it.id) ? { ...it, store: v } : it)); rememberStore(v); setStoreEdit(null); }} activeOpacity={0.85}><Text style={styles.storeSaveTxt}>儲存</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 預算設定 */}
      <Modal visible={!!budgetEdit} transparent animationType="fade" onRequestClose={() => setBudgetEdit(null)}>
        <View style={styles.centerBackdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setBudgetEdit(null)} />
          <View style={styles.storeModal}>
            <Text style={styles.sheetTitle}>本趟預算（台幣）</Text>
            <TextInput style={styles.storeInput} keyboardType="numeric" value={budgetEdit?.val} placeholder="例如 20000" placeholderTextColor="#cdbdb0" autoFocus onChangeText={t => setBudgetEdit(s => ({ ...s, val: t.replace(/[^0-9]/g, '') }))} />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              {budget > 0 && <TouchableOpacity style={[styles.storeSave, { flex: 0, paddingHorizontal: 16, backgroundColor: C.bg }]} onPress={() => { setBudget(0); setBudgetEdit(null); }}><Text style={[styles.storeSaveTxt, { color: C.inkSoft }]}>清除</Text></TouchableOpacity>}
              <TouchableOpacity style={[styles.storeSave, { flex: 1 }]} onPress={() => { setBudget(parseInt(budgetEdit.val) || 0); setBudgetEdit(null); }} activeOpacity={0.85}><Text style={styles.storeSaveTxt}>儲存</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 自填價格 */}
      <Modal visible={!!priceEdit} transparent animationType="fade" onRequestClose={() => setPriceEdit(null)}>
        <View style={styles.centerBackdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setPriceEdit(null)} />
          <View style={styles.storeModal}>
            <Text style={styles.sheetTitle}>我的實際購入價（{priceEdit?.currency}）</Text>
            <TextInput style={styles.storeInput} keyboardType="numeric" value={priceEdit?.val} placeholder="實際付的當地價，例如 1280" placeholderTextColor="#cdbdb0" autoFocus onChangeText={t => setPriceEdit(s => ({ ...s, val: t.replace(/[^0-9.]/g, '') }))} />
            <TouchableOpacity style={[styles.storeSave, { marginTop: 16 }]} onPress={() => { const v = priceEdit.val === '' ? null : (parseFloat(priceEdit.val) || 0); const id = priceEdit.id; setItems(prev => prev.map(it => it.id === id ? { ...it, noResult: false, actual: v } : it)); setPriceEdit(null); }} activeOpacity={0.85}><Text style={styles.storeSaveTxt}>儲存</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 記帳頁手動新增已買 */}
      <Modal visible={!!addBought} transparent animationType="fade" onRequestClose={() => setAddBought(null)}>
        <View style={styles.centerBackdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setAddBought(null)} />
          <View style={styles.storeModal}>
            <Text style={styles.sheetTitle}>手動新增已買項目</Text>
            <View style={[styles.calcSeg, { marginTop: 12 }]}>
              {['jp', 'kr'].map(c => { const on = (addBought?.country || country) === c; return (
                <TouchableOpacity key={c} style={[styles.calcSegBtn, on && styles.calcSegOn]} onPress={() => setAddBought(s => ({ ...s, country: c }))} activeOpacity={0.85}><Text style={[styles.calcSegTxt, on && styles.calcSegTxtOn]}>{CO[c].flag} {CO[c].label}</Text></TouchableOpacity>
              ); })}
            </View>
            <TextInput style={[styles.storeInput, { marginTop: 10 }]} value={addBought?.name} placeholder="商品名稱" placeholderTextColor="#cdbdb0" onChangeText={t => setAddBought(s => ({ ...s, name: t }))} />
            <TextInput style={[styles.storeInput, { marginTop: 10 }]} keyboardType="numeric" value={addBought?.val} placeholder={`實付當地價（${CO[(addBought?.country) || country].cur}）`} placeholderTextColor="#cdbdb0" onChangeText={t => setAddBought(s => ({ ...s, val: t.replace(/[^0-9.]/g, '') }))} />
            <TextInput style={[styles.storeInput, { marginTop: 10 }]} value={addBought?.store} placeholder="店家（可留空）" placeholderTextColor="#cdbdb0" onChangeText={t => setAddBought(s => ({ ...s, store: t }))} />
            <TextInput style={[styles.storeInput, { marginTop: 10 }]} value={addBought?.note} placeholder="備註（可留空）" placeholderTextColor="#cdbdb0" onChangeText={t => setAddBought(s => ({ ...s, note: t }))} />
            <TouchableOpacity style={[styles.storeSave, { marginTop: 16 }]} onPress={saveAddBought} activeOpacity={0.85}><Text style={styles.storeSaveTxt}>新增</Text></TouchableOpacity>
            <TouchableOpacity style={{ paddingVertical: 11 }} onPress={() => setAddBought(null)}><Text style={styles.endBack}>取消</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 圖片放大 */}
      <Modal visible={!!zoom} transparent animationType="fade" onRequestClose={() => setZoom(null)}>
        <TouchableOpacity style={styles.zoomBackdrop} activeOpacity={1} onPress={() => setZoom(null)}>
          {zoom?.url ? <Image source={{ uri: zoom.url }} style={styles.zoomImg} resizeMode="contain" /> : null}
          <View style={styles.zoomBar}>
            {zoom?.itemId ? <TouchableOpacity style={styles.zoomReplace} onPress={() => { const id = zoom.itemId; setZoom(null); pickImage(id); }}><Ionicons name="image-outline" size={16} color="#fff" /><Text style={styles.zoomReplaceTxt}>換成自己的圖</Text></TouchableOpacity> : <View />}
            <TouchableOpacity style={styles.zoomClose} onPress={() => setZoom(null)}><Text style={styles.zoomCloseTxt}>關閉</Text></TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 匯率計算機 */}
      <Modal visible={!!calc} transparent animationType="fade" onRequestClose={() => setCalc(null)}>
        <View style={styles.centerBackdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setCalc(null)} />
          <View style={styles.storeModal}>
            <View style={styles.sheetHead}><View><Text style={styles.sheetKicker}>匯率計算機</Text><Text style={styles.sheetTitle}>快速換算</Text></View><TouchableOpacity onPress={() => setCalc(null)} hitSlop={10}><Ionicons name="close" size={24} color={C.muted} /></TouchableOpacity></View>
            {calc && (
              <View style={{ paddingTop: 6 }}>
                <View style={styles.calcRow}>
                  <View style={styles.calcSeg}>{['jp', 'kr'].map(c => <TouchableOpacity key={c} style={[styles.calcSegBtn, calc.cur === c && styles.calcSegOn]} onPress={() => setCalc({ ...calc, cur: c })}><Text style={[styles.calcSegTxt, calc.cur === c && styles.calcSegTxtOn]}>{CO[c].flag} {CO[c].curLabel}</Text></TouchableOpacity>)}</View>
                  <TouchableOpacity style={styles.swapBtn} onPress={() => setCalc({ ...calc, dir: calc.dir === 'toTWD' ? 'fromTWD' : 'toTWD' })} accessibilityLabel="切換方向"><Ionicons name="swap-horizontal" size={22} color={C.rose} /></TouchableOpacity>
                </View>
                <Text style={styles.calcDirTxt}>{calc.dir === 'toTWD' ? `${CO[calc.cur].curLabel} → 台幣` : `台幣 → ${CO[calc.cur].curLabel}`}</Text>
                <TextInput style={styles.calcInput} keyboardType="numeric" placeholder="0" placeholderTextColor="#cdbdb0" value={calc.amt} onChangeText={t => setCalc({ ...calc, amt: t.replace(/[^0-9.]/g, '') })} autoFocus />
                <View style={styles.calcResult}><Text style={styles.calcResultLabel}>{calc.dir === 'toTWD' ? '約等於' : `約等於 ${CO[calc.cur].curLabel}`}</Text><Text style={styles.calcResultNum}>{calc.dir === 'toTWD' ? 'NT$' : CO[calc.cur].cur}{fmt(calcResult())}</Text></View>
                <Text style={styles.calcRate}>參考匯率 1 {CO[calc.cur].curLabel} ≈ NT${rateOf(calc.cur).toFixed(calc.cur === 'kr' ? 3 : 2)}</Text>
              </View>
            )}
          </View>
        </View>
      </Modal>
      {/* 旅行結算 */}
      <Modal visible={!!endTrip} transparent animationType="fade" onRequestClose={() => setEndTrip(null)}>
        <View style={styles.centerBackdrop}>
          {endTrip === 'confirm' ? (
            <View style={styles.onboardCard}>
              <Text style={styles.endEmoji}>🧹</Text>
              <Text style={styles.endTitle}>確定要清空嗎？</Text>
              <Text style={styles.endLine}>待買清單和記帳資料會全部清除，無法復原（預算設定會保留）。</Text>
              <TouchableOpacity style={[styles.storeSave, { backgroundColor: '#E04848', alignSelf: 'stretch' }]} onPress={endTripClear} activeOpacity={0.85}><Text style={styles.storeSaveTxt}>確定清空，開始新旅程</Text></TouchableOpacity>
              <TouchableOpacity style={{ paddingVertical: 12 }} onPress={() => setEndTrip('summary')}><Text style={styles.endBack}>返回</Text></TouchableOpacity>
            </View>
          ) : endTrip === 'summary' ? (() => {
            const v = tripVerdict();
            return (
              <View style={styles.onboardCard}>
                <Text style={styles.endEmoji}>{v.emoji}</Text>
                <Text style={[styles.endTitle, { color: v.color }]}>{v.title}</Text>
                <Text style={styles.endBigLabel}>本趟總花費</Text>
                <Text style={[styles.endBig, { color: v.color }]}>NT${fmt(v.big)}</Text>
                {!!budget && <Text style={styles.endSub}>預算 NT${fmt(budget)}</Text>}
                <View style={styles.endStatRow}>
                  <View style={styles.endStat}><Text style={styles.endStatNum}>{boughtItems.length}</Text><Text style={styles.endStatLbl}>件商品</Text></View>
                  <View style={styles.endStatDiv} />
                  <View style={styles.endStat}><Text style={styles.endStatNum}>{ledger.length}</Text><Text style={styles.endStatLbl}>家店</Text></View>
                </View>
                <Text style={styles.endLine}>{v.line}</Text>
                <TouchableOpacity style={[styles.storeSave, { alignSelf: 'stretch' }]} onPress={() => setEndTrip('confirm')} activeOpacity={0.85}><Text style={styles.storeSaveTxt}>結束並清空</Text></TouchableOpacity>
                <TouchableOpacity style={{ paddingVertical: 12 }} onPress={() => setEndTrip(null)}><Text style={styles.endBack}>先不要，繼續逛</Text></TouchableOpacity>
              </View>
            );
          })() : null}
        </View>
      </Modal>

      {/* Toast */}
      {toast && (
        <View style={styles.toastWrap} pointerEvents="box-none">
          <View style={styles.toast}>
            <Text style={styles.toastTxt} numberOfLines={1}>{toast.msg}</Text>
            {toast.undo && <TouchableOpacity onPress={() => { toast.undo(); setToast(null); }}><Text style={styles.toastUndo}>復原</Text></TouchableOpacity>}
          </View>
        </View>
      )}

      {/* 首次導覽 */}
      <Modal visible={onboard} transparent animationType="fade" onRequestClose={() => setOnboard(false)}>
        <View style={styles.centerBackdrop}>
          <View style={styles.onboardCard}>
            <Text style={styles.onboardEmoji}>🛍️</Text>
            <Text style={styles.onboardTitle}>歡迎用「免稅不是免費」</Text>
            {[['add', '1. 加入想買的', '打上商品名稱，或用右上「AI 產品辨識」拍照'], ['search', '2. 查當地價', '按「查價」自動換算台幣、挑正確商品'], ['wallet', '3. 買到就記帳', '打「買到了」移到記帳頁，依店家算免稅門檻']].map(([ic, t, d]) => (
              <View key={t} style={styles.onboardRow}>
                <View style={styles.onboardIcon}><Ionicons name={ic} size={18} color={C.rose} /></View>
                <View style={{ flex: 1 }}><Text style={styles.onboardRowT}>{t}</Text><Text style={styles.onboardRowD}>{d}</Text></View>
              </View>
            ))}
            <TouchableOpacity style={styles.onboardBtn} onPress={() => setOnboard(false)} activeOpacity={0.85}><Text style={styles.onboardBtnTxt}>開始使用</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* 使用說明 */}
      <Modal visible={guide} transparent animationType="fade" onRequestClose={() => setGuide(false)}>
        <View style={styles.centerBackdrop}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setGuide(false)} />
          <View style={styles.onboardCard}>
            <View style={styles.guideHead}>
              <Text style={styles.guideTitle}>使用說明</Text>
              <TouchableOpacity onPress={() => setGuide(false)} hitSlop={10}><Ionicons name="close" size={24} color={C.muted} /></TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} style={{ alignSelf: 'stretch', maxHeight: 430 }}>
              {[
                ['add-circle-outline', '新增商品', '在搜尋列打上商品名稱，按「＋」或 Enter 加入清單。'],
                ['camera-outline', 'AI 產品辨識', '點右上相機鈕拍商品照，自動辨識品名並查價；AI 沒把握時會請你確認，不會亂給。'],
                ['search-outline', '查價・比價', '每筆按「查價」會列出當地多筆候選（圖＋當地價＋台幣），點「選」鎖定最吻合的。'],
                ['swap-horizontal-outline', '更換・重搜', '價格旁的 ⇄ 可重開候選清單更換；找不到可改關鍵字重搜，或開官網看全部。'],
                ['flag-outline', '切換國家', '頂部可切日本／韓國，每筆商品也能單獨切換國家。'],
                ['create-outline', '自填價格', '沒查到也沒關係，點價格或「自填價格」手動輸入當地售價。'],
                ['wallet-outline', '記帳', '買到的按「買到了」移到記帳頁，依店家分組並顯示免稅門檻進度。'],
                ['cash-outline', '預算與結算', '在記帳頁設整趟預算，用綠／橘／紅進度條提醒；結束旅程可一鍵結算。'],
                ['calculator-outline', '匯率計算機', '右上計算機可快速換算當地幣與台幣。'],
              ].map(([ic, t, d]) => (
                <View key={t} style={styles.onboardRow}>
                  <View style={styles.onboardIcon}><Ionicons name={ic} size={18} color={C.rose} /></View>
                  <View style={{ flex: 1 }}><Text style={styles.onboardRowT}>{t}</Text><Text style={styles.onboardRowD}>{d}</Text></View>
                </View>
              ))}
              <Text style={styles.guideFoot}>免稅門檻（同店合計）：日本未稅 ¥5,000、韓國 ₩15,000 達標可退稅，金額僅供參考。價格與資訊由 AI 與公開資料提供，僅供參考、不作為購物建議。</Text>
            </ScrollView>
            <TouchableOpacity style={styles.onboardBtn} onPress={() => setGuide(false)} activeOpacity={0.85}><Text style={styles.onboardBtnTxt}>知道了</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
    </GestureHandlerRootView>
  );
}

const C = { bg: '#F6F0EA', surface: '#FFFFFF', ink: '#2E2420', inkSoft: '#7A6E66', muted: '#A89C92', rose: '#E0567C', roseDeep: '#C53E63', roseSoft: '#FCE7EE', gold: '#BE8A3C', green: '#3F9E6E', line: '#ECE1D8' };

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg, paddingTop: Platform.OS === 'android' ? 28 : 0 },
  hero: { backgroundColor: C.rose, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 18, borderBottomLeftRadius: 24, borderBottomRightRadius: 24, overflow: 'hidden' },
  heroBlob: { position: 'absolute', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.10)' },
  heroBlob1: { width: 170, height: 170, top: -66, right: -36 },
  heroBlob2: { width: 110, height: 110, bottom: -46, left: -28, backgroundColor: 'rgba(255,255,255,0.07)' },
  heroTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  heroBrand: { color: '#fff', fontSize: 19, fontWeight: '900', letterSpacing: 1.5 },
  calcBtn: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  scanBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 40, paddingHorizontal: 13, borderRadius: 12, backgroundColor: '#fff' },
  scanBtnTxt: { color: C.roseDeep, fontSize: 13.5, fontWeight: '800' },
  heroSeg: { flexDirection: 'row', alignItems: 'center', marginTop: 14, gap: 8 },
  heroSegBtn: { paddingHorizontal: 13, paddingVertical: 7, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.16)' },
  heroSegOn: { backgroundColor: '#fff' },
  heroSegTxt: { color: 'rgba(255,255,255,0.92)', fontSize: 13, fontWeight: '800' },
  heroSegTxtOn: { color: C.roseDeep },
  heroRate: { color: 'rgba(255,255,255,0.85)', fontSize: 11, fontFamily: MONO, marginLeft: 'auto' },
  heroLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '700', letterSpacing: 2, marginTop: 16 },
  heroTotal: { color: '#fff', fontSize: 38, fontWeight: '900', fontFamily: MONO, marginTop: 2 },
  heroSub: { color: 'rgba(255,255,255,0.9)', fontSize: 13, marginTop: 3, fontWeight: '600' },

  tabs: { flexDirection: 'row', marginHorizontal: 18, marginTop: 14, backgroundColor: C.surface, borderRadius: 14, padding: 4, borderWidth: 1.5, borderColor: C.line },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 9, borderRadius: 10 },
  tabOn: { backgroundColor: C.roseSoft },
  tabTxt: { color: C.muted, fontSize: 14, fontWeight: '800' },
  tabTxtOn: { color: C.roseDeep },

  addBar: { flexDirection: 'row', paddingHorizontal: 18, gap: 10, marginTop: 14 },
  addInputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.surface, borderRadius: 14, paddingHorizontal: 14, borderWidth: 1.5, borderColor: C.line },
  addInputWrapFocus: { borderColor: C.rose, shadowColor: C.rose, shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } },
  addInput: { flex: 1, paddingVertical: 13, color: C.ink, fontSize: 15, ...NO_OUTLINE },
  addBtn: { width: 52, backgroundColor: C.rose, borderRadius: 14, alignItems: 'center', justifyContent: 'center', shadowColor: C.rose, shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 5 } },
  toolRow: { flexDirection: 'row', gap: 9, paddingHorizontal: 18, marginTop: 12 },
  toolChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8 },
  toolChipPrimary: { backgroundColor: C.rose, borderColor: C.rose, marginLeft: 'auto' },
  toolChipTxt: { color: C.inkSoft, fontSize: 12.5, fontWeight: '700' },

  suggestBox: { marginHorizontal: 18, marginTop: 8, backgroundColor: C.surface, borderRadius: 14, borderWidth: 1.5, borderColor: C.roseSoft, overflow: 'hidden', shadowColor: '#7a5a44', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  suggestRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11 },
  suggestDivider: { borderTopWidth: 1, borderTopColor: C.line },
  suggestEmoji: { fontSize: 17 },
  suggestZh: { color: C.ink, fontSize: 14.5, fontWeight: '700' },
  suggestTerm: { color: C.muted, fontSize: 12, flex: 1, fontFamily: MONO },

  popCat: { color: C.inkSoft, fontSize: 13, fontWeight: '800', marginBottom: 9 },
  brandGroup: { marginBottom: 10, paddingLeft: 4, borderLeftWidth: 2, borderLeftColor: C.roseSoft },
  brandHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, marginLeft: 4 },
  brandName: { color: C.roseDeep, fontSize: 12.5, fontWeight: '900' },
  brandMore: { color: C.muted, fontSize: 11.5, fontWeight: '700' },
  popWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 11, marginBottom: 8 },
  popCard: { width: 96 },
  popThumb: { width: 96, height: 96, borderRadius: 14, backgroundColor: C.bg },
  popThumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  popCardTxt: { color: C.ink, fontSize: 11.5, fontWeight: '600', lineHeight: 15, marginTop: 5 },
  popChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.roseSoft, borderRadius: 999, paddingLeft: 13, paddingRight: 9, paddingVertical: 9 },
  popChipTxt: { color: C.roseDeep, fontSize: 13.5, fontWeight: '700' },
  popHint: { color: C.muted, fontSize: 12, textAlign: 'center', marginTop: 2, marginBottom: 6 },

  list: { flex: 1, paddingHorizontal: 18, marginTop: 14 },
  emptyWrap: { alignItems: 'center', marginTop: 46 },
  emptyIcon: { width: 82, height: 82, borderRadius: 26, backgroundColor: C.roseSoft, alignItems: 'center', justifyContent: 'center' },
  emptyBig: { color: C.ink, fontSize: 20, fontWeight: '800', letterSpacing: 1, marginTop: 14 },
  empty: { color: C.muted, textAlign: 'center', marginTop: 8, fontSize: 13.5, lineHeight: 23 },

  card: { backgroundColor: C.surface, borderRadius: 20, padding: 15, borderWidth: 1, borderColor: C.line, shadowColor: '#7a5a44', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  name: { flex: 1, color: C.ink, fontSize: 16.5, fontWeight: '800', lineHeight: 22 },
  body: { flexDirection: 'row', gap: 13, marginTop: 12 },
  imgWrap: { width: 90, height: 90, borderRadius: 16, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  img: { width: 90, height: 90 },
  imgEmpty: { alignItems: 'center', gap: 2 },
  imgEmptyTxt: { fontSize: 11, color: C.muted, fontWeight: '700' },
  bodyRight: { flex: 1, justifyContent: 'space-between' },
  note: { backgroundColor: C.bg, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 9, fontSize: 13.5, color: C.ink, ...NO_OUTLINE },
  bodyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  miniSeg: { flexDirection: 'row', backgroundColor: C.bg, borderRadius: 9, padding: 3 },
  miniSegBtn: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 6 },
  miniSegOn: { backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.rose },
  miniSegTxt: { fontSize: 14, opacity: 0.4 },
  miniSegTxtOn: { opacity: 1 },
  qty: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qtyBtn: { width: 32, height: 32, borderRadius: 9, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  qtyNum: { color: C.ink, fontSize: 15, fontWeight: '800', minWidth: 20, textAlign: 'center', fontFamily: MONO },
  priceRow: { flexDirection: 'row', alignItems: 'center', marginTop: 13, gap: 10 },
  priceTag: { backgroundColor: C.rose, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'baseline' },
  priceTagCur: { color: 'rgba(255,255,255,0.9)', fontSize: 11, fontWeight: '800', fontFamily: MONO },
  priceTagNum: { color: '#fff', fontSize: 18, fontWeight: '900', fontFamily: MONO, marginLeft: 1 },
  priceMid: { flex: 1 },
  localPrice: { color: C.inkSoft, fontSize: 13, fontWeight: '700', fontFamily: MONO },
  actualTxt: { color: C.roseDeep, fontSize: 12.5, fontWeight: '800', marginTop: 2 },
  pickedTitle: { color: C.muted, fontSize: 11, marginTop: 2 },
  loadingTxt: { color: C.muted, fontSize: 14, marginLeft: 9, fontWeight: '600' },
  noPrice: { color: '#c2b4a8', fontSize: 13.5 },
  errTxt: { color: C.roseDeep, fontSize: 13, fontWeight: '600' },
  errRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  errLink: { color: C.gold, fontSize: 13, fontWeight: '800' },
  flex1: { flex: 1 },
  changeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.roseSoft, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
  changeBtnTxt: { color: C.roseDeep, fontWeight: '800', fontSize: 13 },
  queryBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.rose, borderRadius: 11, paddingHorizontal: 18, paddingVertical: 10 },
  queryBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 14, letterSpacing: 1 },
  linkRow: { flexDirection: 'row', gap: 16, marginTop: 9, paddingLeft: 2 },
  linkTxt: { color: C.inkSoft, fontSize: 12, fontWeight: '700' },
  doneBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 11 },
  priceRowTight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  priceBlock: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  refLine: { color: C.muted, fontSize: 11.5 },
  refLineTwd: { color: C.inkSoft, fontWeight: '800', fontFamily: MONO },
  refLineLocal: { color: C.muted, fontSize: 11, fontFamily: MONO },
  actualLine: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  actualLineOn: { color: C.roseDeep, fontSize: 15, fontWeight: '900', fontFamily: MONO },
  actualLineLocal: { color: C.rose, fontSize: 11, fontWeight: '700', fontFamily: MONO },
  actualLineFill: { color: C.roseDeep, fontSize: 13.5, fontWeight: '800' },
  moreBox: { marginTop: 12, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 11, gap: 4 },
  cardFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 10 },
  moreToggle: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  moreTxt: { color: C.muted, fontSize: 12.5, fontWeight: '700' },
  doneBtn2: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.green, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 9, shadowColor: C.green, shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  swipeDelete: { backgroundColor: '#E04848', justifyContent: 'center', alignItems: 'center', width: 84, marginBottom: 12, borderRadius: 20, gap: 3 },
  swipeDone: { backgroundColor: C.green, justifyContent: 'center', alignItems: 'center', width: 84, marginBottom: 12, borderRadius: 20, gap: 3 },
  swipeTxt: { color: '#fff', fontWeight: '800', fontSize: 12 },
  doneBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 13.5 },

  // 預算
  budgetSet: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.line, borderStyle: 'dashed', borderRadius: 16, paddingVertical: 14, marginBottom: 13 },
  addBoughtBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.line, borderStyle: 'dashed', borderRadius: 16, paddingVertical: 13, marginBottom: 13 },
  addBoughtTxt: { color: C.roseDeep, fontWeight: '800', fontSize: 14.5 },
  budgetSetTxt: { color: C.rose, fontWeight: '800', fontSize: 14 },
  budgetCard: { backgroundColor: C.surface, borderRadius: 18, padding: 15, marginBottom: 13, borderWidth: 1, borderColor: C.line },
  budgetTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  budgetLabel: { color: C.ink, fontSize: 14, fontWeight: '800' },
  budgetLeft: { fontSize: 13, fontWeight: '800', fontFamily: MONO },
  budgetTrack: { height: 12, borderRadius: 999, backgroundColor: C.bg, marginTop: 10, overflow: 'hidden' },
  budgetFill: { height: 12, borderRadius: 999 },
  budgetSpent: { color: C.inkSoft, fontSize: 12.5, marginTop: 8, fontWeight: '600' },

  // 記帳
  storeGroup: { backgroundColor: C.surface, borderRadius: 18, padding: 14, marginBottom: 13, borderWidth: 1, borderColor: C.line },
  storeHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  storeNameBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  storeName: { color: C.ink, fontSize: 15, fontWeight: '800' },
  storeTwd: { color: C.rose, fontSize: 16, fontWeight: '900', fontFamily: MONO },
  taxBar: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FBF3E4', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7, marginTop: 9 },
  taxBarOk: { backgroundColor: '#E9F5EE' },
  taxTxt: { color: C.gold, fontSize: 12, fontWeight: '700', flex: 1 },
  ledgerItem: { flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 11 },
  ledgerImg: { width: 44, height: 44, borderRadius: 10, backgroundColor: C.bg },
  ledgerName: { color: C.ink, fontSize: 14, fontWeight: '700' },
  ledgerPriceRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  ledgerLocal: { color: C.inkSoft, fontSize: 13, fontFamily: MONO, fontWeight: '700' },
  ledgerInput: { minWidth: 56, backgroundColor: C.bg, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 4, fontSize: 14, color: C.ink, fontFamily: MONO, fontWeight: '700', ...NO_OUTLINE },
  ledgerTwd: { color: C.muted, fontSize: 12, fontFamily: MONO },
  ledgerNoteRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  ledgerNote: { flex: 1, fontSize: 12.5, color: C.inkSoft, paddingVertical: 2, ...NO_OUTLINE },

  scanOverlay: { position: 'absolute', inset: 0, backgroundColor: 'rgba(46,36,32,0.6)', alignItems: 'center', justifyContent: 'center', gap: 12 },
  scanTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },
  scanPreview: { width: '100%', height: 190, borderRadius: 14, marginTop: 12, backgroundColor: C.bg },
  scanLabel: { color: C.muted, fontSize: 12, fontWeight: '700', marginTop: 12 },
  scanInfoBox: { flexDirection: 'row', gap: 6, backgroundColor: '#FBF3E4', borderRadius: 11, padding: 11, marginTop: 10, alignItems: 'flex-start' },
  scanInfo: { flex: 1, color: C.inkSoft, fontSize: 13, lineHeight: 19 },
  claimBox: { marginTop: 14, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.line },
  claimLabel: { color: C.rose, fontSize: 12.5, fontWeight: '800', marginBottom: 5 },
  claimTxt: { color: C.inkSoft, fontSize: 13, lineHeight: 19 },
  claimNote: { color: C.muted, fontSize: 11, marginTop: 6, fontStyle: 'italic' },
  scanReviewBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12, paddingVertical: 10, borderRadius: 11, backgroundColor: C.bg },
  scanReviewTxt: { color: C.inkSoft, fontWeight: '700', fontSize: 13 },
  scanDisclaim: { color: C.muted, fontSize: 10.5, textAlign: 'center', marginTop: 6 },
  popInfoEmoji: { fontSize: 34, textAlign: 'center' },
  popInfoImg: { width: '100%', height: 150, borderRadius: 14, backgroundColor: C.bg },
  popInfoName: { fontSize: 18, fontWeight: '900', color: C.ink, textAlign: 'center', marginTop: 6 },
  popInfoHint: { color: C.muted, fontSize: 12, textAlign: 'center', marginTop: 10 },
  scanAskHint: { color: C.muted, fontSize: 12, lineHeight: 17, marginTop: 8 },
  aiTipEmoji: { fontSize: 36, textAlign: 'center', marginBottom: 4 },
  aiTipTitle: { fontSize: 18, fontWeight: '900', color: C.ink, textAlign: 'center', marginBottom: 8 },
  aiTipBody: { color: C.inkSoft, fontSize: 14, lineHeight: 21, textAlign: 'center' },

  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(46,36,32,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 20, paddingBottom: 30 },
  grip: { width: 42, height: 4, borderRadius: 2, backgroundColor: C.line, alignSelf: 'center', marginBottom: 14 },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, gap: 12 },
  sheetKicker: { color: C.rose, fontSize: 11.5, fontWeight: '800' },
  sheetTitle: { fontSize: 19, fontWeight: '900', color: C.ink, marginTop: 3 },
  repickRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.bg, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6, marginBottom: 12 },
  repickInput: { flex: 1, paddingVertical: 7, fontSize: 14, color: C.ink, ...NO_OUTLINE },
  repickBtn: { backgroundColor: C.rose, borderRadius: 9, paddingHorizontal: 14, paddingVertical: 7 },
  repickBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 13 },
  cand: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: C.line },
  candImg: { width: 56, height: 56, borderRadius: 12, backgroundColor: C.bg },
  candTitle: { color: C.ink, fontSize: 14, fontWeight: '600', lineHeight: 19 },
  candTrans: { color: C.roseDeep, fontSize: 12, marginTop: 2 },
  candTransLoading: { color: C.muted, fontSize: 11.5, marginTop: 2, fontStyle: 'italic' },
  candPrice: { color: C.inkSoft, fontSize: 14, fontWeight: '700', marginTop: 4, fontFamily: MONO },
  candTwd: { color: C.rose, fontSize: 14, fontWeight: '800', fontFamily: MONO },
  candPick: { backgroundColor: C.roseSoft, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  candPickTxt: { color: C.roseDeep, fontWeight: '800', fontSize: 13 },
  seeAllBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 14, paddingVertical: 12, borderRadius: 12, backgroundColor: C.bg },
  seeAllTxt: { color: C.inkSoft, fontWeight: '700', fontSize: 13.5 },
  pickerNone: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#FBF3E4', borderRadius: 12, paddingVertical: 12, marginBottom: 12 },
  pickerNoneTxt: { color: C.roseDeep, fontWeight: '800', fontSize: 13.5 },
  noneBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 8, paddingVertical: 11 },
  noneTxt: { color: C.muted, fontWeight: '700', fontSize: 13 },

  // 靠上對齊：iOS PWA 鍵盤升起不會推畫面，置中/靠底的輸入框會被鍵盤蓋住，改靠上方就不會被遮
  centerBackdrop: { flex: 1, backgroundColor: 'rgba(46,36,32,0.55)', alignItems: 'center', justifyContent: 'flex-start', paddingHorizontal: 26, paddingTop: 56 },
  storeModal: { backgroundColor: C.surface, borderRadius: 20, padding: 20, width: '100%' },
  storeInput: { backgroundColor: C.bg, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: C.ink, marginTop: 12, ...NO_OUTLINE },
  storeChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  storeChip: { backgroundColor: C.roseSoft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  storeChipTxt: { color: C.roseDeep, fontSize: 13, fontWeight: '700' },
  storeSave: { backgroundColor: C.rose, borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 16 },
  storeSaveTxt: { color: '#fff', fontWeight: '800', fontSize: 15, letterSpacing: 1 },

  zoomBackdrop: { flex: 1, backgroundColor: 'rgba(28,22,18,0.95)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  zoomImg: { width: '100%', height: '78%' },
  zoomBar: { position: 'absolute', bottom: 36, left: 20, right: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  zoomReplace: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.6)', borderRadius: 11, paddingHorizontal: 16, paddingVertical: 10 },
  zoomReplaceTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },
  zoomClose: { backgroundColor: C.rose, borderRadius: 11, paddingHorizontal: 20, paddingVertical: 10 },
  zoomCloseTxt: { color: '#fff', fontWeight: '800', fontSize: 14, letterSpacing: 1 },

  calcRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  calcSeg: { flex: 1, flexDirection: 'row', backgroundColor: C.bg, borderRadius: 12, padding: 4 },
  calcSegBtn: { flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center' },
  calcSegOn: { backgroundColor: C.rose },
  calcSegTxt: { color: C.inkSoft, fontSize: 14, fontWeight: '800' },
  calcSegTxtOn: { color: '#fff' },
  swapBtn: { width: 46, height: 46, borderRadius: 13, backgroundColor: C.roseSoft, alignItems: 'center', justifyContent: 'center' },
  calcDirTxt: { color: C.muted, fontSize: 12, marginTop: 12, fontWeight: '700' },
  calcInput: { backgroundColor: C.bg, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, fontSize: 26, fontWeight: '800', color: C.ink, fontFamily: MONO, marginTop: 6, ...NO_OUTLINE },
  calcResult: { backgroundColor: C.roseSoft, borderRadius: 14, padding: 16, marginTop: 12 },
  calcResultLabel: { color: C.roseDeep, fontSize: 12, fontWeight: '700' },
  calcResultNum: { color: C.roseDeep, fontSize: 30, fontWeight: '900', fontFamily: MONO, marginTop: 2 },
  calcRate: { color: C.muted, fontSize: 11, marginTop: 12, fontFamily: MONO, textAlign: 'center' },

  toastWrap: { position: 'absolute', left: 0, right: 0, bottom: 28, alignItems: 'center' },
  toast: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#2E2420', borderRadius: 14, paddingHorizontal: 18, paddingVertical: 12, maxWidth: '90%', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  toastTxt: { color: '#fff', fontSize: 14, fontWeight: '600', flexShrink: 1 },
  toastUndo: { color: '#FFADC8', fontSize: 14, fontWeight: '900' },

  onboardCard: { backgroundColor: C.surface, borderRadius: 22, padding: 24, width: '100%', maxWidth: 360, alignItems: 'center' },
  onboardEmoji: { fontSize: 40 },
  onboardTitle: { fontSize: 20, fontWeight: '900', color: C.ink, marginTop: 8, marginBottom: 14, letterSpacing: 0.5 },
  onboardRow: { flexDirection: 'row', alignItems: 'center', gap: 12, alignSelf: 'stretch', marginBottom: 12 },
  onboardIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: C.roseSoft, alignItems: 'center', justifyContent: 'center' },
  onboardRowT: { color: C.ink, fontSize: 14.5, fontWeight: '800' },
  onboardRowD: { color: C.muted, fontSize: 12.5, marginTop: 1 },
  onboardBtn: { backgroundColor: C.rose, borderRadius: 14, paddingVertical: 13, alignSelf: 'stretch', alignItems: 'center', marginTop: 8 },
  guideHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch', marginBottom: 12 },
  guideTitle: { fontSize: 20, fontWeight: '900', color: C.ink, letterSpacing: 0.5 },
  guideFoot: { color: C.muted, fontSize: 11.5, lineHeight: 18, marginTop: 6, marginBottom: 2 },
  guideLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 16, marginTop: 4 },
  guideLinkTxt: { color: C.muted, fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' },
  onboardBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 16, letterSpacing: 1 },

  endTripBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.rose, borderRadius: 14, paddingVertical: 14, marginTop: 4, marginBottom: 8 },
  endTripTxt: { color: C.roseDeep, fontWeight: '800', fontSize: 14.5 },
  endEmoji: { fontSize: 46 },
  endTitle: { fontSize: 21, fontWeight: '900', color: C.ink, marginTop: 8, textAlign: 'center', letterSpacing: 0.5 },
  endBigLabel: { color: C.muted, fontSize: 12, fontWeight: '700', letterSpacing: 1, marginTop: 16 },
  endBig: { fontSize: 38, fontWeight: '900', fontFamily: MONO, marginTop: 2 },
  endSub: { color: C.inkSoft, fontSize: 13, fontWeight: '600', marginTop: 2 },
  endStatRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 22, marginTop: 16 },
  endStat: { alignItems: 'center' },
  endStatNum: { color: C.ink, fontSize: 22, fontWeight: '900', fontFamily: MONO },
  endStatLbl: { color: C.muted, fontSize: 11.5, fontWeight: '700', marginTop: 1 },
  endStatDiv: { width: 1, height: 30, backgroundColor: C.line },
  endLine: { color: C.inkSoft, fontSize: 14, textAlign: 'center', lineHeight: 21, marginTop: 16, marginBottom: 8 },
  endBack: { color: C.muted, fontSize: 14, fontWeight: '700', textAlign: 'center' },
});
