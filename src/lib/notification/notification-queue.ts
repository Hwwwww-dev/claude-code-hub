import schedule from "node-schedule";
import { logger } from "@/lib/logger";
import { sendWeChatNotification } from "@/lib/wechat/bot";
import {
  buildCircuitBreakerAlert,
  buildDailyLeaderboard,
  buildCostAlert,
  CircuitBreakerAlertData,
  DailyLeaderboardData,
  CostAlertData,
} from "@/lib/wechat/message-templates";
import { generateDailyLeaderboard } from "./tasks/daily-leaderboard";
import { generateCostAlerts } from "./tasks/cost-alert";

/**
 * Notification job type
 */
export type NotificationJobType = "circuit-breaker" | "daily-leaderboard" | "cost-alert";

/**
 * Notification job data
 */
export interface NotificationJobData {
  type: NotificationJobType;
  webhookUrl: string;
  data?: CircuitBreakerAlertData | DailyLeaderboardData | CostAlertData;
}

/**
 * Store active scheduled jobs
 */
const scheduledJobs = new Map<string, schedule.Job>();

/**
 * Process notification job
 */
async function processNotification(jobData: NotificationJobData): Promise<{ success: boolean; skipped?: boolean }> {
  const { type, webhookUrl, data } = jobData;

  logger.info({
    action: "notification_job_start",
    type,
  });

  try {
    let content: string;
    switch (type) {
      case "circuit-breaker":
        content = buildCircuitBreakerAlert(data as CircuitBreakerAlertData);
        break;
      case "daily-leaderboard": {
        // Dynamically generate leaderboard data
        const { getNotificationSettings } = await import("@/repository/notifications");
        const settings = await getNotificationSettings();
        const leaderboardData = await generateDailyLeaderboard(
          settings.dailyLeaderboardTopN || 5
        );

        if (!leaderboardData) {
          logger.info({
            action: "daily_leaderboard_no_data",
          });
          return { success: true, skipped: true };
        }

        content = buildDailyLeaderboard(leaderboardData);
        break;
      }
      case "cost-alert": {
        // Dynamically generate cost alert data
        const { getNotificationSettings } = await import("@/repository/notifications");
        const settings = await getNotificationSettings();
        const alerts = await generateCostAlerts(
          parseFloat(settings.costAlertThreshold || "0.80")
        );

        if (alerts.length === 0) {
          logger.info({
            action: "cost_alert_no_data",
          });
          return { success: true, skipped: true };
        }

        // Send first alert (can be extended to batch send)
        content = buildCostAlert(alerts[0]);
        break;
      }
      default:
        throw new Error(`Unknown notification type: ${type}`);
    }

    // Send notification
    const result = await sendWeChatNotification(webhookUrl, content);

    if (!result.success) {
      throw new Error(result.error || "Failed to send notification");
    }

    logger.info({
      action: "notification_job_complete",
      type,
    });

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error({
      action: "notification_job_error",
      type,
      error: errorMessage,
    });

    throw error;
  }
}

/**
 * Add notification job (execute immediately)
 */
export async function addNotificationJob(
  type: NotificationJobType,
  webhookUrl: string,
  data: CircuitBreakerAlertData | DailyLeaderboardData | CostAlertData
): Promise<void> {
  try {
    // Execute immediately
    await processNotification({
      type,
      webhookUrl,
      data,
    });

    logger.info({
      action: "notification_job_added",
      type,
    });
  } catch (error) {
    logger.error({
      action: "notification_job_add_error",
      type,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Schedule notifications based on settings
 */
export async function scheduleNotifications() {
  try {
    // Dynamic import to avoid circular dependency
    const { getNotificationSettings } = await import("@/repository/notifications");
    const settings = await getNotificationSettings();

    if (!settings.enabled) {
      logger.info({ action: "notifications_disabled" });

      // Cancel all existing scheduled jobs
      for (const [jobId, job] of scheduledJobs) {
        job.cancel();
        scheduledJobs.delete(jobId);
        logger.info({ action: "notification_job_cancelled", jobId });
      }

      return;
    }

    // Cancel old scheduled jobs before re-scheduling
    for (const [jobId, job] of scheduledJobs) {
      job.cancel();
      scheduledJobs.delete(jobId);
    }

    // Schedule daily leaderboard job
    if (
      settings.dailyLeaderboardEnabled &&
      settings.dailyLeaderboardWebhook &&
      settings.dailyLeaderboardTime
    ) {
      const [hour, minute] = settings.dailyLeaderboardTime.split(":").map(Number);
      const cronExpression = `${minute} ${hour} * * *`; // Every day at specified time

      const job = schedule.scheduleJob("daily-leaderboard-scheduled", cronExpression, async () => {
        logger.info({
          action: "daily_leaderboard_job_triggered",
          schedule: cronExpression,
        });

        try {
          await processNotification({
            type: "daily-leaderboard",
            webhookUrl: settings.dailyLeaderboardWebhook!,
          });
        } catch (error) {
          logger.error({
            action: "daily_leaderboard_job_failed",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });

      if (job) {
        scheduledJobs.set("daily-leaderboard-scheduled", job);
        logger.info({
          action: "daily_leaderboard_scheduled",
          schedule: cronExpression,
        });
      }
    }

    // Schedule cost alert job
    if (settings.costAlertEnabled && settings.costAlertWebhook) {
      const interval = settings.costAlertCheckInterval; // minutes
      const cronExpression = `*/${interval} * * * *`; // Every N minutes

      const job = schedule.scheduleJob("cost-alert-scheduled", cronExpression, async () => {
        logger.info({
          action: "cost_alert_job_triggered",
          schedule: cronExpression,
        });

        try {
          await processNotification({
            type: "cost-alert",
            webhookUrl: settings.costAlertWebhook!,
          });
        } catch (error) {
          logger.error({
            action: "cost_alert_job_failed",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });

      if (job) {
        scheduledJobs.set("cost-alert-scheduled", job);
        logger.info({
          action: "cost_alert_scheduled",
          schedule: cronExpression,
          intervalMinutes: interval,
        });
      }
    }

    logger.info({ action: "notifications_scheduled" });
  } catch (error) {
    logger.error({
      action: "schedule_notifications_error",
      error: error instanceof Error ? error.message : String(error),
    });

    // Fail Open: Schedule failure does not affect application startup
  }
}

/**
 * Stop notification queue (graceful shutdown)
 */
export async function stopNotificationQueue() {
  for (const [jobId, job] of scheduledJobs) {
    job.cancel();
    scheduledJobs.delete(jobId);
  }
  logger.info({ action: "notification_queue_closed" });
}
