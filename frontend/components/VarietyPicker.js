import React, { useState } from 'react';
import { View, Text, TextInput, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { getVarietyNames } from '../lib/varieties';

// 品种选择：内置列表支持搜索过滤（A2.1）；也可切换为手动输入未收录品种（A2.2）。
export default function VarietyPicker({ label, value, onChange }) {
  const [manual, setManual] = useState(false);
  const [filter, setFilter] = useState('');
  const names = getVarietyNames();

  const filtered = names.filter((n) => n.includes(filter.trim()));

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
        {filtered.map((n) => (
          <TouchableOpacity
            key={n}
            style={[styles.chip, value === n && styles.chipActive]}
            onPress={() => onChange(n)}
          >
            <Text style={[styles.chipText, value === n && styles.chipTextActive]}>{n}</Text>
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
