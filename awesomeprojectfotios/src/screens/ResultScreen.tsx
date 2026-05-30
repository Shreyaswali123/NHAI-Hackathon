import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../navigation/AppNavigator';

type ResultRouteProp = RouteProp<RootStackParamList, 'Result'>;
type ResultNavProp = StackNavigationProp<RootStackParamList, 'Result'>;

const COLORS = {
  bg: '#0D0D0D',
  surface: '#1A1A1A',
  border: '#2A2A2A',
  success: '#4CAF50',
  successDim: '#1B5E20',
  failure: '#EF5350',
  failureDim: '#5D1A1A',
  text: '#E8E8E8',
  subtext: '#888',
};

export default function ResultScreen() {
  const route = useRoute<ResultRouteProp>();
  const navigation = useNavigation<ResultNavProp>();
  const { success, confidence, timestamp, userId } = route.params;

  // Strip the _timestamp suffix added during enrollment (e.g. "Shreyas_1780048144211" → "Shreyas")
  const displayName = userId.replace(/_\d+$/, '');

  const formattedTime = new Date(timestamp).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const formattedDate = new Date(timestamp).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  return (
    <View style={styles.container}>
      {/* Result badge */}
      <View style={[styles.badge, success ? styles.badgeSuccess : styles.badgeFailure]}>
        <Text style={styles.badgeIcon}>{success ? '✓' : '✗'}</Text>
        <Text style={styles.badgeTitle}>
          {success ? 'AUTHENTICATED' : 'ACCESS DENIED'}
        </Text>
        <Text style={styles.badgeSubtitle}>
          {success ? 'Identity Verified Offline' : 'Face Not Recognized'}
        </Text>
      </View>

      {/* Details card */}
      <View style={styles.card}>
        <Row label="USER ID" value={displayName} />
        <Divider />
        <Row label="CONFIDENCE" value={`${confidence}%`} highlight={success} />
        <Divider />
        <Row label="DATE" value={formattedDate} />
        <Divider />
        <Row label="TIME" value={formattedTime} />
        <Divider />
        <Row label="MODE" value="OFFLINE · EDGE AI" />
        <Divider />
        <Row label="MODEL" value="MobileFaceNet 128-d" />
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.btn, styles.btnPrimary]}
          onPress={() => navigation.reset({ index: 0, routes: [{ name: 'Scanning' }] })}
        >
          <Text style={styles.btnText}>TRY AGAIN</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, styles.btnSecondary]}
          onPress={() => navigation.reset({ index: 0, routes: [{ name: 'Register' }] })}
        >
          <Text style={styles.btnText}>BACK TO ENROLL</Text>
        </TouchableOpacity>
      </View>

      {/* Footer */}
      <Text style={styles.footer}>
        SENTINEL GUARD · NHAI HACKATHON 7.0 · OFFLINE BIOMETRIC AUTH
      </Text>
    </View>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, highlight && styles.rowValueHighlight]}>{value}</Text>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
    paddingTop: 52,
    paddingHorizontal: 24,
  },
  badge: {
    borderRadius: 16,
    padding: 28,
    alignItems: 'center',
    marginBottom: 24,
    borderWidth: 1,
  },
  badgeSuccess: {
    backgroundColor: COLORS.successDim,
    borderColor: COLORS.success,
  },
  badgeFailure: {
    backgroundColor: COLORS.failureDim,
    borderColor: COLORS.failure,
  },
  badgeIcon: { fontSize: 48, color: '#fff', marginBottom: 8 },
  badgeTitle: { fontSize: 24, fontWeight: '900', color: '#fff', letterSpacing: 3 },
  badgeSubtitle: { fontSize: 12, color: 'rgba(255,255,255,0.7)', marginTop: 4, letterSpacing: 1 },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
  },
  rowLabel: { fontSize: 11, color: COLORS.subtext, fontWeight: '700', letterSpacing: 1.5 },
  rowValue: { fontSize: 13, color: COLORS.text, fontWeight: '600', fontFamily: 'monospace' },
  rowValueHighlight: { color: COLORS.success },
  divider: { height: 1, backgroundColor: COLORS.border },
  actions: { gap: 12, marginBottom: 24 },
  btn: { paddingVertical: 16, borderRadius: 10, alignItems: 'center' },
  btnPrimary: { backgroundColor: '#1B3A1F' },
  btnSecondary: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '800', letterSpacing: 2 },
  footer: {
    textAlign: 'center',
    color: COLORS.subtext,
    fontSize: 9,
    letterSpacing: 1.5,
    marginBottom: 16,
  },
});
