import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
} from 'react-native-vision-camera';
import FaceDetection from '@react-native-ml-kit/face-detection';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { FaceRecognitionService } from '../services/FaceRecognitionService';
import { LivenessMath } from '../services/LivenessMath';
import { OfflineDatabase } from '../database/OfflineDatabase';
import { AWSBackgroundSync } from '../services/AWSBackgroundSync';

type ScanNavProp = StackNavigationProp<RootStackParamList, 'Scanning'>;

const PHOTO_OPTIONS = { flash: 'off', qualityPrioritization: 'speed' } as const;

const CHALLENGE_TIMEOUT_MS = 10000; // 10s per challenge before reset
const SNAPSHOT_INTERVAL_MS = 500;   // Take photo every 500ms

// ─── Challenge sequence: BLINK first, then SMILE ─────────────────────────────
type LivenessStage = 'BLINK' | 'SMILE' | 'DONE';

export default function ScanningScreen() {
  const navigation = useNavigation<ScanNavProp>();
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('front');
  const cameraRef = useRef<Camera>(null);
  const cameraActiveRef = useRef(true);

  const [stage, setStage] = useState<LivenessStage>('BLINK');
  const [status, setStatus] = useState('Initializing...');
  const [subStatus, setSubStatus] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [blinkDone, setBlinkDone] = useState(false);
  const [smileDone, setSmileDone] = useState(false);
  const [modelReady, setModelReady] = useState(false);
  const [hasEnrollment, setHasEnrollment] = useState(false);
  const [countdown, setCountdown] = useState(10);

  // Live probability display
  const [leftEyePct, setLeftEyePct] = useState(100);
  const [rightEyePct, setRightEyePct] = useState(100);
  const [smilePct, setSmilePct] = useState(0);

  // Refs to avoid stale closures inside intervals
  const stageRef = useRef<LivenessStage>('BLINK');
  const isProcessingRef = useRef(false);
  const snapshotIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isTakingPhotoRef = useRef(false); // prevent overlapping takePhoto calls

  const clearAllTimers = useCallback(() => {
    if (snapshotIntervalRef.current) {
      clearInterval(snapshotIntervalRef.current);
      snapshotIntervalRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
  }, []);

  // ─── Initialization ─────────────────────────────────────────────────────────
  useEffect(() => {
    let unsubscribeSync: (() => void) | undefined;
    let isMounted = true;

    async function init() {
      if (!hasPermission) await requestPermission();
      try {
        await FaceRecognitionService.initModel();
        const enrolled = await OfflineDatabase.hasEnrollment();
        if (!enrolled) {
          setStatus('No face enrolled.');
          setSubStatus('Go back and enroll first.');
          return;
        }
        setHasEnrollment(true);
        setModelReady(true);

        const unsubscribe = AWSBackgroundSync.startNetworkMonitoring((msg) => {
          console.log('[Sync]', msg);
        });
        if (isMounted) {
          unsubscribeSync = unsubscribe;
        } else {
          unsubscribe();
        }
      } catch {
        setStatus('ERROR: Model failed to load.');
      }
    }
    init();
    return () => {
      isMounted = false;
      if (unsubscribeSync) unsubscribeSync();
      clearAllTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPermission]);

  // ─── Start snapshot loop once model + enrollment confirmed ──────────────────
  useEffect(() => {
    if (!modelReady || !hasEnrollment) return;
    startStage('BLINK');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelReady, hasEnrollment]);

  // ─── Stage management ───────────────────────────────────────────────────────
  const startStage = useCallback((newStage: LivenessStage) => {
    clearAllTimers();
    stageRef.current = newStage;
    setStage(newStage);
    setCountdown(10);
    isTakingPhotoRef.current = false;

    if (newStage === 'BLINK') {
      setStatus('Step 1 of 2 — Liveness Check');
      setSubStatus('Please BLINK now');
    } else if (newStage === 'SMILE') {
      setStatus('Step 2 of 2 — Liveness Check');
      setSubStatus('Please SMILE now');
    }

    // Countdown display
    let remaining = 10;
    countdownIntervalRef.current = setInterval(() => {
      remaining -= 1;
      setCountdown(remaining);
    }, 1000);

    // Timeout — reset if challenge not completed in time
    timeoutRef.current = setTimeout(() => {
      console.log(`[Liveness] ${newStage} timed out. Restarting.`);
      setSubStatus(`Timed out. Try again — ${newStage}`);
      startStage(newStage); // restart same stage
    }, CHALLENGE_TIMEOUT_MS);

    // Snapshot loop
    snapshotIntervalRef.current = setInterval(() => {
      runSnapshot();
    }, SNAPSHOT_INTERVAL_MS);
  }, [clearAllTimers]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Snapshot + MLKit detection ─────────────────────────────────────────────
  const runSnapshot = useCallback(async () => {
    if (
      isTakingPhotoRef.current ||
      isProcessingRef.current ||
      !cameraRef.current
    ) return;

    isTakingPhotoRef.current = true;
    try {
      const photo = await cameraRef.current.takePhoto(PHOTO_OPTIONS);

      const imageUri = `file://${photo.path}`;
      const faces = await FaceDetection.detect(imageUri, {
        performanceMode: 'accurate',
        landmarkMode: 'none',
        classificationMode: 'all',
        contourMode: 'none',
      });

      if (!faces || faces.length === 0) {
        setSubStatus('No face detected — align your face');
        isTakingPhotoRef.current = false;
        return;
      }

      const face = faces[0];
      const leftEye = face.leftEyeOpenProbability ?? 1;
      const rightEye = face.rightEyeOpenProbability ?? 1;
      const smile = face.smilingProbability ?? 0;

      // Update live display
      setLeftEyePct(Math.round(leftEye * 100));
      setRightEyePct(Math.round(rightEye * 100));
      setSmilePct(Math.round(smile * 100));

      const currentStage = stageRef.current;
      const blinkDetected = LivenessMath.verifyChallenge(
        leftEye,
        rightEye,
        smile,
        'BLINK',
      );
      const smileDetected = LivenessMath.verifyChallenge(
        leftEye,
        rightEye,
        smile,
        'SMILE',
      );

      if (currentStage === 'BLINK') {
        setSubStatus(
          `BLINK now  |  Eyes: L=${Math.round(leftEye * 100)}% R=${Math.round(rightEye * 100)}%`
        );
        if (blinkDetected) {
          console.log('[Liveness] BLINK detected!');
          setBlinkDone(true);
          setSubStatus('✓ Blink detected! Now SMILE...');
          startStage('SMILE');
        }
      } else if (currentStage === 'SMILE') {
        setSubStatus(`SMILE now  |  Smile: ${Math.round(smile * 100)}%`);
        if (smileDetected) {
          console.log('[Liveness] SMILE detected!');
          setSmileDone(true);
          clearAllTimers();
          stageRef.current = 'DONE';
          setStage('DONE');
          setSubStatus('✓ Smile detected! Verifying identity...');
          await new Promise<void>(resolve => setTimeout(resolve, 300));
          runFaceRecognition();
        }
      }
    } catch (err) {
      console.warn('[Snapshot] Error:', err);
    } finally {
      isTakingPhotoRef.current = false;
    }
  }, [clearAllTimers, startStage]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Face recognition after liveness passes ─────────────────────────────────
  const runFaceRecognition = useCallback(async () => {
    if (isProcessingRef.current) return;
    setSubStatus('Capturing auth frame...');

    try {
      clearAllTimers();
      stageRef.current = 'DONE';
      setStage('DONE');

      if (snapshotIntervalRef.current) {
        clearInterval(snapshotIntervalRef.current);
        snapshotIntervalRef.current = null;
      }
      isTakingPhotoRef.current = false;

      await new Promise<void>(resolve => setTimeout(resolve, 300));

      if (!cameraRef.current) {
        setStatus('Camera capture failed. Please tap RESET and try again.');
        isProcessingRef.current = false;
        setIsProcessing(false);
        return;
      }

      let faces;
      let photoPath = '';
      try {
        const photo = await cameraRef.current.takePhoto(PHOTO_OPTIONS);
        photoPath = photo.path;
        const imageUri = `file://${photo.path}`;
        setSubStatus('Detecting face...');

        faces = await FaceDetection.detect(imageUri, {
          performanceMode: 'accurate',
          landmarkMode: 'none',
          classificationMode: 'all',
          contourMode: 'none',
        });
      } catch (photoErr) {
        console.warn('[Scanning] Auth photo failed:', photoErr);
        setStatus('Camera capture failed. Please tap RESET and try again.');
        isProcessingRef.current = false;
        setIsProcessing(false);
        return;
      }

      if (!faces || faces.length === 0) {
        console.warn('[Scanning] No face in auth photo.');
        setStatus('No face in frame. Please try again.');
        isProcessingRef.current = false;
        setIsProcessing(false);
        startStage('BLINK');
        return;
      }

      isProcessingRef.current = true;
      setIsProcessing(true);
      setStatus('Liveness ✓ — Matching Face...');

      const enrollments = await OfflineDatabase.getAllEnrollments();
      if (enrollments.length === 0) {
        setStatus('No enrollment found.');
        isProcessingRef.current = false;
        setIsProcessing(false);
        return;
      }

      setSubStatus('Building face geometry...');
      const liveEmbedding = await FaceRecognitionService.buildRealEmbedding(
        photoPath,
        faces[0],
      );

      // Find best match across all enrollments using cosine distance
      let bestDistance = Infinity;
      let bestUserId = '';
      for (const enrolled of enrollments) {
        const dist = FaceRecognitionService.calculateCosineDistance(
          liveEmbedding,
          enrolled.embedding,
        );
        console.log('[FaceMatch] Distance to', enrolled.userId, ':', dist);
        if (dist < bestDistance) {
          bestDistance = dist;
          bestUserId = enrolled.userId;
        }
      }

      const matched = bestDistance < FaceRecognitionService.MATCH_THRESHOLD;
      console.log('[FaceMatch] Best distance:', bestDistance);
      console.log('[FaceMatch] Best userId:', bestUserId);
      console.log('[FaceMatch] Threshold:', FaceRecognitionService.MATCH_THRESHOLD);
      console.log('[FaceMatch] Matched:', matched);
      console.log('[FaceMatch] Live embedding sample (first 5):', liveEmbedding.slice(0, 5));
      const confidence = FaceRecognitionService.getConfidencePercent(bestDistance);
      const timestamp = new Date().toISOString();

      await OfflineDatabase.saveRecord({
        id: Math.random().toString(36).substring(7),
        timestamp,
        status: matched ? 'VERIFIED_OFFLINE' : 'REJECTED_OFFLINE',
        vectorId: bestUserId || 'UNKNOWN',
      });

      navigation.replace('Result', {
        success: matched,
        confidence,
        timestamp,
        userId: bestUserId || 'UNKNOWN',
      });
    } catch (error) {
      console.error('[Scanning] Auth error:', error);
      setStatus('Recognition error. Try again.');
      isProcessingRef.current = false;
      setIsProcessing(false);
      startStage('BLINK');
    }
  }, [clearAllTimers, navigation, startStage]);

  const handleReset = useCallback(() => {
    isProcessingRef.current = false;
    setIsProcessing(false);
    setBlinkDone(false);
    setSmileDone(false);
    setLeftEyePct(100);
    setRightEyePct(100);
    setSmilePct(0);
    startStage('BLINK');
  }, [startStage]);

  // ─── Guards ──────────────────────────────────────────────────────────────────
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

  const livenessDone = blinkDone && smileDone;

  return (
    <View style={styles.container}>
      {/* Top overlay */}
      <View style={styles.topOverlay}>
        <Text style={styles.appTitle}>SENTINEL GUARD</Text>
        <Text style={styles.appSubtitle}>OFFLINE BIOMETRIC AUTH</Text>
      </View>

      {/* Camera viewport */}
      <View style={styles.cameraArea}>
        <View style={styles.cameraBox}>
          <Camera
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            device={device}
            isActive={cameraActiveRef.current}
            photo={true}
            resizeMode="cover"
          />

          {/* Face guide */}
          <View style={styles.faceGuideWrapper}>
            <View style={[
              styles.faceGuide,
              livenessDone && styles.faceGuideSuccess,
              !hasEnrollment && styles.faceGuideError,
            ]} />
          </View>
        </View>

        {/* Challenge + steps below camera box */}
        <View style={styles.indicatorsArea}>
          {modelReady && !livenessDone && hasEnrollment && !isProcessing && (
            <View style={styles.challengeBadge}>
              <Text style={styles.challengeIcon}>
                {stage === 'BLINK' ? '👁' : '😊'}
              </Text>
              <Text style={styles.challengeText}>
                {stage === 'BLINK' ? 'BLINK' : 'SMILE'}
              </Text>
              <Text style={styles.countdownText}>{countdown}s</Text>
            </View>
          )}

          {modelReady && hasEnrollment && (
            <View style={styles.stepsRow}>
              <View style={[styles.stepDot, blinkDone && styles.stepDotDone]}>
                <Text style={styles.stepDotText}>👁</Text>
              </View>
              <View style={[styles.stepLine, blinkDone && styles.stepLineDone]} />
              <View style={[styles.stepDot, smileDone && styles.stepDotDone]}>
                <Text style={styles.stepDotText}>😊</Text>
              </View>
            </View>
          )}
        </View>
      </View>

      {/* Bottom HUD */}
      <View style={styles.bottomHud}>
        {/* Status */}
        <View style={styles.statusBox}>
          <View style={styles.statusRow}>
            <View style={[
              styles.statusDot,
              livenessDone ? styles.dotGreen : styles.dotAmber,
            ]} />
            <Text style={styles.statusTitle}>{status}</Text>
          </View>
          <Text style={styles.statusSub}>{subStatus}</Text>

          {/* Live probability readout */}
          {modelReady && hasEnrollment && !isProcessing && (
            <View style={styles.probRow}>
              <Text style={styles.probText}>
                L-Eye: <Text style={leftEyePct < 30 ? styles.probAlert : styles.probNormal}>
                  {leftEyePct}%
                </Text>
              </Text>
              <Text style={styles.probText}>
                R-Eye: <Text style={rightEyePct < 30 ? styles.probAlert : styles.probNormal}>
                  {rightEyePct}%
                </Text>
              </Text>
              <Text style={styles.probText}>
                Smile: <Text style={smilePct > 75 ? styles.probAlert : styles.probNormal}>
                  {smilePct}%
                </Text>
              </Text>
            </View>
          )}

          {isProcessing && (
            <ActivityIndicator color="#4CAF50" style={styles.spinner} />
          )}
        </View>

        {/* Buttons */}
        <View style={styles.btnRow}>
          <TouchableOpacity style={styles.btn} onPress={handleReset}>
            <Text style={styles.btnText}>RESET</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.btn}
            onPress={() => {
              clearAllTimers();
              navigation.reset({ index: 0, routes: [{ name: 'Register' }] });
            }}
          >
            <Text style={styles.btnText}>← ENROLL</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0D0D0D' },
  cameraArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 120,
    paddingBottom: 200,
  },
  indicatorsArea: {
    alignItems: 'center',
    marginTop: 12,
  },
  cameraBox: {
    width: '86%',
    maxWidth: 360,
    height: 320,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#1A1A1A',
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  center: {
    flex: 1, backgroundColor: '#0D0D0D',
    justifyContent: 'center', alignItems: 'center',
  },
  errorText: { color: '#EF5350', fontSize: 16, textAlign: 'center', padding: 20 },

  topOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0,
    paddingTop: 52, paddingBottom: 20,
    backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center',
  },
  appTitle: { fontSize: 20, fontWeight: '900', color: '#fff', letterSpacing: 3 },
  appSubtitle: {
    fontSize: 10, color: 'rgba(255,255,255,0.5)',
    letterSpacing: 3, marginTop: 2,
  },

  faceGuideWrapper: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center', alignItems: 'center',
  },
  faceGuide: {
    position: 'absolute',
    top: '10%', left: '20%',
    width: '60%', height: '80%',
    borderRadius: 120, borderWidth: 2,
    borderColor: 'rgba(76, 175, 80, 0.6)',
    borderStyle: 'dashed',
  },
  faceGuideSuccess: {
    borderColor: '#4CAF50', borderStyle: 'solid', borderWidth: 3,
  },
  faceGuideError: { borderColor: '#EF5350' },

  challengeBadge: {
    marginTop: 16,
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: 20, paddingVertical: 10,
    borderRadius: 24,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    flexDirection: 'row', alignItems: 'center', gap: 8,
  },
  challengeIcon: { fontSize: 20 },
  challengeText: { color: '#fff', fontSize: 18, fontWeight: '800', letterSpacing: 2 },
  countdownText: { color: '#FFA726', fontSize: 16, fontWeight: '700' },

  stepsRow: {
    flexDirection: 'row', alignItems: 'center',
    marginTop: 20, gap: 0,
  },
  stepDot: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
    justifyContent: 'center', alignItems: 'center',
  },
  stepDotDone: { backgroundColor: '#2E7D32', borderColor: '#4CAF50' },
  stepDotText: { fontSize: 16 },
  stepLine: { width: 32, height: 2, backgroundColor: 'rgba(255,255,255,0.2)' },
  stepLineDone: { backgroundColor: '#4CAF50' },

  bottomHud: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.80)',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 32,
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.07)',
  },
  statusBox: { marginBottom: 14 },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  dotGreen: { backgroundColor: '#4CAF50' },
  dotAmber: { backgroundColor: '#FFA726' },
  statusTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  statusSub: {
    color: 'rgba(255,255,255,0.55)', fontSize: 12,
    marginLeft: 16, fontFamily: 'monospace', marginBottom: 8,
  },
  probRow: {
    flexDirection: 'row', gap: 16, marginLeft: 16, marginTop: 4,
  },
  probText: { color: 'rgba(255,255,255,0.5)', fontSize: 11, fontFamily: 'monospace' },
  probNormal: { color: 'rgba(255,255,255,0.7)' },
  probAlert: { color: '#4CAF50', fontWeight: '700' },
  spinner: { marginTop: 8 },

  btnRow: { flexDirection: 'row', gap: 12 },
  btn: {
    flex: 1, paddingVertical: 14, borderRadius: 10, alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  btnText: {
    color: 'rgba(255,255,255,0.7)', fontSize: 13,
    fontWeight: '700', letterSpacing: 1,
  },
});
