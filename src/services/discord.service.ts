import {
  Guild,
  CategoryChannel,
  TextChannel,
  Role,
  ChannelType,
  GuildScheduledEventCreateOptions,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
} from 'discord.js';
import logger from '../utils/logger';
import { config } from '../config/env';
import databaseService from './database.service';
import { isCtfLive } from '../utils/ctf-visibility';

/**
 * Discord helper service for managing channels, roles, and permissions
 */
class DiscordService {
  /**
   * Create CTF category with channels and role
   */
  async createCTFCategory(
    guild: Guild,
    name: string
  ): Promise<{
    category: CategoryChannel;
    role: Role;
    infoChannel: TextChannel;
  } | null> {
    try {
      const normalizedName = name.trim();

      // Create role
      const role = await guild.roles.create({
        name: normalizedName.toLowerCase(),
        mentionable: false,
        position: 1,
      });

      logger.info(`Created role: ${role.name}`);

      // Create category
      const category = await guild.channels.create({
        name: normalizedName,
        type: ChannelType.GuildCategory,
      });

      // Live-phase visibility: active role only
      await this.applyLivePermissions(guild, category.id, role.id);

      logger.info(`Created category: ${category.name}`);

      // Create info channel (read-only for @everyone)
      const infoChannel = await guild.channels.create({
        name: normalizedName,
        type: ChannelType.GuildText,
        parent: category.id,
      });

      await infoChannel.permissionOverwrites.create(guild.roles.everyone, {
        SendMessages: false,
      });

      logger.info(`Created info channel: ${infoChannel.name}`);

      // Create other challenge channels
      const channelNames = ['general', 'web', 'crypto', 'pwn', 'rev', 'forensics'];

      for (const channelName of channelNames) {
        await guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          parent: category.id,
        });
        logger.debug(`Created channel: ${channelName}`);
      }

