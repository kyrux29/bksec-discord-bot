import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types';
import databaseService from '../../services/database.service';
import { errorEmbed, successEmbed, warningEmbed } from '../../utils/embed.builder';
import challengeService from '../../services/challenge.service';
import logger from '../../utils/logger';

function validWriteupUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('writeup')
    .setDescription('Quản lý writeup challenge')
    .addSubcommand((subcommand) => subcommand.setName('claim').setDescription('Nhận viết writeup'))
    .addSubcommand((subcommand) =>
      subcommand
        .setName('submit')
        .setDescription('Nộp writeup')
        .addStringOption((option) =>
          option
            .setName('url')
            .setDescription('Link writeup/PR')
            .setMaxLength(2000)
            .setRequired(true)
        )
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      if (!interaction.guild || !interaction.channel?.isThread()) {
        await interaction.reply({
          embeds: [errorEmbed('Hãy chạy lệnh trong challenge thread.')],
          ephemeral: true,
        });
        return;
      }

      const challenge = await databaseService.getChallengeByThread(interaction.channel.id);
      if (!challenge || challenge.status !== 'solved') {
        await interaction.reply({
          embeds: [errorEmbed('Challenge chưa solved hoặc chưa được đăng ký.')],
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

      const subcommand = interaction.options.getSubcommand();
      if (subcommand === 'claim') {
        if (challenge.writeupUrl) {
          await interaction.reply({
            embeds: [errorEmbed('Writeup này đã được hoàn thành.')],
            ephemeral: true,
          });
          return;
        }
        if (challenge.writeupOwner && challenge.writeupOwner !== interaction.user.id) {
          await interaction.reply({
            embeds: [errorEmbed(`Writeup đã được <@${challenge.writeupOwner}> nhận.`)],
            ephemeral: true,
          });
          return;
        }

        await databaseService.updateChallenge(challenge.id, {
          writeupOwner: interaction.user.id,
        });
        await interaction.reply({
          embeds: [successEmbed('Bạn đã nhận viết writeup.')],
          ephemeral: true,
        });
        return;
      }

      if (challenge.writeupOwner !== interaction.user.id) {
        await interaction.reply({
          embeds: [errorEmbed('Bạn phải claim writeup trước khi submit.')],
          ephemeral: true,
        });
        return;
      }

      const url = interaction.options.getString('url', true).trim();
      if (!validWriteupUrl(url)) {
        await interaction.reply({ embeds: [errorEmbed('URL không hợp lệ.')], ephemeral: true });
        return;
      }

      await interaction.deferReply({ ephemeral: true });
      await databaseService.updateChallenge(challenge.id, { writeupUrl: url });

      try {
        await challengeService.announce(
          interaction.guild,
          ctf.data,
          `[WRITEUP COMPLETED] **${challenge.name}**\n` +
            `Challenge solved by: ${
              challenge.solverIds.map((id) => `<@${id}>`).join(', ') || 'Not recorded'
            }\n` +
            `Written by: <@${interaction.user.id}>\n` +
            `Document: ${url}\n` +
            `Thread: <#${challenge.threadId}>`
        );
      } catch (error) {
        logger.warn(`Writeup saved but announcement failed for ${challenge.name}:`, error);
        await interaction.editReply({
          embeds: [
            warningEmbed(
              'Writeup đã được lưu',
              'Không gửi được thông báo. Thread được giữ mở để bạn có thể thử submit lại.'
            ),
          ],
        });
        return;
      }

      await interaction.editReply({ embeds: [successEmbed('Đã ghi nhận writeup.')] });
      await interaction.channel
        .setLocked(true, 'Writeup submitted')
        .catch((error) => logger.warn(`Could not lock ${challenge.threadId}:`, error));
      await interaction.channel
        .setArchived(true, 'Writeup submitted')
        .catch((error) => logger.warn(`Could not archive ${challenge.threadId}:`, error));
    } catch (error) {
      logger.error('Writeup command failed:', error);
      const payload = { embeds: [errorEmbed('Không thể cập nhật writeup.')] };
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(payload).catch(() => undefined);
      } else {
        await interaction.reply({ ...payload, ephemeral: true }).catch(() => undefined);
      }
    }
  },
};

export default command;
