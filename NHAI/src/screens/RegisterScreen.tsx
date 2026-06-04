import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
} from 'react-native-vision-camera';
import FaceDetection from '@react-native-ml-kit/face-detection';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { FaceRecognitionService } from '../services/FaceRecognitionService';
import { OfflineDatabase, EnrolledFace } from '../database/OfflineDatabase';

type RegisterNavProp = StackNavigationProp<RootStackParamList, 'Register'>;

const PHOTO_OPTIONS = { flash: 'off', qualityPrioritization: 'speed' } as const;

const COLORS = {
  bg: '#F5F5F7',
  surface: '#FFFFFF',
  border: '#E5E5EA',
  accent: '#34C759',
  accentDim: '#28A745',
  text: '#1C1C1E',
  subtext: '#8E8E93',
  danger: '#FF3B30',
  dangerDim: '#D32F2F',
};

export default function RegisterScreen() {
  const navigation = useNavigation<RegisterNavProp>();
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('front');
  const cameraRef = useRef<Camera>(null);

  const [name, setName] = useState('');
  const [status, setStatus] = useState('Initializing...');
  const [isCapturing, setIsCapturing] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [enrollments, setEnrollments] = useState<EnrolledFace[]>([]);

  // Permission on mount
  useEffect(() => {
    if (!hasPermission) requestPermission();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPermission]);

  const refreshEnrollments = useCallback(async () => {
    const all = await OfflineDatabase.getAllEnrollments();
    setEnrollments(all);
  }, []);

  // Re-initialize model + refresh enrollment list on every focus
  useFocusEffect(
    useCallback(() => {
      setIsCapturing(false);
      async function refresh() {
        try {
          await FaceRecognitionService.initModel();
          setModelReady(true);
        } catch {
          setStatus('ERROR: Failed to load recognition model.');
          return;
        }
        await refreshEnrollments();
        setStatus('Enter a name and tap Enroll Face.');
      }
      refresh();
    }, [refreshEnrollments])
  );

  const handleEnroll = useCallback(async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setStatus('Please enter a name before enrolling.');
      return;
    }
    if (!modelReady || isCapturing) return;

    setIsCapturing(true);
    setStatus('Capturing face...');

    try {
      if (!cameraRef.current) throw new Error('Camera not ready');

      // Step 1: wait 500ms for camera to settle on the current person's face
      await new Promise<void>(resolve => setTimeout(resolve, 500));

      // Step 2: take photo and detect face bounding box
      setStatus('Detecting face...');
      const photo = await cameraRef.current.takePhoto(PHOTO_OPTIONS);
      const faces = await FaceDetection.detect(`file://${photo.path}`, {
        performanceMode: 'accurate',
        landmarkMode: 'none',
        classificationMode: 'none',
        contourMode: 'none',
      });

      if (!faces || faces.length === 0) {
        setStatus('No face detected. Please try again.');
        setIsCapturing(false);
        return;
      }

      // Step 3: build contour-based embedding
      setStatus('Building face geometry...');
      const embedding = await FaceRecognitionService.buildRealEmbedding(
        photo.path,
        faces[0],
      );

      // Step 4: save with unique userId = name + timestamp suffix
      const userId = `${trimmedName}_${Date.now()}`;
      await OfflineDatabase.saveEnrollment({
        userId,
        embedding,
        enrolledAt: new Date().toISOString(),
      });

      setStatus(`✓ ${trimmedName} enrolled successfully!`);
      setName('');
      await refreshEnrollments();
    } catch (error) {
      console.error('[Register] Enrollment failed:', error);
      setStatus('Enrollment failed. Please try again.');
    } finally {
      setIsCapturing(false);
    }
  }, [modelReady, isCapturing, name, refreshEnrollments]);

  const handleDelete = useCallback(async (userId: string) => {
    await OfflineDatabase.deleteEnrollment(userId);
    await refreshEnrollments();
    setStatus('Enrollment removed.');
  }, [refreshEnrollments]);

  const canEnroll = modelReady && !isCapturing && name.trim().length > 0;
  const hasAnyEnrollment = enrollments.length > 0;

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
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>SENTINEL GUARD</Text>
          <Text style={styles.subtitle}>FACE ENROLLMENT</Text>
        </View>

        {/* Name input */}
        <View style={styles.inputWrapper}>
          <Text style={styles.inputLabel}>PERSONNEL NAME</Text>
          <TextInput
            style={styles.textInput}
            value={name}
            onChangeText={setName}
            placeholder="Enter name to enroll"
            placeholderTextColor={COLORS.subtext}
            autoCapitalize="words"
            autoCorrect={false}
            editable={!isCapturing}
          />
        </View>

        {/* Camera viewport */}
        <View style={styles.cameraWrapper}>
          <Camera
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            device={device}
            isActive={true}
            photo={true}
            resizeMode="cover"
          />
          <View style={styles.faceGuide} />
        </View>

        {/* Status console */}
        <View style={styles.console}>
          <Text style={styles.consoleLabel}>STATUS</Text>
          <Text style={styles.consoleText}>{status}</Text>
          {isCapturing && (
            <ActivityIndicator color={COLORS.accent} style={styles.spinner} />
          )}
        </View>

        {/* Enroll button */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.btn, styles.btnPrimary, !canEnroll && styles.btnDisabled]}
            onPress={handleEnroll}
            disabled={!canEnroll}
          >
            <Text style={styles.btnText}>
              {isCapturing ? 'ENROLLING...' : 'ENROLL FACE'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Enrolled users list */}
        {hasAnyEnrollment && (
          <View style={styles.listSection}>
            <Text style={styles.listHeader}>
              ENROLLED PERSONNEL ({enrollments.length})
            </Text>
            {(enrollments ?? []).map((item) => {
              // Display name is everything before the last underscore+timestamp
              const displayName = item.userId.replace(/_\d+$/, '');
              const enrolledDate = new Date(item.enrolledAt).toLocaleString('en-IN', {
                day: '2-digit', month: 'short',
                hour: '2-digit', minute: '2-digit',
              });
              return (
                <View key={item.userId} style={styles.listItem}>
                  <View style={styles.listItemInfo}>
                    <Text style={styles.listItemName}>{displayName}</Text>
                    <Text style={styles.listItemDate}>{enrolledDate}</Text>
                  </View>
                  <TouchableOpacity
                    style={styles.deleteBtn}
                    onPress={() => handleDelete(item.userId)}
                  >
                    <Text style={styles.deleteBtnText}>✕</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        )}

        {/* Authenticate button — only when at least one enrollment exists */}
        {hasAnyEnrollment && (
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.btn, styles.btnAuthenticate]}
              onPress={() => navigation.replace('Scanning')}
            >
              <Text style={styles.btnText}>
                PROCEED TO AUTHENTICATE →
              </Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.bottomPad} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  scroll: { flexGrow: 1 },
  center: {
    flex: 1, backgroundColor: COLORS.bg,
    justifyContent: 'center', alignItems: 'center',
  },
  errorText: { color: COLORS.danger, fontSize: 16, textAlign: 'center', padding: 20 },

  header: {
    paddingTop: 52,
    paddingBottom: 12,
    alignItems: 'center',
    zIndex: 2,
  },
  title: { fontSize: 22, fontWeight: '900', color: COLORS.text, letterSpacing: 3 },
  subtitle: { fontSize: 11, color: COLORS.subtext, letterSpacing: 4, marginTop: 4 },

  inputWrapper: { marginHorizontal: 24, marginBottom: 14, zIndex: 2 },
  inputLabel: {
    color: COLORS.subtext, fontSize: 10,
    fontWeight: '800', letterSpacing: 2, marginBottom: 8,
  },
  textInput: {
    backgroundColor: COLORS.surface,
    borderWidth: 1, borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 16, paddingVertical: 14,
    color: COLORS.text, fontSize: 16, fontFamily: 'monospace',
  },

  cameraWrapper: {
    alignSelf: 'center',
    width: '86%',
    maxWidth: 360,
    height: 320,
    marginBottom: 16,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  faceGuide: {
    position: 'absolute',
    top: '10%', left: '20%',
    width: '60%', height: '80%',
    borderRadius: 120, borderWidth: 2,
    borderColor: 'rgba(76, 175, 80, 0.6)',
    borderStyle: 'dashed',
  },

  console: {
    margin: 24, marginBottom: 12,
    backgroundColor: COLORS.surface,
    borderRadius: 10, padding: 16,
    borderWidth: 1, borderColor: COLORS.border,
    minHeight: 64,
    zIndex: 2,
  },
  consoleLabel: {
    color: COLORS.subtext, fontSize: 10,
    fontWeight: '800', letterSpacing: 2, marginBottom: 6,
  },
  consoleText: { color: COLORS.text, fontSize: 13, fontFamily: 'monospace' },
  spinner: { marginTop: 8 },

  actions: { paddingHorizontal: 24, marginBottom: 12, zIndex: 2 },
  btn: { paddingVertical: 16, borderRadius: 10, alignItems: 'center' },
  btnPrimary: { backgroundColor: COLORS.accentDim },
  btnAuthenticate: { backgroundColor: '#1A3A5C' },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: '#fff', fontSize: 14, fontWeight: '800', letterSpacing: 2 },

  listSection: {
    marginHorizontal: 24, marginBottom: 12,
    zIndex: 2,
  },
  listHeader: {
    color: COLORS.subtext, fontSize: 10,
    fontWeight: '800', letterSpacing: 2,
    marginBottom: 10,
  },
  listItem: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 10, padding: 14,
    marginBottom: 8,
    borderWidth: 1, borderColor: COLORS.border,
  },
  listItemInfo: { flex: 1 },
  listItemName: {
    color: COLORS.text, fontSize: 15,
    fontWeight: '700', marginBottom: 2,
  },
  listItemDate: {
    color: COLORS.subtext, fontSize: 11,
    fontFamily: 'monospace',
  },
  deleteBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: COLORS.dangerDim,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: COLORS.danger,
  },
  deleteBtnText: { color: COLORS.danger, fontSize: 14, fontWeight: '800' },

  bottomPad: { height: 32 },
});
