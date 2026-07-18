import { ChatInputCommandInteraction, SlashCommandBuilder, TextChannel } from 'discord.js';
import { Command } from '../../types';
import ctftimeService from '../../services/ctftime.service';
import databaseService from '../../services/database.service';
import discordService from '../../services/discord.service';
import { createEmbed, errorEmbed, successEmbed, warningEmbed } from '../../utils/embed.builder';
import logger from '../../utils/logger';
import { config } from '../../config/env';
import challengeService from '../../services/challenge.service';
import { requireAdmin } from '../../utils/role.guard';

interface ArchiveSummary {
  archived: number;
  failed: number;
}

async function archiveExpiredCTFs(
  interaction: ChatInputCommandInteraction
): Promise<ArchiveSummary> {
  if (!interaction.guild) return { archived: 0, failed: 0 };

  const expiredCTFs = await databaseService.getExpiredCTFs(Math.floor(Date.now() / 1000));
  let archived = 0;
  let failed = 0;

  for (const ctf of expiredCTFs) {
    const discordArchived = await discordService.archiveCTFRecord(
      interaction.guild,
      ctf.key,
      ctf.data
    );
    if (!discordArchived) {
      failed++;
      continue;
    }

    archived++;
  }

  if ((archived > 0 || failed > 0) && config.LOG_CHANNELID) {
    const logChannel = interaction.guild.channels.cache.get(config.LOG_CHANNELID);
    if (logChannel?.isTextBased()) {
      await logChannel
        .send(`ct-reg auto-archive: archived=${archived}, failed=${failed}`)
        .catch((error) => logger.warn('Could not write ct-reg archive log:', error));
    }
  }

  return { archived, failed };
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('ct-reg')
    .setDescription('[CTFTime] Đăng kí giải CTF mới cho server')
    .addIntegerOption((option) =>
      option
        .setName('ctftime-id')
        .setDescription('ID giải CTF trên CTFtime')
        .setMinValue(1)
        .setRequired(true)
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    let createdCategoryId: string | undefined;
    let createdRoleId: string | undefined;
    let databaseId: number | undefined;

    try {
      if (!(await requireAdmin(interaction))) return;
      if (!interaction.guild) return;

      await interaction.deferReply();
      const ctftimeId = interaction.options.getInteger('ctftime-id', true);

      const existing = await databaseService.findByCTFTimeId(ctftimeId);
      if (existing) {
        await interaction.editReply({
          embeds: [warningEmbed('Oops...', 'CTF này đã được tạo.')],
        });
        return;
      }

      const result = await ctftimeService.getCTF(ctftimeId, true);
      if (!result || !('archiveAt' in result)) {
        await interaction.editReply({ embeds: [errorEmbed('Failed to fetch CTF info')] });
        return;
      }
      const ctfInfo = result;

      const created = await discordService.createCTFCategory(interaction.guild, ctfInfo.title);
      if (!created) {
        await interaction.editReply({ embeds: [errorEmbed('Failed to create CTF category')] });
        return;
      }

      const { category, role, infoChannel } = created;
      createdCategoryId = category.id;
      createdRoleId = role.id;

      try {
        const infoMessage = await infoChannel.send({
          embeds: [createEmbed(ctfInfo.embedData)],
        });
        await infoMessage.pin().catch((error) => {
          logger.warn(`Could not pin info message for ${ctfInfo.title}:`, error);
        });

        databaseId = await databaseService.addCTF({
          ctftimeid: ctftimeId,
          role: role.id,
          cate: category.id,
          name: ctfInfo.title,
          infom: infoMessage.id,
          channel: infoChannel.id,
          endtime: ctfInfo.archiveAt,
          starttime: ctfInfo.startTime,
          competitionEndtime: ctfInfo.endTime,
        });
      } catch (error) {
        logger.error(`Core registration failed for ${ctfInfo.title}:`, error);
        await discordService.rollbackCTFCreation(
          interaction.guild,
          createdCategoryId,
          createdRoleId
        );
        await interaction.editReply({
          embeds: [
            errorEmbed('Registration failed and partial Discord resources were rolled back.'),
          ],
        });
        return;
      }

      const registeredCTF = await databaseService.findByKey(String(databaseId));
      if (registeredCTF) {
        await challengeService
          .refreshDashboard(interaction.guild, registeredCTF.key, registeredCTF.data)
          .catch((error) => logger.warn(`Initial dashboard failed for ${ctfInfo.title}:`, error));
      }

      await discordService
        .syncEndedCTFs(interaction.guild)
        .catch((error) => logger.warn('Could not synchronize ended CTF permissions:', error));

      const eventCreated = await discordService.createCTFEvent(
        interaction.guild,
        ctfInfo.title,
        new Date(ctfInfo.startTime * 1000),
        new Date(ctfInfo.endTime * 1000)
      );
      if (!eventCreated) logger.warn(`Scheduled event creation failed for ${ctfInfo.title}`);

      const archiveSummary = await archiveExpiredCTFs(interaction);
      await interaction.editReply({
        embeds: [
          successEmbed(
            `Đã tạo channel cho <***${ctfInfo.title}***>` +
              (archiveSummary.failed ? `\nAuto-archive failed: ${archiveSummary.failed}` : '')
          ),
        ],
      });

      if (config.LOG_CHANNELID) {
        const logChannel = interaction.guild.channels.cache.get(config.LOG_CHANNELID) as
          TextChannel | undefined;
        if (logChannel?.isTextBased()) {
          await logChannel
            .send(
              `${interaction.user.username} created <***${ctfInfo.title}***> (CTFtime ${ctftimeId})`
            )
            .catch((error) => logger.warn('Could not write ct-reg audit log:', error));
        }
      }

      logger.info(
        `User ${interaction.user.tag} registered CTF: ${ctfInfo.title} (ID: ${ctftimeId})`
      );
    } catch (error) {
      logger.error('Error in ct-reg command:', error);

      if (databaseId === undefined && interaction.guild && (createdCategoryId || createdRoleId)) {
        await discordService.rollbackCTFCreation(
          interaction.guild,
          createdCategoryId,
          createdRoleId
        );
      }

      const payload = { embeds: [errorEmbed('An error occurred while registering the CTF')] };
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(payload).catch(() => undefined);
      } else {
        await interaction.reply({ ...payload, ephemeral: true }).catch(() => undefined);
      }
    }
  },
};

export default command;
