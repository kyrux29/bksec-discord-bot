import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types';
import databaseService from '../../services/database.service';
import discordService from '../../services/discord.service';
import { successEmbed, errorEmbed } from '../../utils/embed.builder';
import logger from '../../utils/logger';
import { config } from '../../config/env';
import { requireAdmin } from '../../utils/role.guard';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('admin-fix')
    .setDescription('Đồng bộ lại quyền category/channel của toàn bộ CTF'),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      if (!(await requireAdmin(interaction))) return;
      if (!interaction.guild) return;

      await interaction.deferReply({ ephemeral: true });
      const allCTFs = await databaseService.getAllCTFs();
      const now = Math.floor(Date.now() / 1000);
      let fixedCount = 0;
      const errors: string[] = [];

      for (const ctf of allCTFs) {
        if (!ctf.data.cate || ctf.data.cate === '0' || ctf.data.channelsPurged) continue;

        try {
          if (ctf.data.archived) {
            if (!(await discordService.archiveRegisteredCTF(interaction.guild, ctf.data))) {
              throw new Error('archive permission repair failed');
            }
          } else {
            const competitionEnd = ctf.data.competitionEndtime || ctf.data.endtime;
            if (competitionEnd > 0 && now >= competitionEnd) {
              const redacted = await discordService.redactCTFCredentials(
                interaction.guild,
                ctf.data.channel,
                ctf.data.infom
              );
              if (!redacted) throw new Error('credential redaction failed');
              await discordService.applyEndedPermissions(
                interaction.guild,
                ctf.data.cate,
                ctf.data.role
              );
              await databaseService.updateCTF(ctf.key, { postEndOpened: true });
            } else {
              await discordService.applyLivePermissions(
                interaction.guild,
                ctf.data.cate,
                ctf.data.role
              );
              if (ctf.data.postEndOpened) {
                await databaseService.updateCTF(ctf.key, { postEndOpened: false });
              }
            }
          }

          fixedCount++;
        } catch (error) {
          errors.push(ctf.data.name);
          logger.error(`Failed to repair permissions for ${ctf.data.name}:`, error);
        }
      }

      const message =
        `Đã đồng bộ ${fixedCount} CTF.` +
        (errors.length ? ` Không thể sửa: ${errors.join(', ')}.` : '');
      await interaction.editReply({ embeds: [successEmbed(message)] });

      if (config.LOG_CHANNELID) {
        const logChannel = interaction.guild.channels.cache.get(config.LOG_CHANNELID);
        if (logChannel?.isTextBased()) {
          await logChannel
            .send(`admin-fix by ${interaction.user.username}: ${message}`)
            .catch((error) => logger.warn('Could not write admin-fix audit log:', error));
        }
      }
    } catch (error) {
      logger.error('Error in admin-fix command:', error);
      const payload = { embeds: [errorEmbed('Không thể đồng bộ quyền CTF.')] };
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(payload).catch(() => undefined);
      } else {
        await interaction.reply({ ...payload, ephemeral: true }).catch(() => undefined);
      }
    }
  },
};

export default command;
