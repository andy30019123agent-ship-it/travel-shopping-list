import { useEffect, useMemo, useState } from 'react';
import {
  SafeAreaView, View, Text, TextInput, TouchableOpacity,
  ScrollView, StyleSheet, StatusBar, Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORE_KEY = 'travel-shopping-list-v1';

// 匯率（示範用，之後接真實匯率 API）
const RATES = { jpy: 0.215, krw: 0.0234 };
const CURRENCY = {
  jp: { code: 'jpy', symbol: '¥', flag: '🇯🇵', label: '日本' },
  kr: { code: 'krw', symbol: '₩', flag: '🇰🇷', label: '韓國' },
};

// 假價格：之後換成樂天 / Naver 真實資料
function fakePrice(name, country) {
  const seed = [...name].reduce((s, c) => s + c.charCodeAt(0), 0);
  const unit = country === 'jp' ? 60 : 700;
  const median = unit * (3 + (seed % 18));
  const min = Math.round(median * 0.82);
  const max = Math.round(median * 1.24);
  return { min, max, median, currency: CURRENCY[country].code };
}

const fmt = n => n.toLocaleString('en-US');
const toTWD = (amount, code) => Math.round(amount * RATES[code]);

export default function App() {
  const [items, setItems] = useState([]);
  const [input, setInput] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORE_KEY).then(raw => {
      if (raw) setItems(JSON.parse(raw));
      setLoaded(true);
    });
  }, []);
  useEffect(() => {
    if (loaded) AsyncStorage.setItem(STORE_KEY, JSON.stringify(items));
  }, [items, loaded]);

  const addItem = () => {
    const name = input.trim();
    if (!name) return;
    setItems(prev => [
      { id: Date.now().toString(), name, country: 'jp', qty: 1, note: '', purchased: false, price: null },
      ...prev,
    ]);
    setInput('');
  };

  const update = (id, patch) =>
    setItems(prev => prev.map(it => (it.id === id ? { ...it, ...patch } : it)));
  const remove = id => setItems(prev => prev.filter(it => it.id !== id));

  const refreshOne = id =>
    setItems(prev => prev.map(it =>
      it.id === id ? { ...it, price: fakePrice(it.name, it.country) } : it));
  const refreshAll = () =>
    setItems(prev => prev.map(it => ({ ...it, price: fakePrice(it.name, it.country) })));

  const totals = useMemo(() => {
    let todo = 0, done = 0;
    for (const it of items) {
      if (!it.price) continue;
      const t = toTWD(it.price.median, it.price.currency) * it.qty;
      if (it.purchased) done += t; else todo += t;
    }
    return { todo, done };
  }, [items]);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.header}>
        <Text style={styles.title}>免稅不是免費</Text>
        <Text style={styles.sub}>出國購物清單 ・ 日本 / 韓國</Text>
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

      {items.length > 0 && (
        <TouchableOpacity style={styles.refreshAll} onPress={refreshAll}>
          <Text style={styles.refreshAllTxt}>↻ 全部重整價格</Text>
        </TouchableOpacity>
      )}

      <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 24 }}>
        {items.length === 0 && (
          <Text style={styles.empty}>清單還是空的{'\n'}上面加入第一個想買的東西吧 🛍️</Text>
        )}
        {items.map(it => {
          const cur = CURRENCY[it.country];
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
                <Text style={[styles.name, it.purchased && styles.nameDone]}>{it.name}</Text>
                <TouchableOpacity onPress={() => remove(it.id)} hitSlop={8}>
                  <Text style={styles.del}>✕</Text>
                </TouchableOpacity>
              </View>

              <TextInput
                style={styles.note}
                placeholder="📝 備註，例如：給媽媽 / 要無香料款 / 比台灣便宜再買"
                placeholderTextColor="#bdbab2"
                value={it.note}
                onChangeText={t => update(it.id, { note: t })}
              />

              <View style={styles.rowMid}>
                <View style={styles.seg}>
                  {['jp', 'kr'].map(c => (
                    <TouchableOpacity key={c}
                      style={[styles.segBtn, it.country === c && styles.segBtnOn]}
                      onPress={() => update(it.id, { country: c, price: null })}
                    >
                      <Text style={[styles.segTxt, it.country === c && styles.segTxtOn]}>
                        {CURRENCY[c].flag} {CURRENCY[c].label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={styles.qty}>
                  <TouchableOpacity style={styles.qtyBtn}
                    onPress={() => update(it.id, { qty: Math.max(1, it.qty - 1) })}>
                    <Text style={styles.qtyBtnTxt}>－</Text>
                  </TouchableOpacity>
                  <Text style={styles.qtyNum}>{it.qty}</Text>
                  <TouchableOpacity style={styles.qtyBtn}
                    onPress={() => update(it.id, { qty: it.qty + 1 })}>
                    <Text style={styles.qtyBtnTxt}>＋</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.rowBot}>
                {it.price ? (
                  <View style={{ flex: 1 }}>
                    <Text style={styles.priceRange}>
                      {cur.symbol}{fmt(it.price.min)}–{cur.symbol}{fmt(it.price.max)}
                    </Text>
                    <Text style={styles.priceMed}>
                      中位 {cur.symbol}{fmt(it.price.median)}
                      <Text style={styles.twd}>　約 NT${fmt(toTWD(it.price.median, it.price.currency))}</Text>
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.noPrice}>尚未查價</Text>
                )}
                <TouchableOpacity style={styles.refreshBtn} onPress={() => refreshOne(it.id)}>
                  <Text style={styles.refreshBtnTxt}>↻ 查價</Text>
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
  sub: { color: C.muted, fontSize: 13, marginTop: 4, letterSpacing: 0.5 },

  addBar: { flexDirection: 'row', paddingHorizontal: 20, gap: 8 },
  addInput: {
    flex: 1, backgroundColor: C.card, borderRadius: 12, paddingHorizontal: 15,
    paddingVertical: 13, color: C.text, fontSize: 16, borderWidth: 1, borderColor: C.border,
  },
  addBtn: { backgroundColor: C.accent, borderRadius: 12, paddingHorizontal: 22, justifyContent: 'center' },
  addBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 16 },

  refreshAll: { alignSelf: 'flex-end', marginRight: 20, marginTop: 12 },
  refreshAllTxt: { color: C.accent, fontWeight: '600', fontSize: 13 },

  list: { flex: 1, paddingHorizontal: 20, marginTop: 8 },
  empty: { color: C.muted, textAlign: 'center', marginTop: 70, fontSize: 15, lineHeight: 26 },

  card: {
    backgroundColor: C.card, borderRadius: 16, padding: 16, marginBottom: 12,
    borderWidth: 1, borderColor: C.border,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 1,
  },
  cardDone: { backgroundColor: '#fbfaf8', opacity: 0.7 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  check: { width: 26, height: 26, borderRadius: 8, borderWidth: 2, borderColor: '#d6d3cc', alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: C.green, borderColor: C.green },
  checkTxt: { color: '#fff', fontWeight: '900', fontSize: 15 },
  name: { flex: 1, color: C.text, fontSize: 17, fontWeight: '700' },
  nameDone: { textDecorationLine: 'line-through', color: C.muted },
  del: { color: '#c2bfb7', fontSize: 16, paddingHorizontal: 2 },

  note: {
    marginTop: 10, backgroundColor: C.bg, borderRadius: 10, paddingHorizontal: 12,
    paddingVertical: 9, fontSize: 14, color: C.text, borderWidth: 1, borderColor: C.border,
  },

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

  rowBot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 11 },
  priceRange: { color: C.text, fontSize: 16, fontWeight: '700' },
  priceMed: { color: C.muted, fontSize: 13, marginTop: 2 },
  twd: { color: C.accent, fontWeight: '800' },
  noPrice: { color: '#bdbab2', fontSize: 14, fontStyle: 'italic' },
  refreshBtn: { backgroundColor: C.accentSoft, borderRadius: 9, paddingHorizontal: 14, paddingVertical: 8 },
  refreshBtnTxt: { color: C.accent, fontWeight: '700', fontSize: 13 },

  footer: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 22, paddingVertical: 15, borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.card },
  footLabel: { color: C.muted, fontSize: 12 },
  footTodo: { color: C.accent, fontSize: 22, fontWeight: '800' },
  footDone: { color: C.green, fontSize: 22, fontWeight: '800' },
});
