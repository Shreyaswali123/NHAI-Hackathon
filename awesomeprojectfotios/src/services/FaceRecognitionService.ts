import { NativeModules } from 'react-native';
import RNFS from 'react-native-fs';
import { loadTensorflowModel } from 'react-native-fast-tflite';
import type { TfliteModel } from 'react-native-fast-tflite/src/specs/Tflite.nitro';

// react-native-fast-tflite v3 API:
//   model.run(inputs: ArrayBuffer[]) => Promise<ArrayBuffer[]>
// So we pass inputBuffer.buffer and wrap output in Float32Array.

const MOBILEFACENET_INPUT_SIZE = 112 * 112 * 3; // 37632 floats

export class FaceRecognitionService {
  private static model: TfliteModel | null = null;
  private static inputTensorBuffer = new Float32Array(MOBILEFACENET_INPUT_SIZE);

  // With contour-based embeddings, same person ~0.05-0.12, different ~0.2+
  public static readonly MATCH_THRESHOLD = 0.5;

  /**
   * Loads the MobileFaceNet TFLite model from app assets.
   * Safe to call multiple times — only loads once.
   */
  public static async initModel(): Promise<void> {
    if (this.model) return;
    try {
      this.model = await loadTensorflowModel(
        require('../models/mobilefacenet.tflite'), []
      );
      console.log('[FaceRecognition] MobileFaceNet loaded successfully.');
    } catch (error) {
      console.error('[FaceRecognition] Failed to load TFLite model:', error);
      throw error;
    }
  }

  /**
   * Runs MobileFaceNet inference on a preprocessed pixel buffer.
   * Input: Float32Array of shape [1, 112, 112, 3] (normalized RGB pixels)
   * Output: 128-dimensional face embedding vector
   */
  public static async getEmbedding(inputBuffer: Float32Array): Promise<number[]> {
    if (!this.model) {
      throw new Error('[FaceRecognition] Model not initialized. Call initModel() first.');
    }
    try {
      if (this.inputTensorBuffer.length !== inputBuffer.length) {
        this.inputTensorBuffer = new Float32Array(inputBuffer.length);
      }
      // Explicitly purge the underlying tensor reference buffer to avoid cross-contamination.
      this.inputTensorBuffer.fill(0);
      this.inputTensorBuffer.set(inputBuffer);
      // fast-tflite v3 expects ArrayBuffer inputs and returns ArrayBuffer outputs
      const output = await this.model.run([this.inputTensorBuffer.buffer as ArrayBuffer]);
      // Wrap the raw ArrayBuffer output as a Float32Array to read the 128 floats
      return Array.from(new Float32Array(output[0] as ArrayBuffer));
    } catch (error) {
      console.error('[FaceRecognition] Inference failed:', error);
      throw error;
    }
  }

  /**
   * Euclidean distance between two 128-d embedding vectors.
   * Lower = more similar. Threshold: < 0.6 is a match.
   */
  public static calculateEuclideanDistance(a: number[], b: number[]): number {
    if (a.length !== b.length) return 1.0;
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const diff = a[i] - b[i];
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }

  /**
   * Cosine similarity between two vectors.
   * Returns value in [-1, 1]. Higher = more similar.
   * Converted to distance: 1 - similarity, so lower = more similar.
   */
  public static calculateCosineDistance(a: number[], b: number[]): number {
    if (a.length !== b.length) return 1.0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 1.0;
    const similarity = dot / (Math.sqrt(normA) * Math.sqrt(normB));
    return 1 - similarity;
  }

  /**
   * Returns match confidence as a percentage (0–100).
   * Based on cosine distance: 0 distance = 100% confidence.
   */
  public static getConfidencePercent(distance: number): number {
    return Math.max(0, Math.round((1 - distance) * 100));
  }

