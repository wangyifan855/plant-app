import React, { useState } from 'react';
import {
  View, Text, Image, TouchableOpacity, TextInput, ScrollView,
  ActivityIndicator, Alert, StyleSheet,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { compressImage, isLowQuality } from '../lib/compress';
import { analyze } from '../lib/api';
import { TIERS } from '../lib/tiers';
import VarietyPicker from '../components/VarietyPicker';

const ICON_CAM = require('../assets/icon_camera.png');
const ICON_ALB = require('../assets/icon_album.png');

// 每种材料 = 1 张必填照片 + 1 个选填品种，成组展示，避免"又要拍照又要选品种"的困惑
const MATERIALS = [
  { key: 'scion', title: '接穗', tip: '要接到上面的那段枝条' },
  { key: 'rootstock', title: '砧木', tip: '下面带根的植株' },
];

export default function AnalyzeScreen() {
  const [images, setImages] = useState({ scion: null, rootstock: null });
  const [varieties, setVarieties] = useState({ scion: '', rootstock: '' });
  const [temperature, setTemperature] = useState('');
  const [soilType, setSoilType] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  async function pick(slot, source) {
    const opts = {
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsEditing: true,
    };
    const res = source === 'camera'
      ? await ImagePicker.launchCameraAsync(opts)
      : await ImagePicker.launchImageLibraryAsync(opts);
    if (res.canceled || !res.assets?.length) return;

    const asset = res.assets[0];
    const comp = await compressImage(asset.uri, asset.width, asset.height);
    setImages((prev) => ({ ...prev, [slot]: comp }));
    setError('');
  }

  function validate() {
    if (!images.scion || !images.rootstock) return '照片是必填的：接穗和砧木各需要 1 张';
    if (isLowQuality(images.scion.width, images.scion.height) ||
        isLowQuality(images.rootstock.width, images.rootstock.height)) {
      return '有图片分辨率过低，请重新拍摄或选择更清晰的图片';
    }
    return '';
  }

  async function submit() {
    const msg = validate();
    if (msg) { setError(msg); return; }
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const data = await analyze({
        scionImage: images.scion,
        rootstockImage: images.rootstock,
        scionVariety: varieties.scion,
        rootstockVariety: varieties.rootstock,
        temperature: temperature || undefined,
        soilType: soilType || undefined,
      });
      setResult(data);
    } catch (e) {
      setError(e.message || '分析失败，请重试');
    } finally {
      setLoading(false);
    }
  }

  if (result) {
    return <ResultView result={result} onReset={() => setResult(null)} />;
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.h1}>嫁接材料初筛</Text>

      <View style={styles.guide}>
        <Text style={styles.guideTitle}>只需要 2 张照片</Text>
        <Text style={styles.guideLine}>
          <Text style={styles.guideStrong}>必填</Text>：接穗、砧木各 1 张照片 —— 系统靠它查病害、认品种
        </Text>
        <Text style={styles.guideLine}>
          <Text style={styles.guideOptional}>选填</Text>：品种、温度、土壤 —— 不填也能出结果，填了更准
        </Text>
      </View>

      {MATERIALS.map((m) => (
        <View key={m.key} style={styles.group}>
          <View style={styles.groupHead}>
            <View style={styles.groupTitleRow}>
              <Text style={styles.groupTitle}>{m.title}</Text>
              <View style={styles.mustTag}>
                <Text style={styles.mustTagText}>照片必填</Text>
              </View>
            </View>
            <Text style={styles.groupTip}>{m.tip}</Text>
          </View>

          <ImageSlot
            image={images[m.key]}
            onCamera={() => pick(m.key, 'camera')}
            onLibrary={() => pick(m.key, 'library')}
            onClear={() => setImages((p) => ({ ...p, [m.key]: null }))}
          />

          <VarietyPicker
            label={`${m.title}品种（选填）`}
            value={varieties[m.key]}
            onChange={(v) => setVarieties((p) => ({ ...p, [m.key]: v }))}
          />
          <Text style={styles.varietyHint}>
            不知道品种就留空，系统会从照片自动识别；手填的优先于识别结果
          </Text>
        </View>
      ))}

      <Text style={styles.sectionTitle}>环境信息（选填，不填按默认值算）</Text>

      <Text style={styles.label}>温度范围（℃）</Text>
      <TextInput
        style={styles.input}
        value={temperature}
        placeholder="如 24"
        keyboardType="numeric"
        onChangeText={setTemperature}
      />
      <Text style={styles.label}>土壤类型</Text>
      <TextInput
        style={styles.input}
        value={soilType}
        placeholder="如 疏松"
        onChangeText={setSoilType}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <TouchableOpacity
        style={[styles.analyzeBtn, loading && styles.disabled]}
        onPress={submit}
        disabled={loading}
      >
        {loading
          ? <ActivityIndicator color="#fff" />
          : <Text style={styles.btnText}>开始分析</Text>}
      </TouchableOpacity>
      <Text style={styles.note}>课程原型，非生产级诊断工具，结果不构成农业建议</Text>
    </ScrollView>
  );
}

