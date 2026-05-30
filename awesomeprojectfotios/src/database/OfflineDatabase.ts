import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Auth transaction record ──────────────────────────────────────────────────
export interface ScanRecord {
  id: string;
  timestamp: string;
  status: string;
  vectorId: string;
}

// ─── Enrolled face embedding record ──────────────────────────────────────────
export interface EnrolledFace {
  userId: string;
  embedding: number[];
  enrolledAt: string;
}

const LEDGER_KEY = '@SentinelGuard:OfflineLedger';
const ENROLLMENT_KEY = '@SentinelGuard:EnrolledFaces';

export class OfflineDatabase {
  // ─── Auth transaction ledger ──────────────────────────────────────────────

  public static async saveRecord(record: ScanRecord): Promise<void> {
    try {
      const existing = await this.getRecords();
      existing.push(record);
      await AsyncStorage.setItem(LEDGER_KEY, JSON.stringify(existing));
      console.log(`[Database] Auth log saved. Total cached: ${existing.length}`);
    } catch (error) {
      console.error('[Database] Failed to write auth record:', error);
    }
  }

  public static async getRecords(): Promise<ScanRecord[]> {
    try {
      const data = await AsyncStorage.getItem(LEDGER_KEY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  public static async purgeRecords(): Promise<void> {
    try {
      await AsyncStorage.removeItem(LEDGER_KEY);
      console.log('[Database] PURGE COMPLETE: Auth ledger wiped.');
    } catch (error) {
      console.error('[Database] Failed to purge ledger:', error);
    }
  }

  // ─── Face enrollment store ────────────────────────────────────────────────

  /**
   * Saves a face embedding. Does NOT overwrite existing entries —
   * each enrollment is uniquely identified by userId (name + timestamp suffix).
   */
  public static async saveEnrollment(face: EnrolledFace): Promise<void> {
    try {
      const existing = await this.getAllEnrollments();
      existing.push(face);
      await AsyncStorage.setItem(ENROLLMENT_KEY, JSON.stringify(existing));
      console.log(`[Database] Enrollment saved for user: ${face.userId}`);
    } catch (error) {
      console.error('[Database] Failed to save enrollment:', error);
    }
  }

  /**
   * Returns all enrolled face embeddings.
   */
  public static async getAllEnrollments(): Promise<EnrolledFace[]> {
    try {
      const data = await AsyncStorage.getItem(ENROLLMENT_KEY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  /**
   * Returns the enrollment for a specific user ID, or null if not found.
   */
  public static async getEnrollment(userId: string): Promise<EnrolledFace | null> {
    const all = await this.getAllEnrollments();
    return all.find((e) => e.userId === userId) ?? null;
  }

  /**
   * Checks whether any face has been enrolled.
   */
  public static async hasEnrollment(): Promise<boolean> {
    const all = await this.getAllEnrollments();
    return all.length > 0;
  }

  /**
   * Deletes a single enrollment by userId.
   */
  public static async deleteEnrollment(userId: string): Promise<void> {
    try {
      const existing = await this.getAllEnrollments();
      const filtered = existing.filter((e) => e.userId !== userId);
      await AsyncStorage.setItem(ENROLLMENT_KEY, JSON.stringify(filtered));
      console.log(`[Database] Enrollment deleted for user: ${userId}`);
    } catch (error) {
      console.error('[Database] Failed to delete enrollment:', error);
    }
  }

  /**
   * Clears all enrolled faces (for re-enrollment).
   */
  public static async clearEnrollments(): Promise<void> {
    try {
      await AsyncStorage.removeItem(ENROLLMENT_KEY);
      console.log('[Database] All enrollments cleared.');
    } catch (error) {
      console.error('[Database] Failed to clear enrollments:', error);
    }
  }
}
