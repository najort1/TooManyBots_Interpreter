import fs from 'fs';
import path from 'path';

export function createMaintenanceController({
  handoffMediaDir,
  getConfig,
  getLogger,
  getDatabaseInfo,
  getDbSizeSnapshotMaintenanceTimer,
  setDbSizeSnapshotMaintenanceTimer,
  getMediaCleanupTimer,
  setMediaCleanupTimer,
  getHandoffMediaMaintenanceStats,
} = {}) {
  function startDbSizeSnapshotMaintenance() {
    if (getDbSizeSnapshotMaintenanceTimer()) return;
    const intervalMs = Math.max(
      60 * 60 * 1000,
      Number(process.env.TMB_DB_SIZE_SNAPSHOT_INTERVAL_MS) || (60 * 60 * 1000)
    );
    const timer = setInterval(() => {
      try {
        getDatabaseInfo();
      } catch (err) {
        // Non-fatal: snapshot will be retried on the next interval tick.
        getLogger()?.warn?.(
          { error: String(err?.message || err) },
          'DB size snapshot maintenance failed'
        );
      }
    }, intervalMs);
    setDbSizeSnapshotMaintenanceTimer(timer);

    if (typeof timer.unref === 'function') {
      timer.unref();
    }
  }

  function cleanupHandoffMediaFiles({ reason = 'manual' } = {}) {
    const config = getConfig();
    const stats = getHandoffMediaMaintenanceStats();
    const startedAt = Date.now();
    const retentionMs = Math.max(60 * 1000, Number(config?.handoffMediaRetentionMinutes ?? 180) * 60 * 1000);
    const maxStorageBytes = Math.max(32 * 1024 * 1024, Number(config?.handoffMediaMaxStorageMb ?? 512) * 1024 * 1024);

    const summary = {
      reason: String(reason || 'manual'),
      scannedFiles: 0,
      deletedFiles: 0,
      deletedBytes: 0,
      totalBytesAfter: 0,
      durationMs: 0,
    };

    try {
      fs.mkdirSync(handoffMediaDir, { recursive: true });
      const nowTs = Date.now();
      const entries = fs.readdirSync(handoffMediaDir, { withFileTypes: true });
      const files = [];

      for (const entry of entries) {
        if (!entry?.isFile?.()) continue;
        const fullPath = path.resolve(handoffMediaDir, entry.name);
        try {
          const stat = fs.statSync(fullPath);
          if (!stat.isFile()) continue;
          files.push({
            fullPath,
            size: Math.max(0, Number(stat.size) || 0),
            mtimeMs: Math.max(0, Number(stat.mtimeMs) || 0),
          });
        } catch {
          // ignore transient stat errors
        }
      }

      summary.scannedFiles = files.length;
      files.sort((a, b) => a.mtimeMs - b.mtimeMs);

      let totalBytes = files.reduce((acc, item) => acc + item.size, 0);
      const keep = [];

      for (const file of files) {
        const fileAgeMs = Math.max(0, nowTs - file.mtimeMs);
        if (fileAgeMs > retentionMs) {
          try {
            fs.unlinkSync(file.fullPath);
            summary.deletedFiles += 1;
            summary.deletedBytes += file.size;
            totalBytes -= file.size;
          } catch {
            keep.push(file);
          }
        } else {
          keep.push(file);
        }
      }

      for (const file of keep) {
        if (totalBytes <= maxStorageBytes) break;
        try {
          fs.unlinkSync(file.fullPath);
          summary.deletedFiles += 1;
          summary.deletedBytes += file.size;
          totalBytes -= file.size;
        } catch {
          // ignore unlink errors
        }
      }

      summary.totalBytesAfter = Math.max(0, totalBytes);
      summary.durationMs = Math.max(0, Date.now() - startedAt);

      stats.runs += 1;
      stats.deletedFiles += summary.deletedFiles;
      stats.deletedBytes += summary.deletedBytes;
      stats.lastRunAt = Date.now();
      stats.lastDurationMs = summary.durationMs;
      stats.lastSummary = summary;
      stats.lastError = '';

      if (summary.deletedFiles > 0) {
        getLogger()?.info?.(
          {
            reason: summary.reason,
            deletedFiles: summary.deletedFiles,
            deletedBytes: summary.deletedBytes,
            totalBytesAfter: summary.totalBytesAfter,
          },
          'Handoff media cleanup removed transient files'
        );
      }
    } catch (error) {
      stats.lastError = String(error?.message || error);
    }

    return summary;
  }

  function startHandoffMediaMaintenance() {
    if (getMediaCleanupTimer()) return;
    const config = getConfig();
    const intervalMs = Math.max(60 * 1000, Number(config?.handoffMediaCleanupIntervalMinutes ?? 15) * 60 * 1000);
    const timer = setInterval(() => {
      cleanupHandoffMediaFiles({ reason: 'interval' });
    }, intervalMs);
    setMediaCleanupTimer(timer);
    if (typeof timer.unref === 'function') {
      timer.unref();
    }
  }

  return {
    startDbSizeSnapshotMaintenance,
    cleanupHandoffMediaFiles,
    startHandoffMediaMaintenance,
  };
}
