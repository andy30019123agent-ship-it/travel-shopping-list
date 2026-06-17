import { useEffect, useMemo, useRef, useState } from 'react';
import {
  SafeAreaView, View, Text, TextInput, TouchableOpacity, Image, Modal,
  ScrollView, StyleSheet, StatusBar, Platform, ActivityIndicator, Animated, Linking,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { useFonts } from 'expo-font';

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
const MONO = Platform.select({ web: 'ui-monospace, SFMono-Regular, Menlo, monospace', ios: 'Menlo', android: 'monospace', default: 'monospace' });

function dedupeBy(arr, keyFn) {
  const seen = new Set(); const out = [];
  for (const x of arr) { const k = keyFn(x); if (!seen.has(k)) { seen.add(k); out.push(x); } }
  return out;
}

// 樂天市場商品搜尋（單一賣場的商品列表）
async function rakutenSearch(term) {
  const url = `https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260401` +
    `?applicationId=${RAKUTEN_APP_ID}&accessKey=${RAKUTEN_ACCESS_KEY}&keyword=${enc(term)}&hits=20&format=json`;
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
async function rakutenProductSearch(term) {
  const url = `https://openapi.rakuten.co.jp/ichibaproduct/api/Product/Search/20250801` +
    `?applicationId=${RAKUTEN_APP_ID}&accessKey=${RAKUTEN_ACCESS_KEY}&keyword=${enc(term)}&hits=20&format=json`;
  const rk = await fetch(url);
  if (!rk.ok) throw new Error(`樂天比價失敗 (${rk.status})`);
  const rj = await rk.json();
  const out = [];
  for (const x of (rj.Products || [])) {
    const p = x.Product || x;
    const price = p.averagePrice || p.minPrice;
    if (!p.productName || !price) continue;
    out.push({ title: p.productName, price: Math.round(price), priceMin: p.minPrice, priceMax: p.maxPrice, image: p.mediumImageUrl || p.smallImageUrl || '', url: p.productUrlPC || '' });
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
    cands = cands.slice(0, 10);
  }
  cands = cands.map(c => ({ ...c, twd: Math.round(c.price * rate) }));
  return { term, currency, candidates: cands, resolved: data.resolved || '', resolvedImage: data.resolvedImage || '', resolvedPrice: data.resolvedPrice || 0, rate };
}

function AnimatedCard({ children, style }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => { Animated.timing(a, { toValue: 1, duration: 240, useNativeDriver: true }).start(); }, []);
  return <Animated.View style={[style, { opacity: a, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }]}>{children}</Animated.View>;
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
  const [scanning, setScanning] = useState(false);
  const [rates, setRates] = useState({ jpy: 0.197, krw: 0.021 });
  useFonts(Ionicons.font);

  useEffect(() => {
    AsyncStorage.getItem(STORE_KEY).then(r => { if (r) setItems(JSON.parse(r)); setLoaded(true); });
    AsyncStorage.getItem(SETTINGS_KEY).then(r => { if (r) { const s = JSON.parse(r); if (s.country) setCountry(s.country); if (s.sort) setSort(s.sort); if (s.stores) setStores(s.stores); if (s.budget) setBudget(s.budget); } });
    fetch(`${WORKER_URL}/rate`).then(r => r.json()).then(d => { if (d.ok) setRates({ jpy: d.jpy, krw: d.krw }); }).catch(() => {});
  }, []);
  useEffect(() => { if (loaded) AsyncStorage.setItem(STORE_KEY, JSON.stringify(items)); }, [items, loaded]);
  useEffect(() => { AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({ country, sort, stores, budget })); }, [country, sort, stores, budget]);

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
    return it;
  };

  async function queryOne(item) {
    setBusy(b => ({ ...b, [item.id]: true }));
    try {
      const { term, currency, candidates, resolvedImage, resolvedPrice, rate } = await fetchCandidates(item);
      const patch = { term, currency, candidates };
      if (resolvedImage && !item.imageManual) patch.image = resolvedImage; // 貼當地頁→直接用該頁照片
      if (resolvedPrice > 0) { // 貼當地頁有價→直接用
        patch.noResult = false;
        patch.price = { price: resolvedPrice, twd: Math.round(resolvedPrice * rate), currency, title: item.name };
      } else if (!candidates.length) { patch.noResult = true; patch.price = null; }
      else {
        patch.noResult = false;
        const c = candidates[0];
        patch.price = { price: c.price, twd: c.twd, currency, title: c.title, url: c.url };
        if (c.image && !item.imageManual && !resolvedImage) patch.image = c.image;
      }
      update(item.id, patch);
    } catch (e) {
      setBusy(b => ({ ...b, [item.id]: 'err' })); setTimeout(() => setBusy(b => ({ ...b, [item.id]: false })), 2500); return;
    }
    setBusy(b => ({ ...b, [item.id]: false }));
  }
  async function queryAll() {
    const todo = items.filter(it => it.status === 'todo' && !it.price);
    for (const it of todo) { await queryOne(it); }
  }
  function openPicker(item) {
    if (item.candidates && item.candidates.length) setPicker({ itemId: item.id, currency: item.currency, candidates: item.candidates, name: item.name, term: item.term || '' });
    else queryOne(item);
  }
  function choosePick(c) {
    const { itemId, currency } = picker;
    setItems(prev => prev.map(it => it.id === itemId ? { ...it, price: { price: c.price, twd: c.twd, currency, title: c.title, url: c.url }, image: it.imageManual ? it.image : (c.image || it.image), noResult: false } : it));
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
      const r = await fetch(`${WORKER_URL}/vision`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: b64, country }) });
      const d = await r.json();
      setScanning(false);
      if (d.ok && d.name) { const it = addItem(d.name); if (it) { update(it.id, { image: a.uri, imageManual: true }); queryOne({ ...it, name: d.name }); } }
      else alert('認不出商品，請改用文字輸入');
    } catch (e) { setScanning(false); }
  }

  function switchCountry(c) {
    if (c === country) return;
    setCountry(c);
    const updated = items.map(it => it.status === 'todo' ? { ...it, country: c, term: '', price: null, candidates: null, noResult: false, image: it.imageManual ? it.image : '' } : it);
    setItems(updated);
  }
  function completeItem(item) { update(item.id, { status: 'bought', store: item.store || '', boughtLocal: item.price ? item.price.price : 0 }); }
  function unbuy(item) { update(item.id, { status: 'todo' }); }

  const todoItems = useMemo(() => {
    const sorter = { added: (a, b) => (a.id < b.id ? 1 : -1), priceHigh: (a, b) => (b.price?.twd || 0) * b.qty - (a.price?.twd || 0) * a.qty, priceLow: (a, b) => ((a.price?.twd || 1e12) * a.qty) - ((b.price?.twd || 1e12) * b.qty) }[sort];
    return items.filter(i => i.status === 'todo').sort(sorter);
  }, [items, sort]);
  const boughtItems = useMemo(() => items.filter(i => i.status === 'bought'), [items]);

  const todoTotal = useMemo(() => todoItems.reduce((s, it) => s + (it.price ? it.price.twd * it.qty : 0), 0), [todoItems]);
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

  const SORT_LABEL = { added: '加入順序', priceHigh: '價格高→低', priceLow: '價格低→高' };
  const cycleSort = () => setSort(s => (s === 'added' ? 'priceHigh' : s === 'priceHigh' ? 'priceLow' : 'added'));

  // ---- 待買卡片 ----
  const renderTodo = it => {
    const state = busy[it.id];
    return (
      <AnimatedCard key={it.id} style={styles.card}>
        <View style={styles.rowTop}>
          <Text style={styles.name} numberOfLines={2}>{it.name}</Text>
          <TouchableOpacity onPress={() => remove(it.id)} hitSlop={10} accessibilityLabel="刪除"><Ionicons name="close" size={20} color="#cbbdb2" /></TouchableOpacity>
        </View>
        <View style={styles.body}>
          <TouchableOpacity style={styles.imgWrap} onPress={() => it.image ? setZoom({ url: it.image, itemId: it.id }) : pickImage(it.id)} activeOpacity={0.85} accessibilityLabel="商品圖片">
            {it.image ? <Image source={{ uri: it.image }} style={styles.img} /> : <View style={styles.imgEmpty}><Ionicons name="camera-outline" size={22} color={C.muted} /><Text style={styles.imgEmptyTxt}>加圖</Text></View>}
          </TouchableOpacity>
          <View style={styles.bodyRight}>
            <TextInput style={styles.note} placeholder="備註：給媽媽 / 無香料…" placeholderTextColor="#c3b6ab" value={it.note} onChangeText={t => update(it.id, { note: t })} />
            <View style={styles.bodyRow}>
              <View style={styles.miniSeg}>
                {['jp', 'kr'].map(c => (
                  <TouchableOpacity key={c} style={[styles.miniSegBtn, it.country === c && styles.miniSegOn]} onPress={() => { if (it.country !== c) { update(it.id, { country: c, term: '', price: null, candidates: null, noResult: false, image: it.imageManual ? it.image : '' }); } }} accessibilityLabel={CO[c].label}><Text style={[styles.miniSegTxt, it.country === c && styles.miniSegTxtOn]}>{CO[c].flag}</Text></TouchableOpacity>
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

        {state === true ? (
          <View style={styles.priceRow}><ActivityIndicator size="small" color={C.rose} /><Text style={styles.loadingTxt}>查價中…</Text></View>
        ) : it.price ? (
          <>
          <View style={styles.priceRow}>
            <TouchableOpacity onPress={() => setPriceEdit({ id: it.id, val: String(it.price.price), currency: it.price.currency })} activeOpacity={0.7} accessibilityLabel="編輯價格"><PriceTag twd={it.price.twd * it.qty} /></TouchableOpacity>
            <View style={styles.priceMid}>
              <Text style={styles.localPrice}>{it.price.currency}{fmt(it.price.price)}{it.qty > 1 ? ` ×${it.qty}` : ''}</Text>
              <Text style={styles.pickedTitle} numberOfLines={1}>{it.price.title}</Text>
            </View>
            <TouchableOpacity style={styles.changeBtn} onPress={() => openPicker(it)} activeOpacity={0.8}><Ionicons name="swap-horizontal" size={14} color={C.roseDeep} /><Text style={styles.changeBtnTxt}>換</Text></TouchableOpacity>
          </View>
          <View style={styles.linkRow}>
            <TouchableOpacity onPress={() => setPriceEdit({ id: it.id, val: String(it.price.price), currency: it.price.currency })}><Text style={styles.linkTxt}>✏️ 自填價格</Text></TouchableOpacity>
            {it.price.url ? <TouchableOpacity onPress={() => openUrl(it.price.url)}><Text style={styles.linkTxt}>🔗 來源頁</Text></TouchableOpacity> : null}
            {brandSite(it.name, it.country) ? <TouchableOpacity onPress={() => openUrl(brandSite(it.name, it.country))}><Text style={styles.linkTxt}>🏷️ 官網</Text></TouchableOpacity> : null}
          </View>
          </>
        ) : (
          <View style={styles.priceRow}>
            <Text style={[styles.flex1, state === 'err' || it.noResult ? styles.errTxt : styles.noPrice]}>{state === 'err' ? '連線出錯，再試一次' : it.noResult ? '查無結果，點換一個改關鍵字' : '尚未查價'}</Text>
            <TouchableOpacity style={styles.changeBtn} onPress={() => setPriceEdit({ id: it.id, val: '', currency: CO[it.country].cur })} activeOpacity={0.8}><Text style={styles.changeBtnTxt}>自填</Text></TouchableOpacity>
            <TouchableOpacity style={styles.queryBtn} onPress={() => queryOne(it)} activeOpacity={0.85}><Ionicons name="search" size={15} color="#fff" /><Text style={styles.queryBtnTxt}>查價</Text></TouchableOpacity>
          </View>
        )}

        <TouchableOpacity style={styles.doneBtn} onPress={() => completeItem(it)} activeOpacity={0.85} accessibilityLabel="標記已買，移到記帳">
          <Ionicons name="checkmark-circle-outline" size={18} color={C.green} /><Text style={styles.doneBtnTxt}>已買，移到記帳</Text>
        </TouchableOpacity>
      </AnimatedCard>
    );
  };

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
        </View>
        <TouchableOpacity onPress={() => unbuy(it)} hitSlop={8} accessibilityLabel="移回待買" style={{ padding: 4 }}><Ionicons name="arrow-undo-outline" size={18} color={C.muted} /></TouchableOpacity>
        <TouchableOpacity onPress={() => remove(it.id)} hitSlop={8} accessibilityLabel="刪除" style={{ padding: 4 }}><Ionicons name="close" size={18} color="#cbbdb2" /></TouchableOpacity>
      </View>
    );
  };

  const calcResult = () => { if (!calc) return ''; const amt = parseFloat(calc.amt) || 0; const r = rateOf(calc.cur); return calc.dir === 'toTWD' ? amt * r : amt / r; };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />

      {/* HERO */}
      <View style={styles.hero}>
        <View style={[styles.heroBlob, styles.heroBlob1]} />
        <View style={[styles.heroBlob, styles.heroBlob2]} />
        <View style={styles.heroTop}>
          <Text style={styles.heroBrand}>免稅不是免費</Text>
          <TouchableOpacity style={styles.calcBtn} onPress={() => setCalc({ cur: country, dir: 'toTWD', amt: '' })} activeOpacity={0.8} accessibilityLabel="匯率計算機"><Ionicons name="calculator-outline" size={20} color="#fff" /></TouchableOpacity>
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
            <View style={styles.addInputWrap}>
              <Ionicons name="search" size={18} color={C.muted} />
              <TextInput style={styles.addInput} placeholder="商品名／綽號／貼網址" placeholderTextColor="#bca99c" value={input} onChangeText={setInput} onSubmitEditing={() => { const it = addItem(); if (it) queryOne(it); }} returnKeyType="search" />
              <TouchableOpacity onPress={() => scanImage(false)} hitSlop={8} accessibilityLabel="拍照或選圖搜尋"><Ionicons name="camera" size={20} color={C.rose} /></TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.addBtn} onPress={() => addItem()} activeOpacity={0.85} accessibilityLabel="加入清單"><Ionicons name="add" size={26} color="#fff" /></TouchableOpacity>
          </View>

          {todoItems.length > 0 && (
            <View style={styles.toolRow}>
              <TouchableOpacity style={styles.toolChip} onPress={cycleSort} activeOpacity={0.8}><Ionicons name="swap-vertical" size={14} color={C.inkSoft} /><Text style={styles.toolChipTxt}>{SORT_LABEL[sort]}</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.toolChip, styles.toolChipPrimary]} onPress={queryAll} activeOpacity={0.85}><Ionicons name="search" size={14} color="#fff" /><Text style={[styles.toolChipTxt, { color: '#fff' }]}>全部查價</Text></TouchableOpacity>
            </View>
          )}

          <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
            {todoItems.length === 0 && (
              <View style={styles.emptyWrap}><View style={styles.emptyIcon}><Ionicons name="bag-handle-outline" size={40} color={C.rose} /></View><Text style={styles.emptyBig}>還沒有東西</Text><Text style={styles.empty}>打商品名、綽號、貼網址，或按 📷 拍照{'\n'}加入後按「查價」就幫你查當地價＋換台幣</Text></View>
            )}
            {todoItems.map(renderTodo)}
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
          {boughtItems.length === 0 && (
            <View style={styles.emptyWrap}><View style={styles.emptyIcon}><Ionicons name="receipt-outline" size={38} color={C.rose} /></View><Text style={styles.emptyBig}>還沒有花費</Text><Text style={styles.empty}>在「待買清單」把買到的打「已買」{'\n'}就會移到這裡記帳、依店家算免稅門檻</Text></View>
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
        </ScrollView>
      )}

      {scanning && <View style={styles.scanOverlay}><ActivityIndicator size="large" color="#fff" /><Text style={styles.scanTxt}>辨識商品中…</Text></View>}

      {/* 候選選擇器（含改關鍵字） */}
      <Modal visible={!!picker} transparent animationType="slide" onRequestClose={() => setPicker(null)}>
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.grip} />
            <View style={styles.sheetHead}>
              <View style={{ flex: 1 }}><Text style={styles.sheetKicker} numberOfLines={1}>{picker?.name}</Text><Text style={styles.sheetTitle}>選一個正確的</Text></View>
              <TouchableOpacity onPress={() => setPicker(null)} hitSlop={10}><Ionicons name="close" size={24} color={C.muted} /></TouchableOpacity>
            </View>
            <View style={styles.repickRow}>
              <Ionicons name="search-outline" size={15} color={C.gold} />
              <TextInput style={styles.repickInput} value={picker?.term} placeholder="找不到？改關鍵字" placeholderTextColor="#cdbdb0" onChangeText={t => setPicker(p => ({ ...p, term: t }))} />
              <TouchableOpacity style={styles.repickBtn} onPress={repickWithTerm} activeOpacity={0.85}><Text style={styles.repickBtnTxt}>重搜</Text></TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator={false}>
              {picker?.candidates.map((c, i) => (
                <TouchableOpacity key={i} style={styles.cand} onPress={() => choosePick(c)} activeOpacity={0.7}>
                  {c.image ? <TouchableOpacity onPress={() => setZoom({ url: c.image })} activeOpacity={0.8}><Image source={{ uri: c.image }} style={styles.candImg} /></TouchableOpacity> : <View style={styles.candImg} />}
                  <View style={{ flex: 1 }}><Text style={styles.candTitle} numberOfLines={2}>{c.title}</Text><Text style={styles.candPrice}>{picker.currency}{fmt(c.price)}<Text style={styles.candTwd}>　NT${fmt(c.twd)}</Text></Text></View>
                  <View style={styles.candPick}><Text style={styles.candPickTxt}>選</Text></View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* 店家編輯 */}
      <Modal visible={!!storeEdit} transparent animationType="fade" onRequestClose={() => setStoreEdit(null)}>
        <TouchableOpacity style={styles.centerBackdrop} activeOpacity={1} onPress={() => setStoreEdit(null)}>
          <View style={styles.storeModal} onStartShouldSetResponder={() => true}>
            <Text style={styles.sheetTitle}>這批在哪家買？</Text>
            <TextInput style={styles.storeInput} value={storeEdit?.val} placeholder="店家名稱，例如 唐吉訶德 梅田店" placeholderTextColor="#cdbdb0" autoFocus onChangeText={t => setStoreEdit(s => ({ ...s, val: t }))} />
            {stores.length > 0 && (
              <View style={styles.storeChips}>{stores.map(s => <TouchableOpacity key={s} style={styles.storeChip} onPress={() => setStoreEdit(e => ({ ...e, val: s }))}><Text style={styles.storeChipTxt}>{s}</Text></TouchableOpacity>)}</View>
            )}
            <TouchableOpacity style={styles.storeSave} onPress={() => { const v = (storeEdit.val || '').trim(); setItems(prev => prev.map(it => storeEdit.ids.includes(it.id) ? { ...it, store: v } : it)); rememberStore(v); setStoreEdit(null); }} activeOpacity={0.85}><Text style={styles.storeSaveTxt}>儲存</Text></TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 預算設定 */}
      <Modal visible={!!budgetEdit} transparent animationType="fade" onRequestClose={() => setBudgetEdit(null)}>
        <TouchableOpacity style={styles.centerBackdrop} activeOpacity={1} onPress={() => setBudgetEdit(null)}>
          <View style={styles.storeModal} onStartShouldSetResponder={() => true}>
            <Text style={styles.sheetTitle}>本趟預算（台幣）</Text>
            <TextInput style={styles.storeInput} keyboardType="numeric" value={budgetEdit?.val} placeholder="例如 20000" placeholderTextColor="#cdbdb0" autoFocus onChangeText={t => setBudgetEdit(s => ({ ...s, val: t.replace(/[^0-9]/g, '') }))} />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              {budget > 0 && <TouchableOpacity style={[styles.storeSave, { flex: 0, paddingHorizontal: 16, backgroundColor: C.bg }]} onPress={() => { setBudget(0); setBudgetEdit(null); }}><Text style={[styles.storeSaveTxt, { color: C.inkSoft }]}>清除</Text></TouchableOpacity>}
              <TouchableOpacity style={[styles.storeSave, { flex: 1 }]} onPress={() => { setBudget(parseInt(budgetEdit.val) || 0); setBudgetEdit(null); }} activeOpacity={0.85}><Text style={styles.storeSaveTxt}>儲存</Text></TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 自填價格 */}
      <Modal visible={!!priceEdit} transparent animationType="fade" onRequestClose={() => setPriceEdit(null)}>
        <TouchableOpacity style={styles.centerBackdrop} activeOpacity={1} onPress={() => setPriceEdit(null)}>
          <View style={styles.storeModal} onStartShouldSetResponder={() => true}>
            <Text style={styles.sheetTitle}>自己輸入價格（{priceEdit?.currency}）</Text>
            <TextInput style={styles.storeInput} keyboardType="numeric" value={priceEdit?.val} placeholder="當地售價，例如 1280" placeholderTextColor="#cdbdb0" autoFocus onChangeText={t => setPriceEdit(s => ({ ...s, val: t.replace(/[^0-9.]/g, '') }))} />
            <TouchableOpacity style={[styles.storeSave, { marginTop: 16 }]} onPress={() => { const v = parseFloat(priceEdit.val) || 0; const id = priceEdit.id; setItems(prev => prev.map(it => it.id === id ? { ...it, noResult: false, price: { price: v, twd: Math.round(v * rateOf(it.country)), currency: it.price?.currency || CO[it.country].cur, title: it.price?.title || it.name, url: it.price?.url } } : it)); setPriceEdit(null); }} activeOpacity={0.85}><Text style={styles.storeSaveTxt}>儲存</Text></TouchableOpacity>
          </View>
        </TouchableOpacity>
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
      <Modal visible={!!calc} transparent animationType="slide" onRequestClose={() => setCalc(null)}>
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.grip} />
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
    </SafeAreaView>
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
  addInput: { flex: 1, paddingVertical: 13, color: C.ink, fontSize: 15 },
  addBtn: { width: 52, backgroundColor: C.rose, borderRadius: 14, alignItems: 'center', justifyContent: 'center', shadowColor: C.rose, shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 5 } },
  toolRow: { flexDirection: 'row', gap: 9, paddingHorizontal: 18, marginTop: 12 },
  toolChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 8 },
  toolChipPrimary: { backgroundColor: C.rose, borderColor: C.rose, marginLeft: 'auto' },
  toolChipTxt: { color: C.inkSoft, fontSize: 12.5, fontWeight: '700' },

  list: { flex: 1, paddingHorizontal: 18, marginTop: 14 },
  emptyWrap: { alignItems: 'center', marginTop: 46 },
  emptyIcon: { width: 82, height: 82, borderRadius: 26, backgroundColor: C.roseSoft, alignItems: 'center', justifyContent: 'center' },
  emptyBig: { color: C.ink, fontSize: 20, fontWeight: '800', letterSpacing: 1, marginTop: 14 },
  empty: { color: C.muted, textAlign: 'center', marginTop: 8, fontSize: 13.5, lineHeight: 23 },

  card: { backgroundColor: C.surface, borderRadius: 20, padding: 15, marginBottom: 12, borderWidth: 1, borderColor: C.line, shadowColor: '#7a5a44', shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  name: { flex: 1, color: C.ink, fontSize: 16.5, fontWeight: '800', lineHeight: 22 },
  body: { flexDirection: 'row', gap: 13, marginTop: 12 },
  imgWrap: { width: 90, height: 90, borderRadius: 16, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  img: { width: 90, height: 90 },
  imgEmpty: { alignItems: 'center', gap: 2 },
  imgEmptyTxt: { fontSize: 11, color: C.muted, fontWeight: '700' },
  bodyRight: { flex: 1, justifyContent: 'space-between' },
  note: { backgroundColor: C.bg, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 9, fontSize: 13.5, color: C.ink },
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
  pickedTitle: { color: C.muted, fontSize: 11, marginTop: 2 },
  loadingTxt: { color: C.muted, fontSize: 14, marginLeft: 9, fontWeight: '600' },
  noPrice: { color: '#c2b4a8', fontSize: 13.5 },
  errTxt: { color: C.roseDeep, fontSize: 13, fontWeight: '600' },
  flex1: { flex: 1 },
  changeBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.roseSoft, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9 },
  changeBtnTxt: { color: C.roseDeep, fontWeight: '800', fontSize: 13 },
  queryBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.rose, borderRadius: 11, paddingHorizontal: 18, paddingVertical: 10 },
  queryBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 14, letterSpacing: 1 },
  linkRow: { flexDirection: 'row', gap: 16, marginTop: 9, paddingLeft: 2 },
  linkTxt: { color: C.inkSoft, fontSize: 12, fontWeight: '700' },
  doneBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 11 },
  doneBtnTxt: { color: C.green, fontWeight: '800', fontSize: 13.5 },

  // 預算
  budgetSet: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.line, borderStyle: 'dashed', borderRadius: 16, paddingVertical: 14, marginBottom: 13 },
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
  ledgerInput: { minWidth: 56, backgroundColor: C.bg, borderRadius: 7, paddingHorizontal: 8, paddingVertical: 4, fontSize: 14, color: C.ink, fontFamily: MONO, fontWeight: '700' },
  ledgerTwd: { color: C.muted, fontSize: 12, fontFamily: MONO },

  scanOverlay: { position: 'absolute', inset: 0, backgroundColor: 'rgba(46,36,32,0.6)', alignItems: 'center', justifyContent: 'center', gap: 12 },
  scanTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },

  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(46,36,32,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 20, paddingBottom: 30 },
  grip: { width: 42, height: 4, borderRadius: 2, backgroundColor: C.line, alignSelf: 'center', marginBottom: 14 },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, gap: 12 },
  sheetKicker: { color: C.rose, fontSize: 11.5, fontWeight: '800' },
  sheetTitle: { fontSize: 19, fontWeight: '900', color: C.ink, marginTop: 3 },
  repickRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.bg, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6, marginBottom: 12 },
  repickInput: { flex: 1, paddingVertical: 7, fontSize: 14, color: C.ink },
  repickBtn: { backgroundColor: C.rose, borderRadius: 9, paddingHorizontal: 14, paddingVertical: 7 },
  repickBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 13 },
  cand: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: C.line },
  candImg: { width: 56, height: 56, borderRadius: 12, backgroundColor: C.bg },
  candTitle: { color: C.ink, fontSize: 14, fontWeight: '600', lineHeight: 19 },
  candPrice: { color: C.inkSoft, fontSize: 14, fontWeight: '700', marginTop: 4, fontFamily: MONO },
  candTwd: { color: C.rose, fontSize: 14, fontWeight: '800', fontFamily: MONO },
  candPick: { backgroundColor: C.roseSoft, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  candPickTxt: { color: C.roseDeep, fontWeight: '800', fontSize: 13 },

  centerBackdrop: { flex: 1, backgroundColor: 'rgba(46,36,32,0.55)', alignItems: 'center', justifyContent: 'center', padding: 26 },
  storeModal: { backgroundColor: C.surface, borderRadius: 20, padding: 20, width: '100%' },
  storeInput: { backgroundColor: C.bg, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: C.ink, marginTop: 12 },
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
  calcInput: { backgroundColor: C.bg, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, fontSize: 26, fontWeight: '800', color: C.ink, fontFamily: MONO, marginTop: 6 },
  calcResult: { backgroundColor: C.roseSoft, borderRadius: 14, padding: 16, marginTop: 12 },
  calcResultLabel: { color: C.roseDeep, fontSize: 12, fontWeight: '700' },
  calcResultNum: { color: C.roseDeep, fontSize: 30, fontWeight: '900', fontFamily: MONO, marginTop: 2 },
  calcRate: { color: C.muted, fontSize: 11, marginTop: 12, fontFamily: MONO, textAlign: 'center' },
});
