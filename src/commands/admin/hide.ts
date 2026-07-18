import { SlashCommandBuilder, ChatInputCommandInteraction, TextChannel } from 'discord.js';
import { Command } from '../../types';
import databaseService from '../../services/database.service';
import discordService from '../../services/discord.service';
import logger from '../../utils/logger';
import { config } from '../../config/env';
import { requireAdmin } from '../../utils/role.guard';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('admin-hide')
    .setDescription('Ẩn các CTF cũ ngay lập tức [autorun cùng /reg]'),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      if (!(await requireAdmin(interaction))) return;

      if (!interaction.guild) {
        await interaction.reply({ content: 'This command must be used in a server', ephemeral: true });
        return;
      }

      await interaction.reply({ content: 'Hiding old CTF... Please wait', ephemeral: true });

      const currentTime = Math.floor(Date.now() / 1000);
      const expiredCTFs = await databaseService.getExpiredCTFs(currentTime);

      if (expiredCTFs.length === 0) {
        if (config.LOG_CHANNELID) {
          const logChannel = interaction.guild.channels.cache.get(config.LOG_CHANNELID) as TextChannel;
          if (logChannel) {
            await logChannel.send(
              `Request to hide some CTFs has NOT been fulfilled (reason: no CTF has reached endtime) (requested by ${interaction.user.username})`
            );
          }
        }
        return;
      }

      // Hide expired CTFs
      for (const ctf of expiredCTFs) {
        await discordService.archiveCTFCategory(interaction.guild, ctf.data.cate, ctf.data.channel);
        await databaseService.updateCTF(ctf.key, { archived: true });

        if (config.LOG_CHANNELID) {
          const logChannel = interaction.guild.channels.cache.get(config.LOG_CHANNELID) as TextChannel;
          if (logChannel) {
            await logChannel.send(`${ctf.data.name} has been hidden`);
          }
        }

        logger.info(`CTF archived: ${ctf.data.name} (endtime: ${ctf.data.endtime})`);
      }

      if (config.LOG_CHANNELID) {
        const logChannel = interaction.guild.channels.cache.get(config.LOG_CHANNELID) as TextChannel;
        if (logChannel) {
          await logChannel.send(
            `Request to hide some CTFs has been fulfilled (requested by ${interaction.user.username})`
          );
        }
      }

      logger.info(`User ${interaction.user.tag} manually triggered auto-hide (${expiredCTFs.length} CTFs hidden)`);
    } catch (error) {
      logger.error('Error in admin-hide command:', error);
    }
  },
};

export default command;
