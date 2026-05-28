import NetInfo from '@react-native-community/netinfo';
import { OfflineDatabase } from '../database/OfflineDatabase';

export class AWSBackgroundSync {
  private static isSyncing = false;
  // httpbin.org/post echoes the payload back — valid stub for demo/hackathon
  private static readonly AWS_ENDPOINT = 'https://httpbin.org/post';

  /**
   * Starts a long-lived NetInfo listener.
   * When connectivity is restored, triggers sync & purge automatically.
   */
  public static startNetworkMonitoring(onStatusChange?: (msg: string) => void): void {
    console.log('[Sync] Background network sentinel active.');

    NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) {
        console.log('[Sync] Network restored. Triggering sync...');
        this.triggerCloudSync(onStatusChange);
      } else {
        console.log('[Sync] Offline — operating in zero-network zone.');
      }
    });
  }

  /**
   * POSTs all pending auth records to the AWS endpoint, then purges local storage.
   */
  private static async triggerCloudSync(onStatusChange?: (msg: string) => void): Promise<void> {
    if (this.isSyncing) return;

    const pending = await OfflineDatabase.getRecords();
    if (pending.length === 0) {
      console.log('[Sync] Ledger clean — nothing to sync.');
      return;
    }

    this.isSyncing = true;
    onStatusChange?.('Network Restored: Syncing to AWS...');

    try {
      console.log(`[Sync] Uploading ${pending.length} records to ${this.AWS_ENDPOINT}`);

      const response = await fetch(this.AWS_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'SentinelGuard',
          records: pending,
          syncedAt: new Date().toISOString(),
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      console.log('[Sync] Upload confirmed. Purging local ledger...');
      await OfflineDatabase.purgeRecords();
      onStatusChange?.('Sync Complete: Local Log Purged.');
    } catch (error) {
      console.error('[Sync] Upload failed. Records retained for next window:', error);
      onStatusChange?.('Sync Error: Retaining data offline.');
    } finally {
      this.isSyncing = false;
    }
  }
}