function ImageSlot({ image, onCamera, onLibrary, onClear }) {
  return (
    <View style={styles.slot}>
      {image ? (
        <View style={styles.previewBox}>
          <Image source={{ uri: image.uri }} style={styles.thumb} />
          <View style={styles.slotActions}>
            <TouchableOpacity onPress={onClear}><Text style={styles.link}>重新拍摄/选择</Text></TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={styles.pickRow}>
          <TouchableOpacity style={styles.pickBtn} onPress={onCamera}>
            <Image source={ICON_CAM} style={styles.btnIcon} />
            <Text style={styles.btnText}>拍照</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.pickBtn} onPress={onLibrary}>
            <Image source={ICON_ALB} style={styles.btnIcon} />
            <Text style={styles.btnText}>相册</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function ResultView({ result, onReset }) {
  const tier = TIERS[result.decision.code] || TIERS.cautious;
  const isRetake = result.decision.code === 'retake';

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={[styles.banner, { backgroundColor: tier.bg }]}>
        <Text style={[styles.bannerEmoji]}>{tier.emoji}</Text>
        <Text style={[styles.bannerText, { color: tier.color }]}>{tier.label}</Text>
      </View>
      <Text style={styles.explain}>{result.decision.explanation}</Text>

      {result.decision.low_confidence ? (
        <View style={styles.lowConfBar}>
          <Text style={styles.lowConfText}>低置信度识别 · 结论仅供参考</Text>
        </View>
      ) : null}

      {result.varieties ? (
        <Text style={styles.varietiesUsed}>
          品种：接穗 {result.varieties.scion?.name || '未定'}
          {result.varieties.scion?.source === 'auto' ? '（照片自动识别）' : ''}
          {' · '}砧木 {result.varieties.rootstock?.name || '未定'}
          {result.varieties.rootstock?.source === 'auto' ? '（照片自动识别）' : ''}
        </Text>
      ) : null}

      {!isRetake && (
        <>
          <Text style={styles.h2}>病害检测</Text>
          <DiseaseCard title="接穗" d={result.disease.scion} />
          <DiseaseCard title="砧木" d={result.disease.rootstock} />

          <Text style={styles.h2}>兼容性评分</Text>
          <View style={styles.scoreBox}>
            <Text style={styles.scoreNum}>{result.compatibility.score ?? '—'}</Text>
            <Text style={styles.scoreUnit}>/ 100{result.compatibility.known ? '' : '（品种未收录，无法判断）'}</Text>
          </View>
          {result.compatibility.breakdown ? (
            <Text style={styles.breakdown}>
              科属 {result.compatibility.breakdown.family_genus} + 温度 {result.compatibility.breakdown.temperature} + 土壤 {result.compatibility.breakdown.soil}
            </Text>
          ) : null}
        </>
      )}

      <TouchableOpacity style={styles.analyzeBtn} onPress={onReset}>
        <Text style={styles.btnText}>重新分析</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function DiseaseCard({ title, d }) {
  const unknown = d.label === 'unknown' || d.confidence == null;
  const ok = d.label === 'healthy';
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardLine}>
        {unknown
          ? '不在病害识别范围（14 种常见作物）'
          : `${ok ? '健康' : '疑似病害'} · 置信度 ${(d.confidence * 100).toFixed(0)}%`}
      </Text>
      <View style={[styles.dot, { backgroundColor: unknown ? '#9e9e9e' : ok ? '#2e7d32' : '#c62828' }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 40 },
  h1: { fontSize: 22, fontWeight: '700', marginBottom: 12 },
  h2: { fontSize: 17, fontWeight: '700', marginTop: 18, marginBottom: 8 },
  label: { fontSize: 14, fontWeight: '600', marginTop: 10, marginBottom: 6 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: '#2e7d32', marginTop: 18, marginBottom: 2 },
  guide: {
    backgroundColor: '#eef5ec', borderRadius: 10, padding: 12, marginBottom: 16,
  },
  guideTitle: { fontSize: 14, fontWeight: '700', color: '#2e7d32', marginBottom: 6 },
  guideLine: { fontSize: 13, lineHeight: 20, color: '#3d4a3d' },
  guideStrong: { color: '#c62828', fontWeight: '700' },
  guideOptional: { color: '#6d7a6d', fontWeight: '700' },
  group: {
    borderWidth: 1, borderColor: '#e2e8df', borderRadius: 12,
    paddingHorizontal: 12, paddingTop: 12, paddingBottom: 4, marginBottom: 14,
  },
  groupHead: { marginBottom: 8 },
  groupTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  groupTitle: { fontSize: 16, fontWeight: '800', color: '#1f2a1f' },
  mustTag: {
    backgroundColor: '#fdecea', borderRadius: 10,
    paddingHorizontal: 8, paddingVertical: 2,
  },
  mustTagText: { fontSize: 11, fontWeight: '700', color: '#c62828' },
  groupTip: { fontSize: 12, color: '#8a958a', marginTop: 3 },
  input: {
    borderWidth: 1, borderColor: '#ccc', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8, fontSize: 15, marginBottom: 4,
  },
  slot: { marginBottom: 12 },
  pickRow: { flexDirection: 'row', gap: 10 },
  pickBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#2e7d32', borderRadius: 8,
    paddingVertical: 12,
  },
  btnIcon: { width: 17, height: 13, marginRight: 6 },
  previewBox: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  thumb: { width: 96, height: 96, borderRadius: 8, backgroundColor: '#eee' },
  slotActions: { flex: 1 },
  link: { color: '#2e7d32', fontSize: 14 },
  varietyHint: { fontSize: 12, color: '#8a958a', lineHeight: 17, marginTop: 2, marginBottom: 10 },
  varietiesUsed: { marginTop: 8, fontSize: 14, color: '#555' },
  analyzeBtn: {
    backgroundColor: '#2e7d32', borderRadius: 8,
    paddingVertical: 14, alignItems: 'center', marginTop: 20,
  },
  disabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  error: { color: '#c62828', marginTop: 10, fontSize: 14 },
  note: { color: '#888', fontSize: 12, marginTop: 12, textAlign: 'center' },
  banner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 18, borderRadius: 12, gap: 10,
  },
  bannerEmoji: { fontSize: 24 },
  bannerText: { fontSize: 22, fontWeight: '800' },
  explain: { marginTop: 12, fontSize: 15, lineHeight: 22, color: '#333' },
  lowConfBar: {
    backgroundColor: '#fff6e0', borderRadius: 8,
    paddingVertical: 8, paddingHorizontal: 10, marginTop: 10,
  },
  lowConfText: { fontSize: 13, fontWeight: '700', color: '#8a6400' },
  card: {
    backgroundColor: '#f7f7f7', borderRadius: 8, padding: 12,
    marginBottom: 8, flexDirection: 'row', alignItems: 'center',
  },
  cardTitle: { width: 60, fontWeight: '600' },
  cardLine: { flex: 1, fontSize: 15 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  scoreBox: { flexDirection: 'row', alignItems: 'baseline' },
  scoreNum: { fontSize: 36, fontWeight: '800', color: '#2e7d32' },
  scoreUnit: { fontSize: 14, color: '#666', marginLeft: 6 },
  breakdown: { marginTop: 4, fontSize: 14, color: '#666' },
});
