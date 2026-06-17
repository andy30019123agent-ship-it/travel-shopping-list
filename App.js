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
  const unit = country === 'jp' ? 60 : 700; // 大略單位
  const median = unit * (3 + (seed % 18));   // 中位數
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

  // 載入
  useEffect(() => {
    AsyncStorage.getItem(STORE_KEY).then(raw => {
      if (raw) setItems(JSON.parse(raw));
      setLoaded(true);
    });
  }, []);
  // 儲存
  useEffect(() => {
    if (loaded) AsyncStorage.setItem(STORE_KEY, JSON.stringify(items));
  }, [items, loaded]);

  const addItem = () => {
    const name = input.trim();
    if (!name) return;
    setItems(prev => [
      { id: Date.now().toString(), name, country: 'jp', qty: 1, purchased: false, price: null },
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
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <Text style={styles.title}>🧳 出國購物清單</Text>
        <Text style={styles.sub}>日本 · 韓國 ・ 價格為示範假資料</Text>
      </View>

      <View style={styles.addBar}>
        <TextInput
          style={styles.addInput}
          placeholder="輸入想買的東西，例如：白色戀人"
          placeholderTextColor="#9aa6bb"
          value={input}
          onChangeText={setInput}
          onSubmitEditing={addItem}
          returnKeyType="done"
        />
        <TouchableOpacity style={styles.addBtn} onPress={addItem}>
          <Text style={styles.addBtnTxt}>＋ 加入</Text>
        </TouchableOpacity>
      </View>

      {items.length > 0 && (
        <TouchableOpacity style={styles.refreshAll} onPress={refreshAll}>
          <Text style={styles.refreshAllTxt}>🔄 全部重整價格</Text>
        </TouchableOpacity>
      )}

      <ScrollView style={styles.list} contentContainerStyle={{ paddingBottom: 24 }}>
        {items.length === 0 && (
          <Text style={styles.empty}>清單還是空的，上面加入第一個想買的東西吧 🛍️</Text>
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
                <TouchableOpacity onPress={() => remove(it.id)}>
                  <Text style={styles.del}>✕</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.rowMid}>
                {/* 國家切換 */}
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
                {/* 數量 */}
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
                  <Text style={styles.refreshBtnTxt}>🔄 查價</Text>
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0f1420', paddingTop: Platform.OS === 'android' ? 28 : 0 },
  header: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 12 },
  title: { color: '#fff', fontSize: 24, fontWeight: '800' },
  sub: { color: '#8b97ab', fontSize: 13, marginTop: 3 },

  addBar: { flexDirection: 'row', paddingHorizontal: 18, gap: 8 },
  addInput: {
    flex: 1, backgroundColor: '#1b2230', borderRadius: 12, paddingHorizontal: 14,
    paddingVertical: 12, color: '#eaeef6', fontSize: 16, borderWidth: 1, borderColor: '#2a3447',
  },
  addBtn: { backgroundColor: '#4f8cff', borderRadius: 12, paddingHorizontal: 16, justifyContent: 'center' },
  addBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },

  refreshAll: { alignSelf: 'flex-end', marginRight: 18, marginTop: 10 },
  refreshAllTxt: { color: '#4f8cff', fontWeight: '600', fontSize: 13 },

  list: { flex: 1, paddingHorizontal: 18, marginTop: 8 },
  empty: { color: '#8b97ab', textAlign: 'center', marginTop: 60, fontSize: 15, lineHeight: 24 },

  card: { backgroundColor: '#141a26', borderRadius: 16, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: '#222c3d' },
  cardDone: { opacity: 0.6 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  check: { width: 26, height: 26, borderRadius: 8, borderWidth: 2, borderColor: '#3a4a66', alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  checkTxt: { color: '#fff', fontWeight: '900', fontSize: 15 },
  name: { flex: 1, color: '#eaeef6', fontSize: 17, fontWeight: '700' },
  nameDone: { textDecorationLine: 'line-through', color: '#8b97ab' },
  del: { color: '#6b7689', fontSize: 16, paddingHorizontal: 4 },

  rowMid: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  seg: { flexDirection: 'row', backgroundColor: '#1b2230', borderRadius: 9, padding: 3 },
  segBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 7 },
  segBtnOn: { backgroundColor: '#4f8cff' },
  segTxt: { color: '#8b97ab', fontSize: 13, fontWeight: '600' },
  segTxtOn: { color: '#fff' },
  qty: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  qtyBtn: { width: 30, height: 30, borderRadius: 8, backgroundColor: '#1b2230', alignItems: 'center', justifyContent: 'center' },
  qtyBtnTxt: { color: '#eaeef6', fontSize: 18, fontWeight: '700' },
  qtyNum: { color: '#eaeef6', fontSize: 16, fontWeight: '700', minWidth: 22, textAlign: 'center' },

  rowBot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, borderTopWidth: 1, borderTopColor: '#222c3d', paddingTop: 10 },
  priceRange: { color: '#eaeef6', fontSize: 16, fontWeight: '700' },
  priceMed: { color: '#8b97ab', fontSize: 13, marginTop: 2 },
  twd: { color: '#f5b942', fontWeight: '700' },
  noPrice: { color: '#6b7689', fontSize: 14, fontStyle: 'italic' },
  refreshBtn: { backgroundColor: '#1b2230', borderRadius: 9, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: '#2a3447' },
  refreshBtnTxt: { color: '#4f8cff', fontWeight: '600', fontSize: 13 },

  footer: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 14, borderTopWidth: 1, borderTopColor: '#222c3d', backgroundColor: '#11161f' },
  footLabel: { color: '#8b97ab', fontSize: 12 },
  footTodo: { color: '#4f8cff', fontSize: 22, fontWeight: '800' },
  footDone: { color: '#16a34a', fontSize: 22, fontWeight: '800' },
});
