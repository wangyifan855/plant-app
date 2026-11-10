import React, { useState } from 'react';
import { View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { getVarietyNames, rootstockLabel, getVarietyMeta } from '../lib/varieties';

// 品种选择：内置列表支持搜索过滤（A2.1）；也可切换为手动输入未收录品种（A2.2）。
// kinds='crop' 只显示栽培品种（当接穗用）；'all' 连嫁接砧木一起显示（chip 带 ·砧 标记）。
export default function VarietyPicker({ label, value, onChange, kinds = 'all' }) {
  const [manual, setManual] = useState(false);
  const [filter, setFilter] = useState('');
  // 砧木模式下砧木排最前（选砧木时九成是奔着专用砧木去的，别让人划过 14 种作物）
  const entries = getVarietyNames()
    .filter((n) => (kinds === 'crop' ? getVarietyMeta(n)?.role !== 'rootstock' : true))
    .map((n) => ({ name: n, display: rootstockLabel(n), isStock: getVarietyMeta(n)?.role === 'rootstock' }))
    .sort((a, b) => (kinds === 'all' ? (b.isStock ? 1 : 0) - (a.isStock ? 1 : 0) : 0));

  const filtered = entries.filter((e) => e.name.includes(filter.trim()));

  if (manual) {
    return (
      <View style={styles.box}>
        <Text style={styles.label}>{label}（手动输入）</Text>
        <TextInput
          style={styles.input}
          value={value}
          placeholder="输入品种名称"
          onChangeText={onChange}
        />
        <TouchableOpacity onPress={() => setManual(false)}>
          <Text style={styles.link}>从内置列表选择</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.box}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={filter}
        placeholder="搜索品种"
        onChangeText={setFilter}
      />
      <ScrollView horizontal style={styles.chips} showsHorizontalScrollIndicator={false}>
        {filtered.map((e) => (
          <TouchableOpacity
            key={e.name}
            style={[styles.chip, value === e.name && styles.chipActive]}
            onPress={() => onChange(e.name)}
          >
            <Text style={[styles.chipText, value === e.name && styles.chipTextActive]}>
              {e.display}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <TouchableOpacity onPress={() => { setManual(true); onChange(''); }}>
        <Text style={styles.link}>未找到？手动输入</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { marginBottom: 12 },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 6 },
  input: {
    borderWidth: 1, borderColor: '#ccc', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8, fontSize: 15,
  },
  chips: { flexDirection: 'row', marginTop: 8 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
    backgroundColor: '#eee', marginRight: 8,
  },
  chipActive: { backgroundColor: '#2e7d32' },
  chipText: { fontSize: 14, color: '#333' },
  chipTextActive: { color: '#fff' },
  link: { color: '#2e7d32', fontSize: 13, marginTop: 6 },
});
