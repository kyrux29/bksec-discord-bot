import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types';
import databaseService from '../../services/database.service';
import discordService from '../../services/discord.service';
import logger from '../../utils/logger';
import { config } from '../../config/env';
import { requireAdmin } from '../../utils/role.guard';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('admin-deny-role')
    .setDescription('Áp dụng DENY_CTF_ROLEID cho toàn bộ CTF category'),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      if (!(await requireAdmin(interaction))) return;
      if (!interaction.guild) return;
      if (!config.DENY_CTF_ROLEID) {
        await interaction.reply({
          content: 'DENY_CTF_ROLEID chưa được cấu hình hoặc đang xung đột với role xem CTF.',
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply({ ephemeral: true });
      const allCTFs = await databaseService.getAllCTFs();
      const now = Math.floor(Date.now() / 1000);
      let successCount = 0;
      let skippedCount = 0;
      let failedCount = 0;

      for (const ctf of allCTFs) {
        if (!ctf.data.cate || ctf.data.cate === '0' || ctf.data.channelsPurged) {
          skippedCount++;
          continue;
        }

        try {
          if (ctf.data.archived) {
            if (!(await discordService.archiveRegisteredCTF(interaction.guild, ctf.data))) {
              throw new Error('archive permission update failed');
            }
          } else {
            const competitionEnd = ctf.data.competitionEndtime || ctf.data.endtime;
            if (competitionEnd === 0 || now >= competitionEnd) {
              await discordService.applyEndedPermissions(
                interaction.guild,
                ctf.data.cate,
                ctf.data.role
              );
            } else {
              await discordService.applyLivePermissions(
                interaction.guild,
                ctf.data.cate,
                ctf.data.role
              );
            }
          }
          successCount++;
        } catch (error) {
          failedCount++;
          logger.error(`Failed to apply deny role to ${ctf.data.name}:`, error);
        }
      }

      const summary = `Updated: ${successCount}, skipped: ${skippedCount}, failed: ${failedCount}`;
      await interaction.editReply({ content: summary });

      if (config.LOG_CHANNELID) {
        const logChannel = interaction.guild.channels.cache.get(config.LOG_CHANNELID);
        if (logChannel?.isTextBased()) {
          await logChannel
            .send(`admin-deny-role by ${interaction.user.username}: ${summary}`)
            .catch((error) => logger.warn('Could not write deny-role audit log:', error));
        }
      }
    } catch (error) {
      logger.error('Error in admin-deny-role command:', error);
      const payload = { content: 'Không thể cập nhật deny role.' };
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(payload).catch(() => undefined);
      } else {
        await interaction.reply({ ...payload, ephemeral: true }).catch(() => undefined);
      }
    }
  },
};

export default command;
