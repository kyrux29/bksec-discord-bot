import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types';
import { config } from '../../config/env';
import databaseService from '../../services/database.service';
import challengeService from '../../services/challenge.service';
import { errorEmbed, successEmbed, warningEmbed } from '../../utils/embed.builder';
import { requireRole } from '../../utils/role.guard';
import logger from '../../utils/logger';

function memberIds(value: string): string[] {
  return [...new Set(value.match(/\d{17,20}/g) ?? [])];
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('solve')
    .setDescription('Đánh dấu challenge hiện tại là solved')
    .addStringOption((option) =>
      option
        .setName('members')
        .setDescription('Danh sách mention hoặc Discord ID người solve')
        .setMaxLength(1000)
        .setRequired(true)
    )
    .addIntegerOption((option) =>
      option.setName('points').setDescription('Điểm thực nhận').setMinValue(0)
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      if (!interaction.guild || !interaction.channel?.isThread()) {
        await interaction.reply({
          embeds: [errorEmbed('Hãy chạy `/solve` trong challenge thread.')],
          ephemeral: true,
        });
        return;
      }
      if (!(await requireRole(interaction, config.ACTIVE_CTF_ROLEID))) return;

      const challenge = await databaseService.getChallengeByThread(interaction.channel.id);
      if (!challenge) {
        await interaction.reply({
          embeds: [errorEmbed('Thread này chưa được đăng ký là challenge.')],
          ephemeral: true,
        });
        return;
      }
      if (challenge.status === 'solved') {
        await interaction.reply({
          embeds: [errorEmbed('Challenge này đã được đánh dấu solved.')],
          ephemeral: true,
        });
        return;
      }

      const solverIds = memberIds(interaction.options.getString('members', true));
      if (solverIds.length === 0) {
        await interaction.reply({
          embeds: [errorEmbed('Hãy mention hoặc nhập ID của ít nhất một thành viên.')],
          ephemeral: true,
        });
        return;
      }

      const members = await Promise.all(
        solverIds.map((id) => interaction.guild?.members.fetch(id).catch(() => null))
      );
      const missingIndex = members.findIndex((member) => member === null);
      if (missingIndex >= 0) {
        await interaction.reply({
          embeds: [errorEmbed(`Không tìm thấy member ${solverIds[missingIndex]}.`)],
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply({ ephemeral: true });
      const ctf = await databaseService.findByKey(String(challenge.ctfId));
      if (!ctf) throw new Error('CTF not found');

      const existingChallenges = await databaseService.getChallengesByCTF(challenge.ctfId);
      const firstBlood = !existingChallenges.some(
        (candidate) => candidate.status === 'solved' && candidate.category === challenge.category
      );
      const solveTime = Math.floor(Date.now() / 1000);
      const elapsed = challenge.claimedAt ? Math.max(0, solveTime - challenge.claimedAt) : null;
      const points = interaction.options.getInteger('points') ?? challenge.points;

      const updated = await databaseService.solveChallenge({
        challengeId: challenge.id,
        solverIds,
        recordedBy: interaction.user.id,
        solvedAt: solveTime,
        points,
      });

      const followUpFailures: string[] = [];
      await challengeService.renameThread(interaction.guild, updated).catch((error) => {
        followUpFailures.push('đổi tên thread');
        logger.warn(`Could not rename solved thread ${challenge.threadId}:`, error);
      });

      await challengeService
        .announce(
          interaction.guild,
          ctf.data,
          `[CHALLENGE SOLVED] **${challenge.name}**\n` +
            `Category: **${challenge.category.toUpperCase()}**` +
            `${updated.points ? `\nPoints: **${updated.points}**` : ''}\n` +
            `Solved by: ${solverIds.map((id) => `<@${id}>`).join(', ')}\n` +
            `Recorded by: <@${interaction.user.id}>` +
            `${firstBlood ? '\nRecognition: **Category First Blood**' : ''}` +
            `${
              elapsed !== null
                ? `\nElapsed time: **${Math.floor(elapsed / 3600)}h ${Math.floor(
                    (elapsed % 3600) / 60
                  )}m**`
                : ''
            }\nThread: <#${challenge.threadId}>`
        )
        .catch((error) => {
          followUpFailures.push('gửi thông báo');
          logger.warn(`Could not announce solve for ${challenge.name}:`, error);
        });

      await challengeService
        .refreshDashboard(interaction.guild, ctf.key, ctf.data)
        .catch((error) => {
          followUpFailures.push('cập nhật dashboard');
          logger.warn(`Could not refresh dashboard after solving ${challenge.name}:`, error);
        });

      await interaction.channel
        .send({
          content:
            '[WRITEUP TASK] Chưa có người nhận. Dùng `/writeup claim`, sau đó `/writeup submit` khi hoàn thành.',
          allowedMentions: { parse: [] },
        })
        .catch((error) => {
          followUpFailures.push('tạo task writeup');
          logger.warn(`Could not create writeup prompt for ${challenge.name}:`, error);
        });

      await interaction.editReply({
        embeds: [
          followUpFailures.length === 0
            ? successEmbed(`Đã solve **${challenge.name}**${firstBlood ? ' — First blood!' : ''}`)
            : warningEmbed(
                'Solve đã được lưu',
                `Không hoàn tất được: ${followUpFailures.join(', ')}.`
              ),
        ],
      });
    } catch (error) {
      logger.error('Solve failed:', error);
      const payload = { embeds: [errorEmbed('Không thể cập nhật solve.')] };
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(payload).catch(() => undefined);
      } else {
        await interaction.reply({ ...payload, ephemeral: true }).catch(() => undefined);
      }
    }
  },
};

export default command;
