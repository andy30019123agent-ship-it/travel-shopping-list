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

// 撈候選商品：韓國用後端、日本用前端直連樂天
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
  return { term, currency, candidates: cands };
}

export default function App() {
  const [items, setItems] = useState([]);
  const [input, setInput] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState({});
  const [picker, setPicker] = useState(null); // { itemId, currency, candidates }

  useEffect(() => {
    AsyncStorage.getItem(STORE_KEY).then(raw => {
      if (raw) setItems(JSON.parse(raw));
      setLoaded(true);
    });
  }, []);
  useEffect(() => {
    if (loaded) AsyncStorage.setItem(STORE_KEY, JSON.stringify(items));
  }, [items, loaded]);

  const update = (id, patch) =>
    setItems(prev => prev.map(it => (it.id === id ? { ...it, ...patch } : it)));
  const remove = id => setItems(prev => prev.filter(it => it.id !== id));

  const addItem = () => {
    const name = input.trim();
    if (!name) return;
    setItems(prev => [
      { id: Date.now().toString(), name, country: 'jp', qty: 1, note: '', term: '', image: '', imageManual: false, purchased: false, price: null },
      ...prev,
    ]);
    setInput('');
  };

  async function queryOne(item) {
    setBusy(b => ({ ...b, [item.id]: true }));
    try {
      const { term, currency, candidates } = await fetchCandidates(item);
      update(item.id, { term });
      if (!candidates.length) {
        update(item.id, { noResult: true });
      } else {
        setPicker({ itemId: item.id, currency, candidates });
      }
    } catch (e) {
      setBusy(b => ({ ...b, [item.id]: 'err' }));
      setTimeout(() => setBusy(b => ({ ...b, [item.id]: false })), 2500);
      return;
    }
    setBusy(b => ({ ...b, [item.id]: false }));
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
        <Text style={styles.title}>免稅不是免費</Text>
        <Text style={styles.sub}>出國購物清單 ・ 日本 / 韓國 ・ 即時參考價</Text>
      </View>

      <View style={styles.addBar}>
        <TextInput
          style={styles.addInput}
          placeholder="想買什麼？例如：白色戀人"
          placeholderTextColor="#b3b0a8"
          value={input}
          onChangeText={setInput}
          onSubmitEditing={addItem}
          returnKeyType="done"
        />
        <TouchableOpacity style={styles.addBtn} onPress={addItem}>
          <Text style={styles.addBtnTxt}>加入</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 24 }}>
        {items.length === 0 && (
          <Text style={styles.empty}>清單還是空的{'\n'}上面加入第一個想買的東西吧 🛍️</Text>
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
                <TouchableOpacity style={styles.thumbWrap} onPress={() => pickImage(it.id)}>
                  {it.image
                    ? <Image source={{ uri: it.image }} style={styles.thumb} />
                    : <Text style={styles.thumbPlus}>📷</Text>}
                </TouchableOpacity>
                <Text style={[styles.name, it.purchased && styles.nameDone]}>{it.name}</Text>
                <TouchableOpacity onPress={() => remove(it.id)} hitSlop={8}>
                  <Text style={styles.del}>✕</Text>
                </TouchableOpacity>
              </View>

              <TextInput
                style={styles.note}
                placeholder="📝 備註，例如：給媽媽 / 要無香料款"
                placeholderTextColor="#bdbab2"
                value={it.note}
                onChangeText={t => update(it.id, { note: t })}
              />

              {(it.term || it.price) ? (
                <View style={styles.termRow}>
                  <Text style={styles.termLabel}>🔍</Text>
                  <TextInput
                    style={styles.termInput}
                    value={it.term}
                    placeholder="翻譯後的搜尋字（可改後再查）"
                    placeholderTextColor="#bdbab2"
                    onChangeText={t => update(it.id, { term: t })}
                  />
                </View>
              ) : null}

              <View style={styles.rowMid}>
                <View style={styles.seg}>
                  {['jp', 'kr'].map(c => (
                    <TouchableOpacity key={c}
                      style={[styles.segBtn, it.country === c && styles.segBtnOn]}
                      onPress={() => update(it.id, { country: c, term: '', price: null, noResult: false, image: it.imageManual ? it.image : '' })}
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

              <View style={styles.rowBot}>
                <View style={{ flex: 1 }}>
                  {it.price ? (
                    <>
                      <Text style={styles.priceMain}>
                        {it.price.currency}{fmt(it.price.price)}
                        <Text style={styles.twd}>　約 NT${fmt(it.price.twd)}</Text>
                      </Text>
                      <Text style={styles.pickedTitle} numberOfLines={1}>✓ {it.price.title}</Text>
                    </>
                  ) : state === 'err' ? (
                    <Text style={styles.errTxt}>連線出錯，請再按一次查價</Text>
                  ) : it.noResult ? (
                    <Text style={styles.errTxt}>查無結果 — 改上面 🔍 搜尋字再查</Text>
                  ) : (
                    <Text style={styles.noPrice}>尚未查價</Text>
                  )}
                </View>
                <TouchableOpacity
                  style={[styles.refreshBtn, state === true && styles.refreshBtnBusy]}
                  disabled={state === true}
                  onPress={() => queryOne(it)}
                >
                  {state === true
                    ? <ActivityIndicator size="small" color="#e25a92" />
                    : <Text style={styles.refreshBtnTxt}>{it.price ? '↻ 重選' : '🔍 查價'}</Text>}
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.footer}>
        <View>
          <Text style={styles.footLabel}>待買預估</Text>
          <Text style={styles.footTodo}>NT${fmt(totals.todo)}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.footLabel}>已買</Text>
          <Text style={styles.footDone}>NT${fmt(totals.done)}</Text>
        </View>
      </View>

      {/* 候選商品選擇器 */}
      <Modal visible={!!picker} transparent animationType="slide" onRequestClose={() => setPicker(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHead}>
              <Text style={styles.modalTitle}>選擇正確的商品</Text>
              <TouchableOpacity onPress={() => setPicker(null)} hitSlop={8}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.modalHint}>點一下最接近你要買的那個 👇</Text>
            <ScrollView style={{ maxHeight: 460 }}>
              {picker?.candidates.map((c, i) => (
                <TouchableOpacity key={i} style={styles.cand} onPress={() => choosePick(c)}>
                  {c.image
                    ? <Image source={{ uri: c.image }} style={styles.candImg} />
                    : <View style={styles.candImg} />}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.candTitle} numberOfLines={2}>{c.title}</Text>
                    <Text style={styles.candPrice}>
                      {picker.currency}{fmt(c.price)} <Text style={styles.candTwd}>約 NT${fmt(c.twd)}</Text>
                    </Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const C = {
  bg: '#f7f6f3', card: '#ffffff', border: '#ebe8e2',
  text: '#1f1f1d', muted: '#9a978f', accent: '#e25a92',
  accentSoft: '#fce8f1', green: '#c24d86',
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg, paddingTop: Platform.OS === 'android' ? 28 : 0 },
  header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 14 },
  title: { color: C.text, fontSize: 26, fontWeight: '800', letterSpacing: 1 },
  sub: { color: C.muted, fontSize: 13, marginTop: 4, letterSpacing: 0.3 },

  addBar: { flexDirection: 'row', paddingHorizontal: 20, gap: 8 },
  addInput: { flex: 1, backgroundColor: C.card, borderRadius: 12, paddingHorizontal: 15, paddingVertical: 13, color: C.text, fontSize: 16, borderWidth: 1, borderColor: C.border },
  addBtn: { backgroundColor: C.accent, borderRadius: 12, paddingHorizontal: 22, justifyContent: 'center' },
  addBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 16 },

  list: { flex: 1, paddingHorizontal: 20, marginTop: 12 },
  empty: { color: C.muted, textAlign: 'center', marginTop: 70, fontSize: 15, lineHeight: 26 },

  card: { backgroundColor: C.card, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: C.border, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 1 },
  cardDone: { backgroundColor: '#fbfaf8', opacity: 0.7 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  check: { width: 26, height: 26, borderRadius: 8, borderWidth: 2, borderColor: '#d6d3cc', alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: C.green, borderColor: C.green },
  checkTxt: { color: '#fff', fontWeight: '900', fontSize: 15 },
  thumbWrap: { width: 46, height: 46, borderRadius: 10, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  thumb: { width: 46, height: 46 },
  thumbPlus: { fontSize: 18, opacity: 0.5 },
  name: { flex: 1, color: C.text, fontSize: 17, fontWeight: '700' },
  nameDone: { textDecorationLine: 'line-through', color: C.muted },
  del: { color: '#c2bfb7', fontSize: 16, paddingHorizontal: 2 },

  note: { marginTop: 10, backgroundColor: C.bg, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, fontSize: 14, color: C.text, borderWidth: 1, borderColor: C.border },
  termRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  termLabel: { fontSize: 14 },
  termInput: { flex: 1, backgroundColor: C.accentSoft, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, fontSize: 14, color: C.text },

  rowMid: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  seg: { flexDirection: 'row', backgroundColor: C.bg, borderRadius: 9, padding: 3, borderWidth: 1, borderColor: C.border },
  segBtn: { paddingHorizontal: 11, paddingVertical: 6, borderRadius: 7 },
  segBtnOn: { backgroundColor: C.accent },
  segTxt: { color: C.muted, fontSize: 13, fontWeight: '600' },
  segTxtOn: { color: '#fff' },
  qty: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  qtyBtn: { width: 30, height: 30, borderRadius: 8, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  qtyBtnTxt: { color: C.text, fontSize: 17, fontWeight: '700' },
  qtyNum: { color: C.text, fontSize: 16, fontWeight: '700', minWidth: 22, textAlign: 'center' },

  rowBot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 11, gap: 10 },
  priceMain: { color: C.text, fontSize: 17, fontWeight: '800' },
  twd: { color: C.accent, fontWeight: '800' },
  pickedTitle: { color: C.muted, fontSize: 11, marginTop: 2 },
  noPrice: { color: '#bdbab2', fontSize: 14, fontStyle: 'italic' },
  errTxt: { color: '#c2557a', fontSize: 13 },
  refreshBtn: { backgroundColor: C.accentSoft, borderRadius: 9, paddingHorizontal: 14, paddingVertical: 8, minWidth: 64, alignItems: 'center' },
  refreshBtnBusy: { opacity: 0.7 },
  refreshBtnTxt: { color: C.accent, fontWeight: '700', fontSize: 13 },

  footer: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 22, paddingVertical: 15, borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.card },
  footLabel: { color: C.muted, fontSize: 12 },
  footTodo: { color: C.accent, fontSize: 22, fontWeight: '800' },
  footDone: { color: C.green, fontSize: 22, fontWeight: '800' },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(31,31,29,0.45)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: C.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, paddingBottom: 28 },
  modalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modalTitle: { fontSize: 18, fontWeight: '800', color: C.text },
  modalClose: { fontSize: 18, color: C.muted },
  modalHint: { color: C.muted, fontSize: 13, marginTop: 4, marginBottom: 12 },
  cand: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  candImg: { width: 52, height: 52, borderRadius: 8, backgroundColor: C.bg },
  candTitle: { color: C.text, fontSize: 14, fontWeight: '600' },
  candPrice: { color: C.text, fontSize: 15, fontWeight: '700', marginTop: 3 },
  candTwd: { color: C.accent, fontSize: 13, fontWeight: '700' },
});
