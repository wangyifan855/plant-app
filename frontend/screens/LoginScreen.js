import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, Image } from 'react-native';
import { login, register, demoLogin } from '../lib/api';
import { C } from '../lib/theme';

const MASCOT = require('../assets/mascot_identify.png');

// 登录 / 注册。两种模式用顶部分段控件切，别再靠底部一行小字——之前那样
// 很多人压根没发现「注册」在哪。注册多一个确认密码，避免输错了自己也不知道。
export default function LoginScreen({ onLogin }) {
  const [mode, setMode] = useState('login'); // login | register
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const isRegister = mode === 'register';

  function switchMode(next) {
    if (next === mode) return;
    setMode(next);
    setError('');
    setConfirm('');
  }

  async function submit() {
    const name = username.trim();
    if (!name || !password) {
      setError('用户名和密码都要填');
      return;
    }
    if (isRegister) {
      if (password.length < 4) { setError('密码至少 4 位'); return; }
      if (password !== confirm) { setError('两次输入的密码不一致'); return; }
    }
    setBusy(true);
    setError('');
    try {
      const r = isRegister ? await register(name, password) : await login(name, password);
      onLogin({ id: r.user_id, username: r.username });
    } catch (e) {
      setError(e.message || '操作失败');
    } finally {
      setBusy(false);
    }
  }

  async function demo() {
    setBusy(true);
    setError('');
    try {
      const r = await demoLogin();
      onLogin({ id: r.user_id, username: r.username });
    } catch (e) {
      setError(e.message || '进入演示失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.card}>
        <Image source={MASCOT} style={styles.mascot} resizeMode="contain" />
        <Text style={styles.title}>{isRegister ? '创建账号' : '欢迎回来'}</Text>
        <Text style={styles.sub}>
          {isRegister ? '注册后就能记录植物、和大家交流' : '登录后就能添加和管理你的植物'}
        </Text>

        <View style={styles.seg}>
          <TouchableOpacity
            style={[styles.segItem, !isRegister && styles.segItemOn]}
            onPress={() => switchMode('login')}
          >
            <Text style={[styles.segText, !isRegister && styles.segTextOn]}>登录</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.segItem, isRegister && styles.segItemOn]}
            onPress={() => switchMode('register')}
          >
            <Text style={[styles.segText, isRegister && styles.segTextOn]}>注册</Text>
          </TouchableOpacity>
        </View>

        <TextInput
          style={styles.input}
          placeholder="用户名"
          autoCapitalize="none"
          autoCorrect={false}
          value={username}
          onChangeText={setUsername}
        />
        <TextInput
          style={styles.input}
          placeholder="密码（至少 4 位）"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />
        {isRegister ? (
          <TextInput
            style={styles.input}
            placeholder="再输一次密码"
            secureTextEntry
            value={confirm}
            onChangeText={setConfirm}
          />
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity style={styles.btn} onPress={submit} disabled={busy}>
          <Text style={styles.btnText}>
            {busy ? '请稍候…' : (isRegister ? '注册并登录' : '登录')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={demo} disabled={busy}>
          <Text style={styles.demoBtn}>先看看演示花园（免注册）→</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg, justifyContent: 'center', padding: 20 },
  mascot: { width: 96, height: 96, alignSelf: 'center', marginBottom: 8 },
  card: {
    backgroundColor: C.card, borderRadius: 18, padding: 22,
    // PC 上登录卡别拉成一整行，居中限宽
    width: '100%', maxWidth: 420, alignSelf: 'center',
    shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 3 },
  },
  title: { fontSize: 24, fontWeight: '800', color: C.greenDark, textAlign: 'center' },
  sub: { fontSize: 13, color: C.sub, textAlign: 'center', marginBottom: 18, marginTop: 4 },
  // 登录 / 注册切换：浅绿槽 + 选中项浮起来
  seg: {
    flexDirection: 'row', backgroundColor: '#EFF5E7', borderRadius: 12,
    padding: 3, marginBottom: 16,
  },
  segItem: { flex: 1, paddingVertical: 9, borderRadius: 10, alignItems: 'center' },
  segItemOn: {
    backgroundColor: '#fff',
    shadowColor: '#2F4A1D', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  segText: { fontSize: 14, color: C.sub, fontWeight: '600' },
  segTextOn: { color: C.greenDark, fontWeight: '800' },
  input: {
    backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginBottom: 12,
  },
  btn: { backgroundColor: C.green, borderRadius: 12, paddingVertical: 13, marginTop: 4 },
  btnText: { color: '#fff', textAlign: 'center', fontSize: 16, fontWeight: '700' },
  demoBtn: { color: C.sub, textAlign: 'center', marginTop: 14, fontSize: 13, textDecorationLine: 'underline' },
  error: { color: C.red, fontSize: 13, marginBottom: 8 },
});
