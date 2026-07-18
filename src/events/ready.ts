import { Client, ActivityType, PresenceUpdateStatus, TextChannel } from 'discord.js';
import { statuses } from '../data/statuses';
import databaseService from '../services/database.service';
import logger from '../utils/logger';
import { config } from '../config/env';
import ctfSchedulerService from '../services/ctf-scheduler.service';

let statusIndex = 0;

/**
 * Handle bot ready event
 */
export async function handleReady(client: Client) {
  if (!client.user) return;

  logger.info(`${client.user.tag} is running!`);

  // Ensure database exists
  await databaseService.ensureDatabase();

  // Log to Discord channel if configured
  if (config.LOG_CHANNELID) {
    try {
      const channel = await client.channels.fetch(config.LOG_CHANNELID);
      if (channel && channel.isTextBased()) {
        await (channel as TextChannel).send('Bot restarted');
      }
    } catch (error) {
      logger.warn('Could not send restart message to log channel:', error);
    }
  }

  // Start status rotation
  startStatusRotation(client);
  ctfSchedulerService.start(client);

  logger.info('Bot is ready and all systems operational');
}

/**
 * Start rotating bot status messages
 */
function startStatusRotation(client: Client) {
  // Set initial status
  updateStatus(client);

  // Update status every minute
  setInterval(() => {
    updateStatus(client);
  }, 60000); // 1 minute
}

/**
 * Update bot status with random message
 */
function updateStatus(client: Client) {
  if (!client.user) return;

  // Get random status or cycle through them
  const status = statuses[statusIndex % statuses.length];
  statusIndex++;

  client.user.setPresence({
    status: PresenceUpdateStatus.Idle,
    activities: [
      {
        name: 'bkseg-ing',
        state: status,
        type: ActivityType.Custom,
      },
    ],
  });

  logger.debug(`Status updated: ${status}`);
}