      return { category, role, infoChannel };
    } catch (error) {
      logger.error('Error creating CTF category:', error);
      return null;
    }
  }

  /**
   * Create special/manual CTF category (not from CTFtime)
   */
  async createSpecialCTFCategory(
    guild: Guild,
    name: string
  ): Promise<{
    category: CategoryChannel;
    role: Role;
    generalChannel: TextChannel;
  } | null> {
    try {
      const normalizedName = name.trim();

      // Create role (with angle brackets for special CTFs)
      const role = await guild.roles.create({
        name: `<${normalizedName}>`,
        mentionable: true,
        position: 1,
      });

      logger.info(`Created special role: ${role.name}`);

      // Create category
      const category = await guild.channels.create({
        name: normalizedName,
        type: ChannelType.GuildCategory,
      });

      // Live-phase visibility: active role only
      await this.applyLivePermissions(guild, category.id, role.id);

      logger.info(`Created special category: ${category.name}`);

      // Create general channel
      const generalChannel = await guild.channels.create({
        name: normalizedName,
        type: ChannelType.GuildText,
        parent: category.id,
      });

      // Create challenge channels (fewer for manual CTFs)
      const channelNames = ['web', 'crypto', 'pwn-rev'];

      for (const channelName of channelNames) {
        await guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          parent: category.id,
        });
      }

      return { category, role, generalChannel };
    } catch (error) {
      logger.error('Error creating special CTF category:', error);
      return null;
    }
  }

  /**
   * Archive CTF category (hide from @everyone)
   */
  async archiveCTFCategory(guild: Guild, categoryId: string, infoChannelId?: string): Promise<boolean> {
    try {
      const category = guild.channels.cache.get(categoryId) as CategoryChannel;

      if (!category) {
        logger.warn(`Category not found: ${categoryId}`);
        return false;
      }

      await category.permissionOverwrites.create(guild.roles.everyone, {
        ViewChannel: false,
      });

      // Also fix info channel permissions so it doesn't remain visible
      if (infoChannelId) {
        const infoChannel = guild.channels.cache.get(infoChannelId) as TextChannel;
        if (infoChannel) {
          await infoChannel.permissionOverwrites.create(guild.roles.everyone, {
            ViewChannel: false,
            SendMessages: false,
          });
          logger.info(`Locked info channel permissions: ${infoChannel.name}`);
        }
      }

      logger.info(`Archived category: ${category.name}`);
      return true;
    } catch (error) {
      logger.error('Error archiving category:', error);
      return false;
    }
  }

  /**
   * Delete CTF category and all channels
   */
  async deleteCTFCategory(guild: Guild, categoryId: string): Promise<boolean> {
    try {
      const category = guild.channels.cache.get(categoryId) as CategoryChannel;

      if (!category) {
        logger.warn(`Category not found: ${categoryId}`);
        return false;
      }

      // Delete all channels in category
      for (const [, channel] of category.children.cache) {
        await channel.delete();
        logger.debug(`Deleted channel: ${channel.name}`);
      }

      // Delete category
      await category.delete();
      logger.info(`Deleted category: ${category.name}`);

      return true;
    } catch (error) {
      logger.error('Error deleting category:', error);
      return false;
    }
  }

  /**
   * Unlist CTF category (make it visible but rename with [UNLISTED] prefix)
   */
  async unlistCTFCategory(guild: Guild, categoryId: string): Promise<boolean> {
    try {
      const category = guild.channels.cache.get(categoryId) as CategoryChannel;

      if (!category) {
        logger.warn(`Category not found: ${categoryId}`);
        return false;
      }

      await category.setName(`[UNLISTED] ${category.name}`);
      await category.permissionOverwrites.create(guild.roles.everyone, {
        ViewChannel: true,
      });

      logger.info(`Unlisted category: ${category.name}`);
      return true;
    } catch (error) {
      logger.error('Error unlisting category:', error);
      return false;
    }
  }

  /**
   * Re-list an unlisted category
   */
  async relistCTFCategory(guild: Guild, categoryId: string, _roleName: string): Promise<Role | null> {
    try {
      const category = guild.channels.cache.get(categoryId) as CategoryChannel;

      if (!category) {
        logger.warn(`Category not found: ${categoryId}`);
        return null;
      }

      // Remove [UNLISTED] prefix if present
      let newName = category.name;
      if (newName.startsWith('[UNLISTED]')) {
        newName = newName.replace('[UNLISTED]', '').trim();
        await category.setName(newName);
      }

      // Create role
      const role = await guild.roles.create({
        name: `<${newName}>`,
        position: 1,
      });

      // Get the VIEW_ALL_CTF role
      const viewAllRole = guild.roles.cache.get(config.VIEW_ALL_CTF_ROLEID);

      // Set permissions
      await category.permissionOverwrites.create(role, {
        ViewChannel: true,
      });

      if (viewAllRole) {
        await category.permissionOverwrites.create(viewAllRole, {
          ViewChannel: true,
        });
      }

      await category.permissionOverwrites.create(guild.roles.everyone, {
        ViewChannel: false,
      });

      // Sync permissions for all channels in category
      for (const [, channel] of category.children.cache) {
        await channel.lockPermissions();
      }

      logger.info(`Re-listed category: ${category.name}`);
      return role;
    } catch (error) {
      logger.error('Error re-listing category:', error);
      return null;
    }
  }

  /**
   * Live-phase category visibility: active role only (plus DENY deny).
   * Removes any per-CTF / VIEW_ALL grants so only active-role members can see it.
   */
  async applyLivePermissions(
    guild: Guild,
    categoryId: string,
    perCtfRoleId: string
  ): Promise<void> {
    const category = guild.channels.cache.get(categoryId) as CategoryChannel | undefined;
    if (!category) {
      logger.warn(`applyLivePermissions: category not found: ${categoryId}`);
      return;
    }

    await category.permissionOverwrites.edit(config.ACTIVE_CTF_ROLEID, { ViewChannel: true });

    if (config.DENY_CTF_ROLEID) {
      await category.permissionOverwrites.edit(config.DENY_CTF_ROLEID, { ViewChannel: false });
    }

    // Ensure the per-CTF role and VIEW_ALL role cannot see it while live.
    for (const roleId of [perCtfRoleId, config.VIEW_ALL_CTF_ROLEID]) {
      if (roleId && category.permissionOverwrites.cache.has(roleId)) {
        await category.permissionOverwrites.delete(roleId);
      }
    }
  }

  /**
   * Ended-phase category visibility: additionally grant per-CTF role + VIEW_ALL.
   * The active-role grant is intentionally left in place.
   */
  async applyEndedPermissions(
    guild: Guild,
    categoryId: string,
    perCtfRoleId: string
  ): Promise<void> {
    const category = guild.channels.cache.get(categoryId) as CategoryChannel | undefined;
    if (!category) {
      logger.warn(`applyEndedPermissions: category not found: ${categoryId}`);
      return;
    }

    if (perCtfRoleId) {
      await category.permissionOverwrites.edit(perCtfRoleId, { ViewChannel: true });
    }
    await category.permissionOverwrites.edit(config.VIEW_ALL_CTF_ROLEID, { ViewChannel: true });
  }

  /**
   * Revert any CTF whose time has run out to ended-phase visibility.
   * Idempotent via the post_end_opened flag. Returns the number reverted.
   * Best-effort: a failure on one CTF is logged and skipped (retried next
   * sweep) rather than aborting the batch or throwing to the caller.
   */
  async syncEndedCTFs(guild: Guild): Promise<number> {
    const all = await databaseService.getAllCTFs();
    const now = Math.floor(Date.now() / 1000);
    let reverted = 0;

    for (const { key, data } of all) {
      if (data.archived || data.channelsPurged) continue;
      if (!data.cate || data.cate === '0') continue;
      if (data.postEndOpened) continue;
      if (isCtfLive(data.endtime, now)) continue;
      if (!guild.channels.cache.has(data.cate)) continue;

      try {
        await this.applyEndedPermissions(guild, data.cate, data.role);
        await databaseService.updateCTF(key, { postEndOpened: true });
        reverted++;
        logger.info(`Reverted ended CTF to normal visibility: ${data.name}`);
      } catch (error) {
        logger.error(`Error reverting ended CTF to normal visibility: ${data.name}`, error);
        continue;
      }
    }

    return reverted;
  }

  /**
   * Create Discord scheduled event for CTF
   */
  async createCTFEvent(
    guild: Guild,
    name: string,
    startTime: Date,
    endTime: Date
  ): Promise<boolean> {
    try {
      const eventOptions: GuildScheduledEventCreateOptions = {
        name,
        description: `CTF Event: ${name}`,
        scheduledStartTime: startTime,
        scheduledEndTime: endTime,
        entityType: GuildScheduledEventEntityType.External,
        privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
        entityMetadata: {
          location: 'SoICT, B1-403',
        },
      };

      await guild.scheduledEvents.create(eventOptions);
      logger.info(`Created scheduled event: ${name}`);
      return true;
    } catch (error) {
      logger.error('Error creating scheduled event:', error);
      return false;
    }
  }
}

export default new DiscordService();
