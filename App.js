import { useEffect, useMemo, useRef, useState } from 'react';
import {
  SafeAreaView, View, Text, TextInput, TouchableOpacity, Image, Modal,
  ScrollView, StyleSheet, StatusBar, Platform, ActivityIndicator, Animated,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';

const STORE_KEY = 'travel-shopping-list-v1';
const SETTINGS_KEY = 'travel-shopping-settings-v1';
const WORKER_URL = 'https://menshui-price.andy30019123agent.workers.dev';
const RAKUTEN_APP_ID = '3ec6041d-d772-4a05-861a-9d15ec64dafa';
const RAKUTEN_ACCESS_KEY = 'pk_SuWs3ZCwNcFZS14BLH8QbOcDkOOBMKlyDRp7L3a2ANN';

const CO = {
  jp: { flag: '🇯🇵', label: '日本', cur: '¥', curLabel: '日圓' },
  kr: { flag: '🇰🇷', label: '韓國', cur: '₩', curLabel: '韓元' },
};
const fmt = n => (n == null ? '' : Math.round(n).toLocaleString('en-US'));
const enc = encodeURIComponent;
const MONO = Platform.select({ web: 'ui-monospace, SFMono-Regular, Menlo, monospace', ios: 'Menlo', android: 'monospace', default: 'monospace' });

async function fetchCandidates(item) {
  const q = item.term ? `term=${enc(item.term)}` : `item=${enc(item.name)}`;
  const res = await fetch(`${WORKER_URL}/price?country=${item.country}&${q}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || '查詢失敗');
  const term = (data.terms && data.terms[0]) || item.term || '';
  const currency = data.currency || CO[item.country].cur;
  const rate = data.rate || (item.country === 'kr' ? 0.021 : 0.197);
  let cands = [];
  if (item.country === 'kr') {
    cands = (data.candidates || []).map(c => ({ title: c.title, price: c.price, image: c.image, twd: Math.round(c.price * rate) }));
  } else {
    const url = `https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260401` +
      `?applicationId=${RAKUTEN_APP_ID}&accessKey=${RAKUTEN_ACCESS_KEY}&keyword=${enc(term)}&hits=20&format=json`;
    const rk = await fetch(url);
    if (!rk.ok) throw new Error(`樂天查詢失敗 (${rk.status})`);
    const rj = await rk.json();
    const seen = new Set();
    for (const x of (rj.Items || [])) {
      const i = x.Item || x;
      const title = i.itemName || '';
      const price = i.itemPrice;
      const image = i.mediumImageUrls?.[0]?.imageUrl || i.smallImageUrls?.[0]?.imageUrl || '';
      if (!title || !price) continue;
      const key = title.slice(0, 12);
      if (seen.has(key)) continue;
      seen.add(key);
      cands.push({ title, price, image, twd: Math.round(price * rate) });
      if (cands.length >= 10) break;
    }
  }
  return { term, currency, candidates: cands, resolved: data.resolved || '' };
}

// 卡片進場動效
function AnimatedCard({ children, style }) {
  const a = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(a, { toValue: 1, duration: 280, useNativeDriver: true }).start();
  }, []);
  return (
    <Animated.View style={[style, { opacity: a, transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

// 價格標籤（出現時微微彈入）
function PriceTag({ twd }) {
  const s = useRef(new Animated.Value(0.85)).current;
  useEffect(() => { s.setValue(0.85); Animated.spring(s, { toValue: 1, friction: 5, tension: 140, useNativeDriver: true }).start(); }, [twd]);
  return (
    <Animated.View style={[styles.priceTag, { transform: [{ scale: s }] }]}>
      <Text style={styles.priceTagCur}>NT$</Text>
      <Text style={styles.priceTagNum}>{fmt(twd)}</Text>
    </Animated.View>
  );
}

export default function App() {
  const [items, setItems] = useState([]);
  const [input, setInput] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState({});
  const [picker, setPicker] = useState(null);
  const [zoom, setZoom] = useState(null);
  const [country, setCountry] = useState('jp'); // 全域國家
  const [sort, setSort] = useState('added');
  const [hideDone, setHideDone] = useState(false);
  const [rates, setRates] = useState({ jpy: 0.197, krw: 0.021 });
  const [calc, setCalc] = useState(null); // { cur, dir, amt }

  useEffect(() => {
    AsyncStorage.getItem(STORE_KEY).then(r => { if (r) setItems(JSON.parse(r)); setLoaded(true); });
    AsyncStorage.getItem(SETTINGS_KEY).then(r => { if (r) { const s = JSON.parse(r); if (s.country) setCountry(s.country); if (s.sort) setSort(s.sort); if (s.hideDone != null) setHideDone(s.hideDone); } });
    fetch(`${WORKER_URL}/rate`).then(r => r.json()).then(d => { if (d.ok) setRates({ jpy: d.jpy, krw: d.krw }); }).catch(() => {});
  }, []);
  useEffect(() => { if (loaded) AsyncStorage.setItem(STORE_KEY, JSON.stringify(items)); }, [items, loaded]);
  useEffect(() => { AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({ country, sort, hideDone })); }, [country, sort, hideDone]);

  const update = (id, patch) => setItems(prev => prev.map(it => (it.id === id ? { ...it, ...patch } : it)));
  const remove = id => setItems(prev => prev.filter(it => it.id !== id));

  const addItem = () => {
    const name = input.trim();
    if (!name) return;
    const it = { id: Date.now().toString(), name, country, qty: 1, note: '', term: '', image: '', imageManual: false, purchased: false, price: null, candidates: null, currency: CO[country].cur };
    setItems(prev => [it, ...prev]);
    setInput('');
    queryOne(it);
  };

  async function queryOne(item) {
    setBusy(b => ({ ...b, [item.id]: true }));
    try {
      const { term, currency, candidates, resolved } = await fetchCandidates(item);
      const patch = { term, currency, candidates };
      if (resolved) patch.name = resolved;
      if (!candidates.length) { patch.noResult = true; patch.price = null; }
      else {
        patch.noResult = false;
        const c = candidates[0];
        patch.price = { price: c.price, twd: c.twd, currency, title: c.title };
        if (c.image && !item.imageManual) patch.image = c.image;
      }
      update(item.id, patch);
    } catch (e) {
      setBusy(b => ({ ...b, [item.id]: 'err' }));
      setTimeout(() => setBusy(b => ({ ...b, [item.id]: false })), 2500);
      return;
    }
    setBusy(b => ({ ...b, [item.id]: false }));
  }

  function openPicker(item) {
    if (item.candidates && item.candidates.length)
      setPicker({ itemId: item.id, currency: item.currency, candidates: item.candidates, name: item.name });
    else queryOne(item);
  }
  function choosePick(c) {
    const { itemId, currency } = picker;
    setItems(prev => prev.map(it => it.id === itemId
      ? { ...it, price: { price: c.price, twd: c.twd, currency, title: c.title }, image: it.imageManual ? it.image : (c.image || it.image), noResult: false }
      : it));
    setPicker(null);
  }
  async function pickImage(id) {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ quality: 0.6 });
      if (!res.canceled && res.assets?.[0]) update(id, { image: res.assets[0].uri, imageManual: true });
    } catch (e) { /* ignore */ }
  }

  // 切換全域國家 → 全部改國家並重新查價
  function switchCountry(c) {
    if (c === country) return;
    setCountry(c);
    const updated = items.map(it => ({ ...it, country: c, term: '', price: null, candidates: null, noResult: false, image: it.imageManual ? it.image : '' }));
    setItems(updated);
    updated.forEach(it => queryOne(it));
  }
  function switchItemCountry(item, c) {
    if (item.country === c) return;
    const u = { ...item, country: c, term: '', price: null, candidates: null, noResult: false, image: item.imageManual ? item.image : '' };
    update(item.id, u);
    queryOne(u);
  }

  const totals = useMemo(() => {
    let todo = 0, done = 0;
    for (const it of items) {
      if (!it.price) continue;
      const t = it.price.twd * it.qty;
      if (it.purchased) done += t; else todo += t;
    }
    return { todo, done };
  }, [items]);

  const { todoItems, doneItems } = useMemo(() => {
    const sorter = {
      added: (a, b) => Number(b.id) - Number(a.id),
      priceHigh: (a, b) => (b.price?.twd || 0) * b.qty - (a.price?.twd || 0) * a.qty,
      priceLow: (a, b) => ((a.price?.twd || 1e12) * a.qty) - ((b.price?.twd || 1e12) * b.qty),
    }[sort];
    const todo = items.filter(i => !i.purchased).sort(sorter);
    const done = items.filter(i => i.purchased).sort(sorter);
    return { todoItems: todo, doneItems: done };
  }, [items, sort]);

  const SORT_LABEL = { added: '加入順序', priceHigh: '價格高→低', priceLow: '價格低→高' };
  const cycleSort = () => setSort(s => (s === 'added' ? 'priceHigh' : s === 'priceHigh' ? 'priceLow' : 'added'));
  const rateOf = c => (c === 'kr' ? rates.krw : rates.jpy);

  const renderCard = it => {
    const co = CO[it.country];
    const state = busy[it.id];
    return (
      <AnimatedCard key={it.id} style={[styles.card, it.purchased && styles.cardDone]}>
        <View style={styles.rowTop}>
          <TouchableOpacity style={[styles.check, it.purchased && styles.checkOn]} accessibilityLabel={`購買勾選-${it.name}`} onPress={() => update(it.id, { purchased: !it.purchased })}>
            <Text style={styles.checkTxt}>{it.purchased ? '✓' : ''}</Text>
          </TouchableOpacity>
          <Text style={[styles.name, it.purchased && styles.nameDone]} numberOfLines={2}>{it.name}</Text>
          <TouchableOpacity onPress={() => remove(it.id)} hitSlop={8}><Text style={styles.del}>✕</Text></TouchableOpacity>
        </View>

        <View style={styles.body}>
          <TouchableOpacity style={styles.imgWrap} onPress={() => it.image ? setZoom({ url: it.image, itemId: it.id }) : pickImage(it.id)} activeOpacity={0.8}>
            {it.image ? <Image source={{ uri: it.image }} style={styles.img} /> : <Text style={styles.imgPlus}>＋{'\n'}加圖</Text>}
          </TouchableOpacity>

          <View style={styles.bodyRight}>
            <TextInput style={styles.note} placeholder="備註：給媽媽 / 無香料…" placeholderTextColor="#c3b6ab" value={it.note} onChangeText={t => update(it.id, { note: t })} />
            <View style={styles.bodyRow}>
              <View style={styles.miniSeg}>
                {['jp', 'kr'].map(c => (
                  <TouchableOpacity key={c} style={[styles.miniSegBtn, it.country === c && styles.miniSegOn]} onPress={() => switchItemCountry(it, c)}>
                    <Text style={[styles.miniSegTxt, it.country === c && styles.miniSegTxtOn]}>{CO[c].flag}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.qty}>
                <TouchableOpacity style={styles.qtyBtn} onPress={() => update(it.id, { qty: Math.max(1, it.qty - 1) })}><Text style={styles.qtyBtnTxt}>－</Text></TouchableOpacity>
                <Text style={styles.qtyNum}>{it.qty}</Text>
                <TouchableOpacity style={styles.qtyBtn} onPress={() => update(it.id, { qty: it.qty + 1 })}><Text style={styles.qtyBtnTxt}>＋</Text></TouchableOpacity>
              </View>
            </View>
          </View>
        </View>

        {state === true ? (
          <View style={styles.priceRow}><ActivityIndicator size="small" color={C.rose} /><Text style={styles.loadingTxt}>查價中…</Text></View>
        ) : it.price ? (
          <View style={styles.priceRow}>
            <PriceTag twd={it.price.twd * it.qty} />
            <TouchableOpacity style={styles.priceMid} onPress={() => openPicker(it)} activeOpacity={0.7}>
              <Text style={styles.localPrice}>{it.price.currency}{fmt(it.price.price)}{it.qty > 1 ? ` ×${it.qty}` : ''}</Text>
              <Text style={styles.pickedTitle} numberOfLines={1}>{it.price.title}　<Text style={styles.changeHint}>▾換</Text></Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.reBtn} onPress={() => queryOne(it)} activeOpacity={0.7}><Text style={styles.reBtnTxt}>↻</Text></TouchableOpacity>
          </View>
        ) : (
          <View style={styles.priceRow}>
            <Text style={[styles.flex1, state === 'err' || it.noResult ? styles.errTxt : styles.noPrice]}>
              {state === 'err' ? '連線出錯，再試一次' : it.noResult ? '查無結果，改搜尋字再查' : '還沒查價'}
            </Text>
            <TouchableOpacity style={styles.queryBtn} onPress={() => queryOne(it)} activeOpacity={0.85}><Text style={styles.queryBtnTxt}>查價</Text></TouchableOpacity>
          </View>
        )}

        {(it.term || it.price) ? (
          <View style={styles.termRow}>
            <Text style={styles.termLabel}>搜尋字</Text>
            <TextInput style={styles.termInput} value={it.term} placeholder="翻譯後可改再查" placeholderTextColor="#d3b3bf" onChangeText={t => update(it.id, { term: t })} />
          </View>
        ) : null}
      </AnimatedCard>
    );
  };

  const calcResult = () => {
    if (!calc) return '';
    const amt = parseFloat(calc.amt) || 0;
    const r = rateOf(calc.cur);
    return calc.dir === 'toTWD' ? amt * r : amt / r;
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />

      <View style={styles.header}>
        <View>
          <Text style={styles.wordmark}>免稅不是免費</Text>
          <Text style={styles.eyebrow}>DUTY-FREE ≠ FREE</Text>
        </View>
        <TouchableOpacity style={styles.calcBtn} onPress={() => setCalc({ cur: country, dir: 'toTWD', amt: '' })} activeOpacity={0.85}>
          <Text style={styles.calcBtnIcon}>💱</Text>
          <Text style={styles.calcBtnTxt}>匯率</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.tripBar}>
        <View style={styles.bigSeg}>
          {['jp', 'kr'].map(c => (
            <TouchableOpacity key={c} style={[styles.bigSegBtn, country === c && styles.bigSegOn]} onPress={() => switchCountry(c)} activeOpacity={0.85}>
              <Text style={[styles.bigSegTxt, country === c && styles.bigSegTxtOn]}>{CO[c].flag} {CO[c].label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.rateTxt}>1 {CO[country].curLabel} ≈ <Text style={styles.rateNum}>NT${rateOf(country).toFixed(country === 'kr' ? 3 : 2)}</Text></Text>
      </View>

      <View style={styles.addBar}>
        <TextInput style={styles.addInput} placeholder="商品名／綽號／貼商品網址都行" placeholderTextColor="#bca99c" value={input} onChangeText={setInput} onSubmitEditing={addItem} returnKeyType="done" />
        <TouchableOpacity style={styles.addBtn} onPress={addItem} activeOpacity={0.85}><Text style={styles.addBtnTxt}>加入</Text></TouchableOpacity>
      </View>

      {items.length > 0 && (
        <View style={styles.toolRow}>
          <TouchableOpacity style={styles.toolChip} onPress={cycleSort}><Text style={styles.toolChipTxt}>排序：{SORT_LABEL[sort]} ⇅</Text></TouchableOpacity>
          <TouchableOpacity style={[styles.toolChip, hideDone && styles.toolChipOn]} onPress={() => setHideDone(v => !v)}><Text style={[styles.toolChipTxt, hideDone && styles.toolChipTxtOn]}>{hideDone ? '☑' : '☐'} 隱藏已買</Text></TouchableOpacity>
        </View>
      )}

      <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
        {items.length === 0 && (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyEmoji}>🧳</Text>
            <Text style={styles.emptyBig}>清單空空</Text>
            <Text style={styles.empty}>上面打商品名、綽號，或貼商品網址{'\n'}加入後自動幫你查當地價＋換台幣</Text>
          </View>
        )}
        {todoItems.length > 0 && (
          <Text style={styles.section}>待買 · {todoItems.length}</Text>
        )}
        {todoItems.map(renderCard)}
        {!hideDone && doneItems.length > 0 && (
          <Text style={[styles.section, { marginTop: 18 }]}>已買 · {doneItems.length}</Text>
        )}
        {!hideDone && doneItems.map(renderCard)}
      </ScrollView>

      <View style={styles.footer}>
        <View style={styles.footPerf} />
        <View style={styles.footRow}>
          <View><Text style={styles.footLabel}>待買預估</Text><Text style={styles.footTodo}>NT${fmt(totals.todo)}</Text></View>
          <View style={{ alignItems: 'flex-end' }}><Text style={styles.footLabel}>已買</Text><Text style={styles.footDone}>NT${fmt(totals.done)}</Text></View>
        </View>
      </View>

      {/* 候選選擇器 */}
      <Modal visible={!!picker} transparent animationType="slide" onRequestClose={() => setPicker(null)}>
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.grip} />
            <View style={styles.sheetHead}>
              <View><Text style={styles.sheetKicker}>選一個 · {picker?.name}</Text><Text style={styles.sheetTitle}>哪個是你要買的？</Text></View>
              <TouchableOpacity onPress={() => setPicker(null)} hitSlop={8}><Text style={styles.sheetClose}>✕</Text></TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 440 }} showsVerticalScrollIndicator={false}>
              {picker?.candidates.map((c, i) => (
                <TouchableOpacity key={i} style={styles.cand} onPress={() => choosePick(c)} activeOpacity={0.7}>
                  {c.image ? <TouchableOpacity onPress={() => setZoom({ url: c.image })} activeOpacity={0.8}><Image source={{ uri: c.image }} style={styles.candImg} /></TouchableOpacity> : <View style={styles.candImg} />}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.candTitle} numberOfLines={2}>{c.title}</Text>
                    <Text style={styles.candPrice}>{picker.currency}{fmt(c.price)}<Text style={styles.candTwd}>　NT${fmt(c.twd)}</Text></Text>
                  </View>
                  <Text style={styles.candPick}>選</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* 圖片放大 */}
      <Modal visible={!!zoom} transparent animationType="fade" onRequestClose={() => setZoom(null)}>
        <TouchableOpacity style={styles.zoomBackdrop} activeOpacity={1} onPress={() => setZoom(null)}>
          {zoom?.url ? <Image source={{ uri: zoom.url }} style={styles.zoomImg} resizeMode="contain" /> : null}
          <View style={styles.zoomBar}>
            {zoom?.itemId ? <TouchableOpacity style={styles.zoomReplace} onPress={() => { const id = zoom.itemId; setZoom(null); pickImage(id); }}><Text style={styles.zoomReplaceTxt}>換成自己的圖</Text></TouchableOpacity> : <View />}
            <TouchableOpacity style={styles.zoomClose} onPress={() => setZoom(null)}><Text style={styles.zoomCloseTxt}>關閉 ✕</Text></TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* 匯率計算機 */}
      <Modal visible={!!calc} transparent animationType="slide" onRequestClose={() => setCalc(null)}>
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.grip} />
            <View style={styles.sheetHead}>
              <View><Text style={styles.sheetKicker}>💱 匯率計算機</Text><Text style={styles.sheetTitle}>快速換算</Text></View>
              <TouchableOpacity onPress={() => setCalc(null)} hitSlop={8}><Text style={styles.sheetClose}>✕</Text></TouchableOpacity>
            </View>
            {calc && (
              <View style={{ paddingTop: 6 }}>
                <View style={styles.calcRow}>
                  <View style={styles.bigSeg}>
                    {['jp', 'kr'].map(c => (
                      <TouchableOpacity key={c} style={[styles.bigSegBtn, calc.cur === c && styles.bigSegOn]} onPress={() => setCalc({ ...calc, cur: c })}>
                        <Text style={[styles.bigSegTxt, calc.cur === c && styles.bigSegTxtOn]}>{CO[c].flag} {CO[c].curLabel}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <TouchableOpacity style={styles.swapBtn} onPress={() => setCalc({ ...calc, dir: calc.dir === 'toTWD' ? 'fromTWD' : 'toTWD' })}>
                    <Text style={styles.swapTxt}>⇄</Text>
                  </TouchableOpacity>
                </View>
                <Text style={styles.calcDirTxt}>{calc.dir === 'toTWD' ? `${CO[calc.cur].curLabel} → 台幣` : `台幣 → ${CO[calc.cur].curLabel}`}</Text>
                <TextInput style={styles.calcInput} keyboardType="numeric" placeholder="0" placeholderTextColor="#cdbdb0" value={calc.amt} onChangeText={t => setCalc({ ...calc, amt: t.replace(/[^0-9.]/g, '') })} autoFocus />
                <View style={styles.calcResult}>
                  <Text style={styles.calcResultLabel}>{calc.dir === 'toTWD' ? '約等於' : `約等於 ${CO[calc.cur].curLabel}`}</Text>
                  <Text style={styles.calcResultNum}>{calc.dir === 'toTWD' ? 'NT$' : CO[calc.cur].cur}{fmt(calcResult())}</Text>
                </View>
                <Text style={styles.calcRate}>參考匯率 1 {CO[calc.cur].curLabel} ≈ NT${rateOf(calc.cur).toFixed(calc.cur === 'kr' ? 3 : 2)}</Text>
              </View>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const C = {
  bg: '#F6F0EA', surface: '#FFFFFF', ink: '#2E2420', inkSoft: '#7A6E66', muted: '#A89C92',
  rose: '#D9637E', roseDeep: '#C24E6B', roseSoft: '#FBECF0', gold: '#C39A5E', line: '#ECE1D8',
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg, paddingTop: Platform.OS === 'android' ? 28 : 0 },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 22, paddingTop: 16, paddingBottom: 12 },
  wordmark: { color: C.ink, fontSize: 28, fontWeight: '900', letterSpacing: 1.5 },
  eyebrow: { color: C.gold, fontFamily: MONO, fontSize: 10.5, marginTop: 5, letterSpacing: 2 },
  calcBtn: { alignItems: 'center', backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.line, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 8 },
  calcBtnIcon: { fontSize: 18 },
  calcBtnTxt: { color: C.rose, fontSize: 11, fontWeight: '800', marginTop: 1, letterSpacing: 1 },

  tripBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, marginBottom: 4 },
  bigSeg: { flexDirection: 'row', backgroundColor: C.surface, borderRadius: 13, padding: 4, borderWidth: 1.5, borderColor: C.line },
  bigSegBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10 },
  bigSegOn: { backgroundColor: C.rose },
  bigSegTxt: { color: C.inkSoft, fontSize: 14, fontWeight: '800' },
  bigSegTxtOn: { color: '#fff' },
  rateTxt: { color: C.muted, fontSize: 12, fontFamily: MONO },
  rateNum: { color: C.gold, fontWeight: '800' },

  addBar: { flexDirection: 'row', paddingHorizontal: 22, gap: 9, marginTop: 12 },
  addInput: { flex: 1, backgroundColor: C.surface, borderRadius: 14, paddingHorizontal: 15, paddingVertical: 13, color: C.ink, fontSize: 15, borderWidth: 1.5, borderColor: C.line },
  addBtn: { backgroundColor: C.rose, borderRadius: 14, paddingHorizontal: 24, justifyContent: 'center', shadowColor: C.rose, shadowOpacity: 0.32, shadowRadius: 12, shadowOffset: { width: 0, height: 5 } },
  addBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 16, letterSpacing: 2 },

  toolRow: { flexDirection: 'row', gap: 9, paddingHorizontal: 22, marginTop: 12 },
  toolChip: { backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.line, borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7 },
  toolChipOn: { backgroundColor: C.roseSoft, borderColor: C.rose },
  toolChipTxt: { color: C.inkSoft, fontSize: 12.5, fontWeight: '700' },
  toolChipTxtOn: { color: C.roseDeep },

  list: { flex: 1, paddingHorizontal: 22, marginTop: 14 },
  section: { color: C.inkSoft, fontSize: 12, fontWeight: '800', letterSpacing: 2, marginBottom: 10, fontFamily: MONO },
  emptyWrap: { alignItems: 'center', marginTop: 56 },
  emptyEmoji: { fontSize: 44 },
  emptyBig: { color: C.ink, fontSize: 21, fontWeight: '800', letterSpacing: 1.5, marginTop: 12 },
  empty: { color: C.muted, textAlign: 'center', marginTop: 8, fontSize: 13.5, lineHeight: 23 },

  card: { backgroundColor: C.surface, borderRadius: 20, padding: 15, marginBottom: 13, borderWidth: 1, borderColor: C.line, shadowColor: '#7a5a44', shadowOpacity: 0.07, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 2 },
  cardDone: { backgroundColor: '#FAF6F1', opacity: 0.7 },
  rowTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 11 },
  check: { width: 26, height: 26, borderRadius: 9, borderWidth: 2, borderColor: '#DAD0C7', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkOn: { backgroundColor: C.rose, borderColor: C.rose },
  checkTxt: { color: '#fff', fontWeight: '900', fontSize: 14 },
  name: { flex: 1, color: C.ink, fontSize: 16.5, fontWeight: '800', lineHeight: 22 },
  nameDone: { textDecorationLine: 'line-through', color: C.muted },
  del: { color: '#cdbfb4', fontSize: 16, paddingHorizontal: 2 },

  body: { flexDirection: 'row', gap: 13, marginTop: 13 },
  imgWrap: { width: 96, height: 96, borderRadius: 15, backgroundColor: C.bg, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  img: { width: 96, height: 96 },
  imgPlus: { fontSize: 12, color: C.muted, fontWeight: '700', textAlign: 'center', lineHeight: 16 },
  bodyRight: { flex: 1, justifyContent: 'space-between' },
  note: { backgroundColor: C.bg, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 9, fontSize: 13.5, color: C.ink, borderWidth: 1, borderColor: C.line },
  bodyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  miniSeg: { flexDirection: 'row', backgroundColor: C.bg, borderRadius: 9, padding: 3, borderWidth: 1, borderColor: C.line },
  miniSegBtn: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 6 },
  miniSegOn: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.rose },
  miniSegTxt: { fontSize: 14, opacity: 0.45 },
  miniSegTxtOn: { opacity: 1 },
  qty: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  qtyBtn: { width: 30, height: 30, borderRadius: 9, backgroundColor: C.bg, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  qtyBtnTxt: { color: C.ink, fontSize: 16, fontWeight: '800' },
  qtyNum: { color: C.ink, fontSize: 15, fontWeight: '800', minWidth: 20, textAlign: 'center', fontFamily: MONO },

  priceRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14, gap: 11 },
  priceTag: { backgroundColor: C.rose, borderRadius: 11, paddingHorizontal: 13, paddingVertical: 8, flexDirection: 'row', alignItems: 'baseline', shadowColor: C.rose, shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  priceTagCur: { color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: '800', fontFamily: MONO },
  priceTagNum: { color: '#fff', fontSize: 19, fontWeight: '900', fontFamily: MONO, marginLeft: 1 },
  priceMid: { flex: 1 },
  localPrice: { color: C.inkSoft, fontSize: 13, fontWeight: '700', fontFamily: MONO },
  pickedTitle: { color: C.muted, fontSize: 11, marginTop: 2 },
  changeHint: { color: C.rose, fontSize: 11, fontWeight: '800' },
  loadingTxt: { color: C.muted, fontSize: 14, marginLeft: 9, fontWeight: '600' },
  noPrice: { color: '#c2b4a8', fontSize: 13.5 },
  errTxt: { color: C.roseDeep, fontSize: 13, fontWeight: '600' },
  flex1: { flex: 1 },
  reBtn: { width: 38, height: 38, borderRadius: 11, backgroundColor: C.bg, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  reBtnTxt: { color: C.inkSoft, fontSize: 17, fontWeight: '800' },
  queryBtn: { backgroundColor: C.rose, borderRadius: 11, paddingHorizontal: 20, paddingVertical: 10, alignItems: 'center' },
  queryBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 14, letterSpacing: 2 },

  termRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 11 },
  termLabel: { fontFamily: MONO, fontSize: 10, color: C.gold, letterSpacing: 1, fontWeight: '700' },
  termInput: { flex: 1, backgroundColor: C.roseSoft, borderRadius: 9, paddingHorizontal: 11, paddingVertical: 7, fontSize: 13.5, color: C.ink },

  footer: { paddingHorizontal: 22, paddingBottom: 16, paddingTop: 6, backgroundColor: C.bg },
  footPerf: { borderTopWidth: 1.5, borderTopColor: C.line, borderStyle: 'dashed', marginBottom: 11 },
  footRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  footLabel: { color: C.muted, fontSize: 11, fontFamily: MONO, letterSpacing: 1.5 },
  footTodo: { color: C.rose, fontSize: 27, fontWeight: '900', fontFamily: MONO, marginTop: 2 },
  footDone: { color: C.gold, fontSize: 18, fontWeight: '800', fontFamily: MONO, marginTop: 2 },

  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(46,36,32,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 20, paddingBottom: 30 },
  grip: { width: 42, height: 4, borderRadius: 2, backgroundColor: C.line, alignSelf: 'center', marginBottom: 14 },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  sheetKicker: { color: C.rose, fontFamily: MONO, fontSize: 11, letterSpacing: 1, fontWeight: '700' },
  sheetTitle: { fontSize: 20, fontWeight: '900', color: C.ink, marginTop: 3, letterSpacing: 1 },
  sheetClose: { fontSize: 18, color: C.muted, padding: 2 },
  cand: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: C.line },
  candImg: { width: 56, height: 56, borderRadius: 11, backgroundColor: C.bg, borderWidth: 1, borderColor: C.line },
  candTitle: { color: C.ink, fontSize: 14, fontWeight: '600', lineHeight: 19 },
  candPrice: { color: C.inkSoft, fontSize: 14, fontWeight: '700', marginTop: 4, fontFamily: MONO },
  candTwd: { color: C.rose, fontSize: 14, fontWeight: '800', fontFamily: MONO },
  candPick: { color: C.rose, fontWeight: '800', fontSize: 13, letterSpacing: 1, borderWidth: 1.5, borderColor: C.rose, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 7 },

  zoomBackdrop: { flex: 1, backgroundColor: 'rgba(28,22,18,0.95)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  zoomImg: { width: '100%', height: '78%' },
  zoomBar: { position: 'absolute', bottom: 36, left: 20, right: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  zoomReplace: { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.6)', borderRadius: 11, paddingHorizontal: 16, paddingVertical: 10 },
  zoomReplaceTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },
  zoomClose: { backgroundColor: C.rose, borderRadius: 11, paddingHorizontal: 18, paddingVertical: 10 },
  zoomCloseTxt: { color: '#fff', fontWeight: '800', fontSize: 14, letterSpacing: 1 },

  calcRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  swapBtn: { width: 44, height: 44, borderRadius: 12, backgroundColor: C.roseSoft, alignItems: 'center', justifyContent: 'center' },
  swapTxt: { color: C.rose, fontSize: 20, fontWeight: '900' },
  calcDirTxt: { color: C.muted, fontSize: 12, marginTop: 12, fontWeight: '700' },
  calcInput: { backgroundColor: C.bg, borderRadius: 14, borderWidth: 1.5, borderColor: C.line, paddingHorizontal: 16, paddingVertical: 14, fontSize: 26, fontWeight: '800', color: C.ink, fontFamily: MONO, marginTop: 6 },
  calcResult: { backgroundColor: C.roseSoft, borderRadius: 14, padding: 16, marginTop: 12 },
  calcResultLabel: { color: C.roseDeep, fontSize: 12, fontWeight: '700' },
  calcResultNum: { color: C.roseDeep, fontSize: 30, fontWeight: '900', fontFamily: MONO, marginTop: 2 },
  calcRate: { color: C.muted, fontSize: 11, marginTop: 12, fontFamily: MONO, textAlign: 'center' },
});