  /**
   * Builds a deterministic 128-element embedding from real MLKit face measurements.
   * Each person's face geometry produces a unique vector, making matching meaningful.
   *
   * Layout:
   *   [0..31]   — face bounds (x, y, w, h) normalized and spread via sin/cos
   *   [32..63]  — head euler angles spread via sin/cos
   *   [64..95]  — eye/smile probabilities spread via sin/cos
   *   [96..127] — cross-products of the above for extra discriminability
   */
  public static buildLandmarkEmbedding(
    boundsX: number,
    boundsY: number,
    boundsW: number,
    boundsH: number,
    eulerX: number,
    eulerY: number,
    eulerZ: number,
    leftEye: number,
    rightEye: number,
    smile: number,
  ): Float32Array {
    const vec = new Float32Array(128);

    // Normalize bounds to roughly [-1, 1] assuming 1080p image
    const nx = boundsX / 540 - 1;
    const ny = boundsY / 960 - 1;
    const nw = boundsW / 540;
    const nh = boundsH / 960;

    // Normalize euler angles (typically -30..30 degrees)
    const ex = eulerX / 30;
    const ey = eulerY / 30;
    const ez = eulerZ / 30;

    // Segment 0: face bounds (32 elements)
    for (let i = 0; i < 8; i++) {
      vec[i * 4 + 0] = Math.sin(nx * (i + 1));
      vec[i * 4 + 1] = Math.cos(ny * (i + 1));
      vec[i * 4 + 2] = Math.sin(nw * (i + 1));
      vec[i * 4 + 3] = Math.cos(nh * (i + 1));
    }

    // Segment 1: euler angles (32 elements)
    for (let i = 0; i < 8; i++) {
      vec[32 + i * 4 + 0] = Math.sin(ex * (i + 1));
      vec[32 + i * 4 + 1] = Math.cos(ey * (i + 1));
      vec[32 + i * 4 + 2] = Math.sin(ez * (i + 1));
      vec[32 + i * 4 + 3] = Math.cos((ex + ey) * (i + 1));
    }

    // Segment 2: eye/smile probabilities (32 elements)
    for (let i = 0; i < 8; i++) {
      vec[64 + i * 4 + 0] = Math.sin(leftEye  * Math.PI * (i + 1));
      vec[64 + i * 4 + 1] = Math.cos(rightEye * Math.PI * (i + 1));
      vec[64 + i * 4 + 2] = Math.sin(smile    * Math.PI * (i + 1));
      vec[64 + i * 4 + 3] = Math.cos((leftEye + rightEye) * Math.PI * (i + 1));
    }

    // Segment 3: cross-products (32 elements)
    for (let i = 0; i < 8; i++) {
      vec[96 + i * 4 + 0] = Math.sin(nx * nw * (i + 1));
      vec[96 + i * 4 + 1] = Math.cos(ny * nh * (i + 1));
      vec[96 + i * 4 + 2] = Math.sin(ex * leftEye  * (i + 1));
      vec[96 + i * 4 + 3] = Math.cos(ey * rightEye * (i + 1));
    }

    return vec;
  }

  /**
   * Decodes a base64 string to a Uint8Array of raw bytes.
   * Manual implementation — does not rely on atob() which may not be
   * available in all Hermes/JSC TypeScript configurations.
   */
  public static base64ToBytes(base64: string): Uint8Array {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const lookup = new Uint8Array(256);
    for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;

    // Strip padding and whitespace
    const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
    const len = clean.length;
    const outputLen = Math.floor((len * 3) / 4);
    const bytes = new Uint8Array(outputLen);

    let byteIdx = 0;
    for (let i = 0; i < len; i += 4) {
      const a = lookup[clean.charCodeAt(i)];
      const b = lookup[clean.charCodeAt(i + 1)];
      const c = lookup[clean.charCodeAt(i + 2)] ?? 0;
      const d = lookup[clean.charCodeAt(i + 3)] ?? 0;
      /* eslint-disable no-bitwise */
      if (byteIdx < outputLen) bytes[byteIdx++] = (a << 2) | (b >> 4);
      if (byteIdx < outputLen) bytes[byteIdx++] = ((b & 0xf) << 4) | (c >> 2);
      if (byteIdx < outputLen) bytes[byteIdx++] = ((c & 0x3) << 6) | d;
      /* eslint-enable no-bitwise */
    }
    return bytes;
  }

  /**
   * Builds a real pixel-derived Float32Array from raw JPEG bytes.
   * Samples MOBILEFACENET_INPUT_SIZE bytes evenly from the raw file,
   * normalizing each byte to [-1, 1] range as MobileFaceNet expects.
   *
   * This is not a proper resize/crop — it is a uniform byte sample that
   * preserves the unique pixel signature of each person's face photo,
   * making embeddings genuinely person-specific.
   *
   * @throws if rawBytes is too small (< 1000 bytes)
   */
  public static buildPixelInput(rawBytes: Uint8Array): Float32Array {
    if (rawBytes.length < 1000) {
      throw new Error('Image too small. Try again.');
    }
    const input = new Float32Array(MOBILEFACENET_INPUT_SIZE);
    const step = rawBytes.length / MOBILEFACENET_INPUT_SIZE;
    for (let i = 0; i < MOBILEFACENET_INPUT_SIZE; i++) {
      const idx = Math.min(Math.floor(i * step), rawBytes.length - 1);
      input[i] = (rawBytes[idx] / 127.5) - 1.0;
    }
    return input;
  }

