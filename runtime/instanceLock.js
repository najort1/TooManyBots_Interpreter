import fs from 'fs';
import path from 'path';

/**
 * runtime/instanceLock.js
 *
 * PID-based single-instance lock backed by a JSON file.
 *
 * The lock file stores the owning PID and creation timestamp so that
 * post-crash orphaned locks (e.g. after kill -9 or OOM) are automatically
 * detected and overridden on the next startup with a diagnostic warning
 * logged so operators can see post-crash recovery in production logs.
 *
 * Extracted from index.js to reduce the size of the entry point and to make
 * the lock lifecycle independently testable.
 */

/**
 * Checks whether a process with the given PID is currently alive.
 *
 * Returns `true` if the process exists OR if we lack permission to signal it (EPERM).
 * Returns `false` if the process does not exist (ESRCH).
 *
 * @param {number} pid
 * @returns {boolean}
 */
export function isPidAlive(pid) {
  const safePid = Number(pid);
  if (!Number.isInteger(safePid) || safePid <= 0) return false;
  try {
    process.kill(safePid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

/**
 * Creates a PID-based single-instance lock factory.
 *
 * @param {string} lockFilePath - Absolute path for the JSON lock file.
 * @returns {{ acquire(): void, release(): void, isHeld(): boolean }}
 *
 * @example
 * const lock = createInstanceLock('/data/runtime.lock');
 * lock.acquire(); // throws if another live instance holds it
 * // ... startup logic ...
 * lock.release(); // called on SIGINT / SIGTERM / exit
 */
export function createInstanceLock(lockFilePath) {
  let held = false;

  /**
   * Acquires the lock. Throws if another live process holds it.
   * Silently overrides stale locks from dead processes, logging a warning.
   *
   * @throws {Error} When another live process holds the lock.
   */
  function acquire() {
    fs.mkdirSync(path.dirname(lockFilePath), { recursive: true });

    if (fs.existsSync(lockFilePath)) {
      try {
        const raw = fs.readFileSync(lockFilePath, 'utf-8');
        const parsed = JSON.parse(raw);
        const previousPid = Number(parsed?.pid) || 0;

        if (previousPid > 0 && previousPid !== process.pid && isPidAlive(previousPid)) {
          throw new Error(`Outra instancia do runtime esta ativa (pid=${previousPid}).`);
        }

        // PID is dead: lock is orphaned (post-crash or kill -9).
        // isPidAlive() already handles the safety check above. Log the recovery
        // so operators have visibility into stale-lock overrides in production logs.
        if (previousPid > 0 && previousPid !== process.pid) {
          const staleSinceMs = Date.now() - (Number(parsed?.startedAt) || 0);
          console.warn(
            `[runtime] Lock file orfao detectado: pid=${previousPid} nao esta mais ativo` +
            ` (ha ${Math.round(staleSinceMs / 1000)}s). Sobrescrevendo.`
          );
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes('Outra instancia')) {
          throw error;
        }
        // Lock file corrompido ou ilegivel: nao bloqueia a inicializacao, sobrescreve com seguranca.
      }
    }

    fs.writeFileSync(
      lockFilePath,
      JSON.stringify({ pid: process.pid, startedAt: Date.now(), cwd: process.cwd() }),
      'utf-8'
    );
    held = true;
  }

  /**
   * Releases the lock by deleting the file only if it still belongs to this process.
   * Safe to call multiple times or when the lock was never acquired.
   */
  function release() {
    if (!held) return;
    held = false;
    try {
      if (!fs.existsSync(lockFilePath)) return;
      const raw = fs.readFileSync(lockFilePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Number(parsed?.pid) !== process.pid) return;
      fs.unlinkSync(lockFilePath);
    } catch {
      // Transient FS error during shutdown: safe to ignore.
    }
  }

  /** Returns `true` if this process currently holds the lock. */
  function isHeld() {
    return held;
  }

  return { acquire, release, isHeld };
}
