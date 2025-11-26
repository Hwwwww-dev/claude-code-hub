import schedule from "node-schedule";
import { logger } from "@/lib/logger";
import { cleanupLogs } from "./service";
import { getSystemSettings } from "@/repository/system-config";

/**
 * Cleanup job instance (single scheduled job)
 */
let cleanupJob: schedule.Job | null = null;

/**
 * Schedule auto cleanup based on system settings
 */
export async function scheduleAutoCleanup() {
  try {
    const settings = await getSystemSettings();

    if (!settings.enableAutoCleanup) {
      logger.info({ action: "auto_cleanup_disabled" });

      // Cancel existing scheduled job
      if (cleanupJob) {
        cleanupJob.cancel();
        cleanupJob = null;
        logger.info({ action: "cleanup_job_cancelled" });
      }

      return;
    }

    // Cancel old scheduled job before re-scheduling
    if (cleanupJob) {
      cleanupJob.cancel();
      cleanupJob = null;
    }

    // Build cleanup conditions (using default values)
    const retentionDays = settings.cleanupRetentionDays ?? 30;
    const batchSize = settings.cleanupBatchSize ?? 10000;
    const cronExpression = settings.cleanupSchedule ?? "0 2 * * *"; // Default: 2 AM daily

    // Schedule new cleanup job
    cleanupJob = schedule.scheduleJob("auto-cleanup", cronExpression, async () => {
      logger.info({
        action: "cleanup_job_start",
        schedule: cronExpression,
        retentionDays,
        batchSize,
      });

      try {
        // Calculate beforeDate at execution time (not at scheduling time)
        const beforeDate = new Date();
        beforeDate.setDate(beforeDate.getDate() - retentionDays);

        const result = await cleanupLogs(
          { beforeDate },
          { batchSize },
          { type: "scheduled" }
        );

        if (result.error) {
          logger.error({
            action: "cleanup_job_failed",
            error: result.error,
          });
        } else {
          logger.info({
            action: "cleanup_job_complete",
            totalDeleted: result.totalDeleted,
            durationMs: result.durationMs,
          });
        }
      } catch (error) {
        logger.error({
          action: "cleanup_job_error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    if (cleanupJob) {
      logger.info({
        action: "auto_cleanup_scheduled",
        schedule: cronExpression,
        retentionDays,
        batchSize,
      });
    }
  } catch (error) {
    logger.error({
      action: "schedule_auto_cleanup_error",
      error: error instanceof Error ? error.message : String(error),
    });

    // Fail Open: Schedule failure does not affect application startup
  }
}

/**
 * Stop cleanup queue (graceful shutdown)
 */
export async function stopCleanupQueue() {
  if (cleanupJob) {
    cleanupJob.cancel();
    cleanupJob = null;
    logger.info({ action: "cleanup_queue_closed" });
  }
}
