import { SlashCommandBuilder, ChatInputCommandInteraction, TextChannel, CategoryChannel } from 'discord.js';
import { Command } from '../../types';
import databaseService from '../../services/database.service';
import logger from '../../utils/logger';
import { config } from '../../config/env';
import { requireAdmin } from '../../utils/role.guard';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('admin-deny-role')
    .setDescription('Deny ViewChannel for DENY_CTF_ROLEID on all existing CTF categories'),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      if (!(await requireAdmin(interaction))) return;

      if (!interaction.guild) {
        await interaction.reply({ content: 'This command must be used in a server', ephemeral: true });
        return;
      }

      if (!config.DENY_CTF_ROLEID) {
        await interaction.reply({ content: 'DENY_CTF_ROLEID is not configured in environment variables', ephemeral: true });
        return;
      }

      await interaction.reply({ content: 'Applying deny permission to all CTF categories... Please wait', ephemeral: true });

      const allCTFs = await databaseService.getAllCTFs();

      if (allCTFs.length === 0) {
        await interaction.followUp({ content: 'No CTF categories found in database', ephemeral: true });
        return;
      }

      let successCount = 0;
      let skipCount = 0;
      let failCount = 0;

      for (const ctf of allCTFs) {
        const category = interaction.guild.channels.cache.get(ctf.data.cate) as CategoryChannel | undefined;

        if (!category) {
          logger.warn(`Category not found for CTF: ${ctf.data.name} (${ctf.data.cate})`);
          skipCount++;
          continue;
        }

        try {
          await category.permissionOverwrites.create(config.DENY_CTF_ROLEID!, {
            ViewChannel: false,
          });

          // Also apply to each child channel so existing channels are covered
          for (const [, channel] of category.children.cache) {
            await channel.permissionOverwrites.create(config.DENY_CTF_ROLEID!, {
              ViewChannel: false,
            });
          }

          logger.info(`Denied ViewChannel for role ${config.DENY_CTF_ROLEID} on category+channels: ${category.name}`);
          successCount++;
        } catch (err) {
          logger.error(`Failed to update permissions for category ${category.name}:`, err);
          failCount++;
        }
      }

      const summary = `Done. Updated: ${successCount}, Skipped (not found): ${skipCount}, Failed: ${failCount}`;

      await interaction.followUp({ content: summary, ephemeral: true });

      if (config.LOG_CHANNELID) {
        const logChannel = interaction.guild.channels.cache.get(config.LOG_CHANNELID) as TextChannel;
        if (logChannel) {
          await logChannel.send(
            `admin-deny-role applied by ${interaction.user.username}: ${summary} (role: ${config.DENY_CTF_ROLEID})`
          );
        }
      }

      logger.info(`admin-deny-role by ${interaction.user.tag}: ${summary}`);
    } catch (error) {
      logger.error('Error in admin-deny-role command:', error);
    }
  },
};

export default command;
