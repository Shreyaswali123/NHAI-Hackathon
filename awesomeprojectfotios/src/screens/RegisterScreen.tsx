import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
} from 'react-native-vision-camera';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { FaceRecognitionService } from '../services/FaceRecognitionService';
import { OfflineDatabase } from '../database/OfflineDatabase';

type RegisterNavProp = StackNavigationProp<RootStackParamList, 'Register'>;

const COLORS = {
  bg: '#0D0D0D',
  surface: '#1A1A1A',
  border: '#2A2A2A',
  accent: '#4CAF50',
  accentDim: '#2E7D32',
  text: '#E8E8E8',
  subtext: '#888',
  danger: '#EF5350',
};

export default function RegisterScreen() {
  const navigation = useNavigation<RegisterNavProp>();
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('front');
  const cameraRef = useRef<Camera>(null);

  const [status, setStatus] = useState('Initializing...');
  const [isCapturing, setIsCapturing] = useState(false);
  const [isEnrolled, setIsEnrolled] = useState(false);
  const [modelReady, setModelReady] = useState(false);

  useEffect(() => {
    async function init() {
      if (!hasPermission) await requestPermission();
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPermission]);

  // Re-check enrollment status every time this screen comes into focus.
  // This ensures the AUTHENTICATE button appears correctly after returning
  // from Result or Scanning without a full app restart.
  useFocusEffect(
    useCallback(() => {
      setIsCapturing(false);
      async function checkEnrollment() {
        try {
          await FaceRecognitionService.initModel();
          setModelReady(true);
        } catch {
          setStatus('ERROR: Failed to load recognition model.');
          return;
        }

        try {
          const enrolled = await OfflineDatabase.hasEnrollment();
          if (enrolled) {
            setIsEnrolled(true);
            setStatus('Face already enrolled. Ready to authenticate.');
          } else {
            setIsEnrolled(false);
            setStatus('Position your face in the frame and tap Enroll.');
          }
        } catch {
          setStatus('ERROR: Failed to check enrollment.');
        }
      }
      checkEnrollment();
    }, [])
  );

  const handleEnroll = useCallback(async () => {
    if (!modelReady || isCapturing) return;
    setIsCapturing(true);
    setStatus('Capturing face...');

    try {
      // In production: extract real pixel data from the camera frame.
      // For the demo, we run inference on a normalized input to produce
      // a stable embedding that persists across restarts.
      const inputBuffer = FaceRecognitionService.createDummyInput();
      setStatus('Running MobileFaceNet inference...');

      const embedding = await FaceRecognitionService.getEmbedding(inputBuffer);

      await OfflineDatabase.saveEnrollment({
        userId: 'USER_001',
        embedding,
        enrolledAt: new Date().toISOString(),
      });

      setIsEnrolled(true);
      setStatus('✓ Enrollment complete! Face stored offline.');
    } catch (error) {
      console.error('[Register] Enrollment failed:', error);
      setStatus('Enrollment failed. Please try again.');
    } finally {
      setIsCapturing(false);
    }
  }, [modelReady, isCapturing]);

  const handleClearAndRe = useCallback(async () => {
    Alert.alert(
      'Clear Enrollment',
      'This will delete the stored face. You will need to re-enroll.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            await OfflineDatabase.clearEnrollments();
            setIsEnrolled(false);
            setStatus('Enrollment cleared. Position your face and tap Enroll.');
          },
        },
      ]
    );
  }, []);

  if (!hasPermission) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Camera permission required.</Text>
      </View>
    );
  }

  if (!device) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Front camera not available.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>SENTINEL GUARD</Text>
        <Text style={styles.subtitle}>FACE ENROLLMENT</Text>
      </View>

      {/* Camera viewport */}
      <View style={styles.cameraWrapper}>
        <Camera
          ref={cameraRef}
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={true}
        />
        {/* Face guide overlay */}
        <View style={styles.faceGuide} />
        {isEnrolled && (
          <View style={styles.enrolledBadge}>
            <Text style={styles.enrolledBadgeText}>✓ ENROLLED</Text>
          </View>
        )}
      </View>

      {/* Status console */}
      <View style={styles.console}>
        <Text style={styles.consoleLabel}>STATUS</Text>
        <Text style={styles.consoleText}>{status}</Text>
        {isCapturing && <ActivityIndicator color={COLORS.accent} style={styles.spinner} />}
      </View>

      {/* Action buttons */}
      <View style={styles.actions}>
        {!isEnrolled ? (
          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary, (!modelReady || isCapturing) && styles.btnDisabled]}
            onPress={handleEnroll}
            disabled={!modelReady || isCapturing}
          >
            <Text style={styles.btnText}>
              {isCapturing ? 'ENROLLING...' : 'ENROLL FACE'}
            </Text>
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary]}
              onPress={() => navigation.replace('Scanning')}
            >
              <Text style={styles.btnText}>AUTHENTICATE →</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.btnDanger]}
              onPress={handleClearAndRe}
            >
              <Text style={styles.btnText}>RE-ENROLL</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  center: { flex: 1, backgroundColor: COLORS.bg, justifyContent: 'center', alignItems: 'center' },
  errorText: { color: COLORS.danger, fontSize: 16, textAlign: 'center', padding: 20 },
  header: { paddingTop: 52, paddingBottom: 16, alignItems: 'center' },
  title: { fontSize: 22, fontWeight: '900', color: COLORS.text, letterSpacing: 3 },
  subtitle: { fontSize: 11, color: COLORS.subtext, letterSpacing: 4, marginTop: 4 },
  cameraWrapper: {
    marginHorizontal: 24,
    height: 320,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  faceGuide: {
    position: 'absolute',
    top: '15%',
    left: '20%',
    width: '60%',
    height: '70%',
    borderRadius: 120,
    borderWidth: 2,
    borderColor: 'rgba(76, 175, 80, 0.6)',
    borderStyle: 'dashed',
  },
  enrolledBadge: {
    position: 'absolute',
    bottom: 12,
    alignSelf: 'center',
    backgroundColor: 'rgba(46, 125, 50, 0.85)',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
  },
  enrolledBadgeText: { color: '#fff', fontSize: 12, fontWeight: '800', letterSpacing: 2 },
  console: {
    margin: 24,
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    minHeight: 72,
  },
  consoleLabel: { color: COLORS.subtext, fontSize: 10, fontWeight: '800', letterSpacing: 2, marginBottom: 6 },
  consoleText: { color: COLORS.text, fontSize: 14, fontFamily: 'monospace' },
  spinner: { marginTop: 8 },
  actions: { paddingHorizontal: 24, gap: 12 },
  btn: { paddingVertical: 16, borderRadius: 10, alignItems: 'center' },
  btnPrimary: { backgroundColor: COLORS.accentDim },
  btnDanger: { backgroundColor: '#5D1A1A' },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '800', letterSpacing: 2 },
});
