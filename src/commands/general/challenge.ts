import {
  ChannelType,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  TextChannel,
} from 'discord.js';
import {
  CHALLENGE_CATEGORIES,
  CTFChallenge,
  ChallengeCategory,
  ChallengeStatus,
  Command,
} from '../../types';
import databaseService from '../../services/database.service';
import challengeService from '../../services/challenge.service';
import { config } from '../../config/env';
import { requireRole } from '../../utils/role.guard';
import { errorEmbed, successEmbed, warningEmbed } from '../../utils/embed.builder';
import logger from '../../utils/logger';

function isChallengeCategory(value: string): value is ChallengeCategory {
  return CHALLENGE_CATEGORIES.includes(value as ChallengeCategory);
}

async function threadChallenge(interaction: ChatInputCommandInteraction) {
  return interaction.channel?.isThread()
    ? databaseService.getChallengeByThread(interaction.channel.id)
    : null;
}

async function interactionCategoryId(
  interaction: ChatInputCommandInteraction
): Promise<string | null> {
  const channel = interaction.channel;
  if (!channel || !interaction.guild) return null;

  if (channel.isThread()) {
    if (!channel.parentId) return null;
    const parent = await interaction.guild.channels.fetch(channel.parentId).catch(() => null);
    return parent && 'parentId' in parent ? parent.parentId : null;
  }

  return 'parentId' in channel ? channel.parentId : null;
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('challenge')
    .setDescription('Quản lý challenge CTF')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('create')
        .setDescription('Tạo challenge thread')
        .addStringOption((option) =>
          option.setName('name').setDescription('Tên challenge').setRequired(true).setMaxLength(80)
        )
        .addStringOption((option) =>
          option
            .setName('category')
            .setDescription('Category')
            .setRequired(true)
            .addChoices(
              ...CHALLENGE_CATEGORIES.map((category) => ({
                name: category.toUpperCase(),
                value: category,
              }))
            )
        )
        .addIntegerOption((option) =>
          option.setName('points').setDescription('Điểm').setMinValue(0)
        )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('claim').setDescription('Nhận làm challenge hiện tại')
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('release').setDescription('Bỏ nhận challenge hiện tại')
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName('status')
        .setDescription('Cập nhật trạng thái')
        .addStringOption((option) =>
          option
            .setName('value')
            .setDescription('Trạng thái')
            .setRequired(true)
            .addChoices(
              { name: 'Đang làm', value: 'working' },
              { name: 'Có hướng', value: 'idea' },
              { name: 'Chưa nhận', value: 'unclaimed' }
            )
        )
    )
    .addSubcommand((subcommand) =>
      subcommand.setName('dashboard').setDescription('Tạo/cập nhật dashboard của giải')
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      if (!interaction.guild || !(await requireRole(interaction, config.ACTIVE_CTF_ROLEID))) {
        return;
      }

      const subcommand = interaction.options.getSubcommand();
      if (subcommand === 'create') {
        const channel = interaction.channel;
        if (
          !channel ||
          channel.type !== ChannelType.GuildText ||
          !channel.parentId ||
          !isChallengeCategory(channel.name.toLowerCase())
        ) {
          await interaction.reply({
            embeds: [
              errorEmbed(
                `Hãy chạy trong channel ${CHALLENGE_CATEGORIES.join(', ')} của CTF đã đăng ký.`
              ),
            ],
            ephemeral: true,
          });
          return;
        }

        const ctf = await databaseService.findByCategoryId(channel.parentId);
        if (!ctf) {
          await interaction.reply({
            embeds: [errorEmbed('Category chưa được đăng ký là CTF.')],
            ephemeral: true,
          });
          return;
        }

        const category = interaction.options.getString('category', true) as ChallengeCategory;
        const channelCategory = channel.name.toLowerCase() as ChallengeCategory;
        if (category !== channelCategory) {
          await interaction.reply({
            embeds: [
              errorEmbed(
                `Category đã chọn là ${category.toUpperCase()}, nhưng channel hiện tại là ${channelCategory.toUpperCase()}.`
              ),
            ],
            ephemeral: true,
          });
          return;
        }

        await interaction.deferReply({ ephemeral: true });
        const name = interaction.options.getString('name', true).trim();
        if (!name) {
          await interaction.editReply({
            embeds: [errorEmbed('Tên challenge không được để trống.')],
          });
          return;
        }
        const thread = await (channel as TextChannel).threads.create({
          name: `[OPEN] ${name}`.slice(0, 100),
          autoArchiveDuration: 10080,
          reason: `Challenge created by ${interaction.user.tag}`,
        });

        let challenge: CTFChallenge;
        try {
          challenge = await databaseService.createChallenge({
            ctfId: Number(ctf.key),
            threadId: thread.id,
            channelId: channel.id,
            name,
            category,
            points: interaction.options.getInteger('points') ?? 0,
          });
        } catch (error) {
          await thread.delete('Rolling back failed challenge registration').catch(() => undefined);
          throw error;
        }

        const introSent = await thread
          .send({
            content:
              `Challenge **${challenge.name}** · ${category.toUpperCase()}` +
              `${challenge.points ? ` · ${challenge.points} points` : ''}\n` +
              'Gửi tin nhắn đầu tiên hoặc dùng `/challenge claim` để tham gia.',
            allowedMentions: { parse: [] },
          })
          .then(() => true)
          .catch((error) => {
            logger.warn(`Could not send challenge intro for ${name}:`, error);
            return false;
          });

        const dashboardUpdated = await challengeService
          .refreshDashboard(interaction.guild, ctf.key, ctf.data)
          .then(() => true)
          .catch((error) => {
            logger.warn(`Dashboard refresh failed after creating ${name}:`, error);
            return false;
          });

        await interaction.editReply({
          embeds: [
            dashboardUpdated && introSent
              ? successEmbed(`Đã tạo <#${thread.id}>.`)
              : warningEmbed(
                  'Challenge đã được tạo',
                  `<#${thread.id}> đã tồn tại nhưng chưa hoàn tất: ${[
                    !introSent ? 'tin nhắn mở đầu' : null,
                    !dashboardUpdated ? 'dashboard' : null,
                  ]
                    .filter(Boolean)
                    .join(', ')}.`
                ),
          ],
        });
        return;
      }

      if (subcommand === 'dashboard') {
        const categoryId = await interactionCategoryId(interaction);
        const ctf = categoryId ? await databaseService.findByCategoryId(categoryId) : null;
        if (!ctf) {
          await interaction.reply({
            embeds: [errorEmbed('Hãy chạy trong channel/thread của CTF đã đăng ký.')],
            ephemeral: true,
          });
          return;
        }

        await interaction.deferReply({ ephemeral: true });
        await challengeService.refreshDashboard(interaction.guild, ctf.key, ctf.data);
        await interaction.editReply({ embeds: [successEmbed('Dashboard đã được cập nhật.')] });
        return;
      }

      const challenge = await threadChallenge(interaction);
      if (!challenge) {
        await interaction.reply({
          embeds: [errorEmbed('Lệnh này phải chạy trong challenge thread đã đăng ký.')],
          ephemeral: true,
        });
        return;
      }
      if (challenge.status === 'solved') {
        await interaction.reply({
          embeds: [errorEmbed('Challenge đã solved. Chỉ admin có thể dùng `/admin-unsolve`.')],
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

      let updated;
      if (subcommand === 'claim') {
        const result = await databaseService.addChallengeClaimant(
          challenge.id,
          interaction.user.id
        );
        updated = result.challenge;
        if (!result.added) {
          await interaction.reply({
            embeds: [successEmbed('Bạn đã có trong danh sách claim.')],
            ephemeral: true,
          });
          return;
        }
      } else if (subcommand === 'release') {
        const result = await databaseService.removeChallengeClaimant(
          challenge.id,
          interaction.user.id
        );
        updated = result.challenge;
        if (!result.removed) {
          await interaction.reply({
            embeds: [errorEmbed('Bạn chưa claim challenge này.')],
            ephemeral: true,
          });
          return;
        }
      } else {
        const status = interaction.options.getString('value', true) as ChallengeStatus;
        if (status !== 'unclaimed' && challenge.claimantIds.length === 0) {
          await databaseService.addChallengeClaimant(challenge.id, interaction.user.id);
        }
        updated = await databaseService.updateChallenge(
          challenge.id,
          status === 'unclaimed'
            ? { status, claimantIds: [], claimedBy: undefined, claimedAt: undefined }
            : { status }
        );
      }

      const followUpFailures: string[] = [];
      await challengeService.renameThread(interaction.guild, updated).catch((error) => {
        followUpFailures.push('đổi tên thread');
        logger.warn(`Could not rename challenge ${updated.id}:`, error);
      });
      await challengeService
        .refreshDashboard(interaction.guild, ctf.key, ctf.data)
        .catch((error) => {
          followUpFailures.push('cập nhật dashboard');
          logger.warn(`Could not refresh dashboard for challenge ${updated.id}:`, error);
        });
      await interaction.reply({
        embeds: [
          followUpFailures.length === 0
            ? successEmbed(`Đã cập nhật **${updated.name}**: ${updated.status}.`)
            : warningEmbed(
                'Trạng thái đã được lưu',
                `Không hoàn tất được: ${followUpFailures.join(', ')}.`
              ),
        ],
        ephemeral: true,
      });
    } catch (error) {
      logger.error('Challenge command failed:', error);
      const payload = { embeds: [errorEmbed('Không thể cập nhật challenge.')] };
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(payload).catch(() => undefined);
      } else {
        await interaction.reply({ ...payload, ephemeral: true }).catch(() => undefined);
      }
    }
  },
};

export default command;
