import { useEffect, useMemo, useState } from 'react';
import {
  SafeAreaView, View, Text, TextInput, TouchableOpacity, Image, Modal,
  ScrollView, StyleSheet, StatusBar, Platform, ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';

const STORE_KEY = 'travel-shopping-list-v1';
const WORKER_URL = 'https://menshui-price.andy30019123agent.workers.dev';
const RAKUTEN_APP_ID = '3ec6041d-d772-4a05-861a-9d15ec64dafa';
const RAKUTEN_ACCESS_KEY = 'pk_SuWs3ZCwNcFZS14BLH8QbOcDkOOBMKlyDRp7L3a2ANN';

const CURRENCY = {
  jp: { flag: '🇯🇵', label: '日本' },
  kr: { flag: '🇰🇷', label: '韓國' },
};
const fmt = n => (n == null ? '' : n.toLocaleString('en-US'));
const enc = encodeURIComponent;
const MONO = Platform.select({ web: 'ui-monospace, SFMono-Regular, Menlo, monospace', ios: 'Menlo', android: 'monospace', default: 'monospace' });

async function fetchCandidates(item) {
  const q = item.term ? `term=${enc(item.term)}` : `item=${enc(item.name)}`;
  const res = await fetch(`${WORKER_URL}/price?country=${item.country}&${q}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || '查詢失敗');
  const term = (data.terms && data.terms[0]) || item.term || '';
  const currency = data.currency || (item.country === 'kr' ? '₩' : '¥');
  const rate = data.rate || (item.country === 'kr' ? 0.023 : 0.21);

  let cands = [];
  if (item.country === 'kr') {
    cands = (data.candidates || []).map(c => ({ title: c.title, price: c.price, image: c.image, twd: Math.round(c.price * rate) }));
  } else {
    const url = `https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260401` +
      `?applicationId=${RAKUTEN_APP_ID}&accessKey=${RAKUTEN_ACCESS_KEY}&keyword=${enc(term)}&hits=20&format=json`;
    const rk = await fetch(url);
    if (!rk.ok) throw new Error(`樂天查詢失敗 (${rk.status})`);
    const rj = await rk.json();
    const items = (rj.Items || []).map(x => x.Item || x);
    const seen = new Set();
    for (const i of items) {
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

const Perf = ({ style }) => <View style={[styles.perf, style]} />;

export default function App() {
  const [items, setItems] = useState([]);
  const [input, setInput] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState({});
  const [picker, setPicker] = useState(null);
  const [zoom, setZoom] = useState(null); // { url, itemId? }

  useEffect(() => {
    AsyncStorage.getItem(STORE_KEY).then(raw => { if (raw) setItems(JSON.parse(raw)); setLoaded(true); });
  }, []);
  useEffect(() => { if (loaded) AsyncStorage.setItem(STORE_KEY, JSON.stringify(items)); }, [items, loaded]);

  const update = (id, patch) => setItems(prev => prev.map(it => (it.id === id ? { ...it, ...patch } : it)));
  const remove = id => setItems(prev => prev.filter(it => it.id !== id));

  const addItem = () => {
    const name = input.trim();
    if (!name) return;
    const it = { id: Date.now().toString(), name, country: 'jp', qty: 1, note: '', term: '', image: '', imageManual: false, purchased: false, price: null, candidates: null, currency: '¥' };
    setItems(prev => [it, ...prev]);
    setInput('');
    queryOne(it); // 加入時自動查價
  };

  // 查價：自動選最吻合(第一個候選)，並存下候選清單供之後更換
  async function queryOne(item) {
    setBusy(b => ({ ...b, [item.id]: true }));
    try {
      const { term, currency, candidates, resolved } = await fetchCandidates(item);
      const patch = { term, currency, candidates };
      if (resolved) patch.name = resolved; // 貼網址 → 改成解析出的商品名
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

  // 開啟候選清單以更換（用已存的候選，免重查）
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

  const totals = useMemo(() => {
    let todo = 0, done = 0;
    for (const it of items) {
      if (!it.price) continue;
      const t = it.price.twd * it.qty;
      if (it.purchased) done += t; else todo += t;
    }
    return { todo, done };
  }, [items]);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />

      <View style={styles.header}>
        <Text style={styles.wordmark}>免稅不是免費</Text>
        <Text style={styles.eyebrow}>DUTY-FREE ≠ FREE　·　日本 / 韓國</Text>
      </View>
      <Perf />

      <View style={styles.addBar}>
        <TextInput
          style={styles.addInput}
          placeholder="想買什麼？例如：白色戀人、小護士"
          placeholderTextColor="#bdb3aa"
          value={input}
          onChangeText={setInput}
          onSubmitEditing={addItem}
          returnKeyType="done"
        />
        <TouchableOpacity style={styles.addBtn} onPress={addItem} activeOpacity={0.85}>
          <Text style={styles.addBtnTxt}>加入</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 20 }}>
        {items.length === 0 && (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyBig}>清單空空</Text>
            <Text style={styles.empty}>上面加入想買的東西{'\n'}查到當地價格，先看看會花多少 🧳</Text>
          </View>
        )}
        {items.map(it => {
          const state = busy[it.id];
          return (
            <View key={it.id} style={[styles.card, it.purchased && styles.cardDone]}>
              <View style={styles.rowTop}>
                <TouchableOpacity
                  style={[styles.check, it.purchased && styles.checkOn]}
                  accessibilityLabel={`購買勾選-${it.name}`}
                  onPress={() => update(it.id, { purchased: !it.purchased })}
                >
                  <Text style={styles.checkTxt}>{it.purchased ? '✓' : ''}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.thumbWrap} onPress={() => it.image ? setZoom({ url: it.image, itemId: it.id }) : pickImage(it.id)}>
                  {it.image
                    ? <Image source={{ uri: it.image }} style={styles.thumb} />
                    : <Text style={styles.thumbPlus}>＋圖</Text>}
                </TouchableOpacity>
                <Text style={[styles.name, it.purchased && styles.nameDone]} numberOfLines={1}>{it.name}</Text>
                <TouchableOpacity onPress={() => remove(it.id)} hitSlop={8}>
                  <Text style={styles.del}>✕</Text>
                </TouchableOpacity>
              </View>

              <TextInput
                style={styles.note}
                placeholder="備註，例如：給媽媽 / 要無香料款"
                placeholderTextColor="#c4bbb2"
                value={it.note}
                onChangeText={t => update(it.id, { note: t })}
              />

              {(it.term || it.price) ? (
                <View style={styles.termRow}>
                  <Text style={styles.termLabel}>搜尋字</Text>
                  <TextInput
                    style={styles.termInput}
                    value={it.term}
                    placeholder="翻譯後可改再查"
                    placeholderTextColor="#c9a9b9"
                    onChangeText={t => update(it.id, { term: t })}
                  />
                </View>
              ) : null}

              <View style={styles.rowMid}>
                <View style={styles.seg}>
                  {['jp', 'kr'].map(c => (
                    <TouchableOpacity key={c}
                      style={[styles.segBtn, it.country === c && styles.segBtnOn]}
                      onPress={() => { if (it.country === c) return; const u = { ...it, country: c, term: '', price: null, candidates: null, noResult: false, image: it.imageManual ? it.image : '' }; update(it.id, u); queryOne(u); }}
                    >
                      <Text style={[styles.segTxt, it.country === c && styles.segTxtOn]}>
                        {CURRENCY[c].flag} {CURRENCY[c].label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={styles.qty}>
                  <TouchableOpacity style={styles.qtyBtn} onPress={() => update(it.id, { qty: Math.max(1, it.qty - 1) })}>
                    <Text style={styles.qtyBtnTxt}>－</Text>
                  </TouchableOpacity>
                  <Text style={styles.qtyNum}>{it.qty}</Text>
                  <TouchableOpacity style={styles.qtyBtn} onPress={() => update(it.id, { qty: it.qty + 1 })}>
                    <Text style={styles.qtyBtnTxt}>＋</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <Perf style={styles.cardPerf} />

              {state === true ? (
                <View style={styles.rowBot}>
                  <ActivityIndicator size="small" color={C.rose} />
                  <Text style={styles.loadingTxt}>查價中…</Text>
                </View>
              ) : it.price ? (
                <View style={styles.rowBot}>
                  <TouchableOpacity style={{ flex: 1 }} onPress={() => openPicker(it)} activeOpacity={0.7}>
                    <Text style={styles.priceMain}>
                      <Text style={styles.priceLocal}>{it.price.currency}{fmt(it.price.price)}</Text>
                      <Text style={styles.twd}>　NT${fmt(it.price.twd)}</Text>
                    </Text>
                    <Text style={styles.pickedTitle} numberOfLines={1}>✓ {it.price.title}　<Text style={styles.changeHint}>▾ 換一個</Text></Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.reBtn} onPress={() => queryOne(it)} activeOpacity={0.7}>
                    <Text style={styles.reBtnTxt}>↻</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.rowBot}>
                  <Text style={[styles.flex1, state === 'err' ? styles.errTxt : it.noResult ? styles.errTxt : styles.noPrice]}>
                    {state === 'err' ? '連線出錯，再試一次' : it.noResult ? '查無結果，改搜尋字再查' : '還沒查價'}
                  </Text>
                  <TouchableOpacity style={styles.queryBtn} onPress={() => queryOne(it)} activeOpacity={0.85}>
                    <Text style={styles.queryBtnTxt}>查價</Text>
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.footer}>
        <Perf style={{ marginHorizontal: 0, marginBottom: 12 }} />
        <View style={styles.footRow}>
          <View>
            <Text style={styles.footLabel}>待買預估</Text>
            <Text style={styles.footTodo}>NT${fmt(totals.todo)}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.footLabel}>已買</Text>
            <Text style={styles.footDone}>NT${fmt(totals.done)}</Text>
          </View>
        </View>
      </View>

      <Modal visible={!!picker} transparent animationType="slide" onRequestClose={() => setPicker(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalGrip} />
            <View style={styles.modalHead}>
              <View>
                <Text style={styles.modalKicker}>選一個 · {picker?.name}</Text>
                <Text style={styles.modalTitle}>哪個是你要買的？</Text>
              </View>
              <TouchableOpacity onPress={() => setPicker(null)} hitSlop={8}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 440 }} showsVerticalScrollIndicator={false}>
              {picker?.candidates.map((c, i) => (
                <TouchableOpacity key={i} style={styles.cand} onPress={() => choosePick(c)} activeOpacity={0.7}>
                  {c.image
                    ? <TouchableOpacity onPress={() => setZoom({ url: c.image })} activeOpacity={0.8}>
                        <Image source={{ uri: c.image }} style={styles.candImg} />
                      </TouchableOpacity>
                    : <View style={styles.candImg} />}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.candTitle} numberOfLines={2}>{c.title}</Text>
                    <Text style={styles.candPrice}>
                      {picker.currency}{fmt(c.price)}<Text style={styles.candTwd}>　NT${fmt(c.twd)}</Text>
                    </Text>
                  </View>
                  <Text style={styles.candPick}>選</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* 圖片放大燈箱 */}
      <Modal visible={!!zoom} transparent animationType="fade" onRequestClose={() => setZoom(null)}>
        <TouchableOpacity style={styles.zoomBackdrop} activeOpacity={1} onPress={() => setZoom(null)}>
          {zoom?.url ? <Image source={{ uri: zoom.url }} style={styles.zoomImg} resizeMode="contain" /> : null}
          <View style={styles.zoomBar}>
            {zoom?.itemId ? (
              <TouchableOpacity style={styles.zoomReplace} onPress={() => { const id = zoom.itemId; setZoom(null); pickImage(id); }}>
                <Text style={styles.zoomReplaceTxt}>換成自己的圖</Text>
              </TouchableOpacity>
            ) : <View />}
            <TouchableOpacity style={styles.zoomClose} onPress={() => setZoom(null)}>
              <Text style={styles.zoomCloseTxt}>關閉 ✕</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const C = {
  paper: '#FBF6F1', surface: '#FFFFFF', ink: '#211C1A', inkSoft: '#5C534D',
  rose: '#E8467E', roseSoft: '#FCE7EF', navy: '#22324F', muted: '#A89E95', line: '#ECE4DC',
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.paper, paddingTop: Platform.OS === 'android' ? 28 : 0 },

  header: { paddingHorizontal: 22, paddingTop: 18, paddingBottom: 12 },
  wordmark: { color: C.ink, fontSize: 30, fontWeight: '900', letterSpacing: 2 },
  eyebrow: { color: C.navy, fontFamily: MONO, fontSize: 11, marginTop: 7, letterSpacing: 1.5 },

  perf: { borderTopWidth: 1.5, borderTopColor: C.line, borderStyle: 'dashed', marginHorizontal: 22, height: 1 },

  addBar: { flexDirection: 'row', paddingHorizontal: 22, gap: 9, marginTop: 16 },
  addInput: { flex: 1, backgroundColor: C.surface, borderRadius: 13, paddingHorizontal: 15, paddingVertical: 13, color: C.ink, fontSize: 16, borderWidth: 1.5, borderColor: C.line },
  addBtn: { backgroundColor: C.rose, borderRadius: 13, paddingHorizontal: 24, justifyContent: 'center', shadowColor: C.rose, shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  addBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 16, letterSpacing: 2 },

  list: { flex: 1, paddingHorizontal: 22, marginTop: 16 },
  emptyWrap: { alignItems: 'center', marginTop: 64 },
  emptyBig: { color: C.ink, fontSize: 22, fontWeight: '800', letterSpacing: 2 },
  empty: { color: C.muted, textAlign: 'center', marginTop: 10, fontSize: 14, lineHeight: 24 },

  card: { backgroundColor: C.surface, borderRadius: 18, padding: 16, marginBottom: 13, borderWidth: 1.5, borderColor: C.line, shadowColor: '#3a2a20', shadowOpacity: 0.05, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 1 },
  cardDone: { backgroundColor: '#FBF8F4', opacity: 0.65 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  check: { width: 27, height: 27, borderRadius: 9, borderWidth: 2, borderColor: '#D8D0C8', alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: C.navy, borderColor: C.navy },
  checkTxt: { color: '#fff', fontWeight: '900', fontSize: 15 },
  thumbWrap: { width: 48, height: 48, borderRadius: 11, backgroundColor: C.paper, borderWidth: 1.5, borderColor: C.line, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  thumb: { width: 48, height: 48 },
  thumbPlus: { fontSize: 11, color: C.muted, fontWeight: '700' },
  name: { flex: 1, color: C.ink, fontSize: 17, fontWeight: '800' },
  nameDone: { textDecorationLine: 'line-through', color: C.muted },
  del: { color: '#cabfb6', fontSize: 16, paddingHorizontal: 2 },

  note: { marginTop: 11, backgroundColor: C.paper, borderRadius: 11, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: C.ink, borderWidth: 1, borderColor: C.line },
  termRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 9 },
  termLabel: { fontFamily: MONO, fontSize: 10, color: C.rose, letterSpacing: 1, fontWeight: '700' },
  termInput: { flex: 1, backgroundColor: C.roseSoft, borderRadius: 9, paddingHorizontal: 11, paddingVertical: 7, fontSize: 14, color: C.ink },

  rowMid: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 13 },
  seg: { flexDirection: 'row', backgroundColor: C.paper, borderRadius: 10, padding: 3, borderWidth: 1, borderColor: C.line },
  segBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  segBtnOn: { backgroundColor: C.navy },
  segTxt: { color: C.muted, fontSize: 13, fontWeight: '700' },
  segTxtOn: { color: '#fff' },
  qty: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  qtyBtn: { width: 31, height: 31, borderRadius: 9, backgroundColor: C.paper, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  qtyBtnTxt: { color: C.ink, fontSize: 17, fontWeight: '800' },
  qtyNum: { color: C.ink, fontSize: 16, fontWeight: '800', minWidth: 22, textAlign: 'center', fontFamily: MONO },

  cardPerf: { marginHorizontal: 0, marginTop: 14 },
  rowBot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, gap: 10 },
  priceMain: { color: C.ink },
  priceLocal: { fontFamily: MONO, fontSize: 16, color: C.inkSoft, fontWeight: '700' },
  twd: { fontFamily: MONO, color: C.rose, fontWeight: '800', fontSize: 18 },
  pickedTitle: { color: C.muted, fontSize: 11, marginTop: 3 },
  noPrice: { color: '#c1b7ae', fontSize: 14 },
  errTxt: { color: C.rose, fontSize: 13, fontWeight: '600' },
  queryBtn: { backgroundColor: C.rose, borderRadius: 11, paddingHorizontal: 20, paddingVertical: 10, minWidth: 72, alignItems: 'center' },
  queryBtnTxt: { color: '#fff', fontWeight: '800', fontSize: 14, letterSpacing: 2 },
  loadingTxt: { color: C.muted, fontSize: 14, marginLeft: 9, fontWeight: '600' },
  changeHint: { color: C.rose, fontSize: 11, fontWeight: '700' },
  reBtn: { width: 40, height: 40, borderRadius: 11, backgroundColor: C.paper, borderWidth: 1.5, borderColor: C.line, alignItems: 'center', justifyContent: 'center' },
  reBtnTxt: { color: C.inkSoft, fontSize: 18, fontWeight: '800' },
  flex1: { flex: 1 },

  footer: { paddingHorizontal: 22, paddingTop: 4, paddingBottom: 16, backgroundColor: C.paper },
  footRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  footLabel: { color: C.muted, fontSize: 11, fontFamily: MONO, letterSpacing: 1.5 },
  footTodo: { color: C.rose, fontSize: 27, fontWeight: '900', fontFamily: MONO, marginTop: 2 },
  footDone: { color: C.navy, fontSize: 19, fontWeight: '800', fontFamily: MONO, marginTop: 2 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(33,28,26,0.5)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: C.surface, borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 20, paddingBottom: 30 },
  modalGrip: { width: 42, height: 4, borderRadius: 2, backgroundColor: C.line, alignSelf: 'center', marginBottom: 14 },
  modalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  modalKicker: { color: C.rose, fontFamily: MONO, fontSize: 11, letterSpacing: 1, fontWeight: '700' },
  modalTitle: { fontSize: 20, fontWeight: '900', color: C.ink, marginTop: 3, letterSpacing: 1 },
  modalClose: { fontSize: 18, color: C.muted, padding: 2 },
  cand: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: C.line },
  candImg: { width: 54, height: 54, borderRadius: 10, backgroundColor: C.paper, borderWidth: 1, borderColor: C.line },
  candTitle: { color: C.ink, fontSize: 14, fontWeight: '600', lineHeight: 19 },
  candPrice: { color: C.inkSoft, fontSize: 14, fontWeight: '700', marginTop: 4, fontFamily: MONO },
  candTwd: { color: C.rose, fontSize: 14, fontWeight: '800', fontFamily: MONO },
  candPick: { color: C.rose, fontWeight: '800', fontSize: 13, letterSpacing: 1, borderWidth: 1.5, borderColor: C.rose, borderRadius: 8, paddingHorizontal: 11, paddingVertical: 6 },

  zoomBackdrop: { flex: 1, backgroundColor: 'rgba(20,16,14,0.94)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  zoomImg: { width: '100%', height: '78%' },
  zoomBar: { position: 'absolute', bottom: 36, left: 20, right: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  zoomReplace: { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.6)', borderRadius: 11, paddingHorizontal: 16, paddingVertical: 10 },
  zoomReplaceTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },
  zoomClose: { backgroundColor: C.rose, borderRadius: 11, paddingHorizontal: 18, paddingVertical: 10 },
  zoomCloseTxt: { color: '#fff', fontWeight: '800', fontSize: 14, letterSpacing: 1 },
});

