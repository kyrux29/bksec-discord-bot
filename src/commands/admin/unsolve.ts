import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types';
import { requireAdmin } from '../../utils/role.guard';
import databaseService from '../../services/database.service';
import challengeService from '../../services/challenge.service';
import { errorEmbed, successEmbed } from '../../utils/embed.builder';
import logger from '../../utils/logger';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('admin-unsolve')
    .setDescription('Hoàn tác solve của challenge hiện tại'),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      if (!(await requireAdmin(interaction))) return;
      if (!interaction.guild || !interaction.channel?.isThread()) {
        await interaction.reply({
          embeds: [errorEmbed('Hãy chạy trong challenge thread.')],
          ephemeral: true,
        });
        return;
      }

      const challenge = await databaseService.getChallengeByThread(interaction.channel.id);
      if (!challenge) {
        await interaction.reply({
          embeds: [errorEmbed('Challenge không tồn tại.')],
          ephemeral: true,
        });
        return;
      }
      if (challenge.status !== 'solved') {
        await interaction.reply({
          embeds: [errorEmbed('Challenge này chưa được đánh dấu solved.')],
          ephemeral: true,
        });
        return;
      }

      const ctf = await databaseService.findByKey(String(challenge.ctfId));
      if (!ctf) {
        await interaction.reply({
          embeds: [errorEmbed('CTF không tồn tại trong DB.')],
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply({ ephemeral: true });
      const updated = await databaseService.undoChallengeSolve(challenge.id);
      await interaction.channel.setArchived(false).catch(() => undefined);
      await interaction.channel.setLocked(false).catch(() => undefined);
      await challengeService.renameThread(interaction.guild, updated);
      await challengeService.refreshDashboard(interaction.guild, ctf.key, ctf.data);
      await interaction.editReply({
        embeds: [successEmbed(`Đã hoàn tác solve **${challenge.name}**.`)],
      });
    } catch (error) {
      logger.error('admin-unsolve failed:', error);
      const payload = { embeds: [errorEmbed('Không thể hoàn tác solve.')] };
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(payload).catch(() => undefined);
      } else {
        await interaction.reply({ ...payload, ephemeral: true }).catch(() => undefined);
      }
    }
  },
};

export default command;