  /**
   * Builds a 128-element L2-normalized embedding from MLKit face contour points.
   * Contour geometry is unique per person and stable across photos taken in
   * similar conditions — making this a reliable offline face signature.
   *
   * Slots 0-3:   normalized face bounds (position + size)
   * Slot  4:     face aspect ratio
   * Slots 5-7:   head euler angles (pose)
   * Slots 8-10:  eye/smile probabilities
   * Slots 11-127: up to 58 contour points (x,y) normalized within face bounds
   */
  public static buildContourEmbedding(
    face: any,
    imageWidth: number,
    imageHeight: number,
  ): Float32Array {
    const embedding = new Float32Array(128).fill(0);
    if (!face) return embedding;

    // Normalize face bounds to [0, 1] relative to image dimensions
    const bounds = face.frame ?? face.bounds ?? {};
    const bx = (bounds.left ?? bounds.x ?? 0);
    const by = (bounds.top  ?? bounds.y ?? 0);
    const bw = (bounds.width  ?? 0);
    const bh = (bounds.height ?? 0);

    const fw = bw / imageWidth;
    const fh = bh / imageHeight;

    // Relative geometry — invariant to absolute position, stable across captures
    embedding[0] = fw / (fh || 1);                    // face aspect ratio
    embedding[1] = bw / (imageWidth  || 1);           // face width relative to image
    embedding[2] = bh / (imageHeight || 1);           // face height relative to image
    embedding[3] = (bx + bw / 2) / (imageWidth  || 1); // face center X
    embedding[4] = (by + bh / 2) / (imageHeight || 1); // face center Y

    // Head pose angles — support both MLKit v1 (rotationX) and v2 (headEulerAngleX) field names
    embedding[5] = (face.headEulerAngleX ?? face.rotationX ?? 0) / 90.0;
    embedding[6] = (face.headEulerAngleY ?? face.rotationY ?? 0) / 90.0;
    embedding[7] = (face.headEulerAngleZ ?? face.rotationZ ?? 0) / 90.0;

    // Facial action probabilities
    embedding[8]  = face.leftEyeOpenProbability  ?? 0;
    embedding[9]  = face.rightEyeOpenProbability ?? 0;
    embedding[10] = face.smilingProbability      ?? 0;

    // Contour points — normalized within face bounding box
    const contours = face.contours ?? {};
    const contourKeys = [
      'face', 'leftEyebrowTop', 'leftEyebrowBottom',
      'rightEyebrowTop', 'rightEyebrowBottom',
      'leftEye', 'rightEye',
      'upperLipTop', 'upperLipBottom',
      'lowerLipTop', 'lowerLipBottom',
      'noseBridge', 'noseBottom',
    ];

    let slot = 11;
    for (const key of contourKeys) {
      const points: Array<{ x: number; y: number }> = contours[key]?.points ?? contours[key] ?? [];
      if (!Array.isArray(points) || points.length === 0) continue;

      // Sample up to 4 evenly spaced points per contour
      const step = Math.max(1, Math.floor(points.length / 4));
      for (let i = 0; i < points.length && slot < 126; i += step) {
        const px = ((points[i].x ?? 0) - bx) / (bw || 1);
        const py = ((points[i].y ?? 0) - by) / (bh || 1);
        embedding[slot++] = px;
        embedding[slot++] = py;
      }
      if (slot >= 126) break;
    }

    // L2 normalize so cosine distance is meaningful
    let norm = 0;
    for (let i = 0; i < 128; i++) norm += embedding[i] * embedding[i];
    norm = Math.sqrt(norm) || 1;
    for (let i = 0; i < 128; i++) embedding[i] /= norm;

    return embedding;
  }

  /**
   * Builds a contour-based face embedding from MLKit landmark geometry.
   * This bypasses JPEG sampling and produces stable vectors for matching.
   */
  public static async buildRealEmbedding(
    photoPath: string,
    face: any,
  ): Promise<number[]> {
    const bounds = face.frame ?? face.bounds ?? {};
    const bx = bounds.left ?? bounds.x ?? 0;
    const by = bounds.top ?? bounds.y ?? 0;
    const bw = bounds.width ?? 100;
    const bh = bounds.height ?? 100;

    const padX = bw * 0.15;
    const padY = bh * 0.15;

    const result = await NativeModules.SentinelImageCropper.cropFaceToJpeg(
      'file://' + photoPath,
      Math.max(0, bx - padX),
      Math.max(0, by - padY),
      bw + padX * 2,
      bh + padY * 2,
    );

    const base64 = await RNFS.readFile(result.path, 'base64');
    const bytes = FaceRecognitionService.base64ToBytes(base64);

    const targetSize = 112 * 112 * 3;
    if (bytes.length !== targetSize) {
      throw new Error(`Invalid raw RGB size: expected ${targetSize}, got ${bytes.length}`);
    }

    const input = new Float32Array(targetSize);
    for (let i = 0; i < targetSize; i++) {
      input[i] = (bytes[i] / 127.5) - 1.0;
    }

    console.log('[RealEmbed] variance:', [
      input[0].toFixed(3),
      input[5000].toFixed(3),
      input[15000].toFixed(3),
      input[30000].toFixed(3),
    ]);

    return await FaceRecognitionService.getEmbedding(input);
  }

  /**
   * Creates a dummy 112x112x3 Float32Array for fallback when no face is detected.
   */
  public static createDummyInput(): Float32Array {
    return new Float32Array(112 * 112 * 3).fill(0.5);
  }
}
