import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { Command } from '../../types';
import databaseService from '../../services/database.service';
import discordService from '../../services/discord.service';
import logger from '../../utils/logger';
import { config } from '../../config/env';
import { requireAdmin } from '../../utils/role.guard';
import { errorEmbed, successEmbed, warningEmbed } from '../../utils/embed.builder';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('admin-hide')
    .setDescription('Ẩn các CTF cũ ngay lập tức [autorun cùng /reg]'),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      if (!(await requireAdmin(interaction))) return;

      if (!interaction.guild) {
        await interaction.reply({
          content: 'This command must be used in a server',
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      const currentTime = Math.floor(Date.now() / 1000);
      const expiredCTFs = await databaseService.getExpiredCTFs(currentTime);

      if (expiredCTFs.length === 0) {
        if (config.LOG_CHANNELID) {
          const logChannel = interaction.guild.channels.cache.get(config.LOG_CHANNELID);
          if (logChannel?.isTextBased()) {
            await logChannel
              .send(
                `Request to hide some CTFs has NOT been fulfilled (reason: no CTF has reached endtime) (requested by ${interaction.user.username})`
              )
              .catch((error) => logger.warn('Could not write admin-hide audit log:', error));
          }
        }
        await interaction.editReply({
          embeds: [warningEmbed('Không có CTF cần archive', 'Chưa có giải nào đến hạn archive.')],
        });
        return;
      }

      // Hide expired CTFs
      let successCount = 0;
      let failedCount = 0;
      for (const ctf of expiredCTFs) {
        const archived = await discordService.archiveCTFRecord(
          interaction.guild,
          ctf.key,
          ctf.data
        );
        if (!archived) {
          failedCount++;
          logger.warn(`CTF archive failed; DB unchanged: ${ctf.data.name}`);
          continue;
        }

        successCount++;

        if (config.LOG_CHANNELID) {
          const logChannel = interaction.guild.channels.cache.get(config.LOG_CHANNELID);
          if (logChannel?.isTextBased()) {
            await logChannel
              .send(`${ctf.data.name} has been hidden`)
              .catch((error) => logger.warn('Could not write admin-hide item log:', error));
          }
        }

        logger.info(`CTF archived: ${ctf.data.name} (endtime: ${ctf.data.endtime})`);
      }

      if (config.LOG_CHANNELID) {
        const logChannel = interaction.guild.channels.cache.get(config.LOG_CHANNELID);
        if (logChannel?.isTextBased()) {
          await logChannel
            .send(
              `Request to hide some CTFs has been fulfilled (requested by ${interaction.user.username})`
            )
            .catch((error) => logger.warn('Could not write admin-hide summary log:', error));
        }
      }

      await interaction.editReply({
        embeds: [
          failedCount === 0
            ? successEmbed(`Đã archive ${successCount} CTF.`)
            : errorEmbed(
                `Archive thành công ${successCount}, thất bại ${failedCount}. DB của các mục lỗi không bị thay đổi.`
              ),
        ],
      });

      logger.info(
        `User ${interaction.user.tag} manually triggered auto-hide (${successCount} archived, ${failedCount} failed)`
      );
    } catch (error) {
      logger.error('Error in admin-hide command:', error);
      const payload = { embeds: [errorEmbed('Không thể archive các CTF cũ.')] };
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(payload).catch(() => undefined);
      } else {
        await interaction.reply({ ...payload, ephemeral: true }).catch(() => undefined);
      }
    }
  },
};

export default command;
