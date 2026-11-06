import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, Image } from 'react-native';
import { login, register, demoLogin } from '../lib/api';
import { C } from '../lib/theme';

const MASCOT = require('../assets/mascot_identify.png');

// 登录 / 注册二合一。成功通过 onLogin 把用户信息交回 App。
export default function LoginScreen({ onLogin }) {
  const [mode, setMode] = useState('login'); // login | register
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    if (!username.trim() || !password) {
      setError('用户名和密码都要填');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = mode === 'login'
        ? await login(username.trim(), password)
        : await register(username.trim(), password);
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
        <Text style={styles.title}>🌿 我的花园</Text>
        <Text style={styles.sub}>登录后就能添加和管理你的植物</Text>

        <TextInput
          style={styles.input}
          placeholder="用户名"
          autoCapitalize="none"
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

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity
          style={styles.btn}
          onPress={submit}
          disabled={busy}
        >
          <Text style={styles.btnText}>{busy ? '请稍候…' : (mode === 'login' ? '登录' : '注册并登录')}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
          <Text style={styles.switch}>
            {mode === 'login' ? '没有账号？去注册' : '已有账号？去登录'}
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
  input: {
    backgroundColor: '#fff', borderWidth: 1, borderColor: C.border, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginBottom: 12,
  },
  btn: { backgroundColor: C.green, borderRadius: 12, paddingVertical: 13, marginTop: 4 },
  btnText: { color: '#fff', textAlign: 'center', fontSize: 16, fontWeight: '700' },
  switch: { color: C.greenDark, textAlign: 'center', marginTop: 14, fontSize: 13 },
  demoBtn: { color: C.sub, textAlign: 'center', marginTop: 10, fontSize: 13, textDecorationLine: 'underline' },
  error: { color: C.red, fontSize: 13, marginBottom: 8 },
});
