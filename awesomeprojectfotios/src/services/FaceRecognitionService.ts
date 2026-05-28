import { loadTensorflowModel } from 'react-native-fast-tflite';
import { Platform } from 'react-native';
import type { TfliteModel } from 'react-native-fast-tflite/src/specs/Tflite.nitro';

// react-native-fast-tflite v3 API:
//   model.run(inputs: ArrayBuffer[]) => Promise<ArrayBuffer[]>
// So we pass inputBuffer.buffer and wrap output in Float32Array.

export class FaceRecognitionService {
  private static model: TfliteModel | null = null;

  // Similarity threshold — distance below this is considered a match
  public static readonly MATCH_THRESHOLD = 0.6;

  /**
   * Loads the MobileFaceNet TFLite model from app assets.
   * Safe to call multiple times — only loads once.
   */
  public static async initModel(): Promise<void> {
    if (this.model) return;
    try {
      this.model = await loadTensorflowModel(
        require('../models/mobilefacenet.tflite'), Platform.OS === 'ios' ? ['core-ml'] : []
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
      // fast-tflite v3 expects ArrayBuffer inputs and returns ArrayBuffer outputs
      const output = await this.model.run([inputBuffer.buffer as ArrayBuffer]);
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
   * Creates a dummy 112x112x3 Float32Array for testing when no real frame is available.
   * In production this is replaced by actual frame pixel data.
   */
  public static createDummyInput(): Float32Array {
    return new Float32Array(112 * 112 * 3).fill(0.5);
  }
}
