import { SlashCommandBuilder, ChatInputCommandInteraction, TextChannel } from 'discord.js';
import { Command, CTFInfo } from '../../types';
import ctftimeService from '../../services/ctftime.service';
import databaseService from '../../services/database.service';
import discordService from '../../services/discord.service';
import { createEmbed, errorEmbed, successEmbed, warningEmbed } from '../../utils/embed.builder';
import logger from '../../utils/logger';
import { config } from '../../config/env';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('ct-reg')
    .setDescription('[CTFTime] Đăng kí giải CTF mới cho server')
    .addIntegerOption((option) =>
      option
        .setName('ctftime-id')
        .setDescription('ID giải CTF trên CTFtime')
        .setRequired(true)
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      if (!interaction.guild) {
        await interaction.reply({ embeds: [errorEmbed('This command must be used in a server')], ephemeral: true });
        return;
      }

      await interaction.deferReply();

      const ctftimeId = interaction.options.get('ctftime-id')?.value as number;

      // Check if CTF is already registered
      const existing = await databaseService.findByCTFTimeId(ctftimeId);

      if (existing) {
        await interaction.editReply({
          embeds: [warningEmbed('Oops...', 'CTF này đã được tạo.')],
        });
        return;
      }

      // Get CTF info from CTFtime
      const result = await ctftimeService.getCTF(ctftimeId, true);

      if (!result || !('title' in result)) {
        await interaction.editReply({ embeds: [errorEmbed('Failed to fetch CTF info')] });
        return;
      }

      const ctfInfo = result as CTFInfo;

      // Create category, role, and channels
      const created = await discordService.createCTFCategory(
        interaction.guild,
        ctfInfo.title
      );

      if (!created) {
        await interaction.editReply({ embeds: [errorEmbed('Failed to create CTF category')] });
        return;
      }

      const { category, role, infoChannel } = created;

      // Send info embed to info channel
      try {
        const embed = createEmbed(ctfInfo.embedData);
        const message = await infoChannel.send({ embeds: [embed] });
        await message.pin();

        // Add CTF to database
        await databaseService.addCTF({
          ctftimeid: ctftimeId,
          role: role.id,
          cate: category.id,
          name: ctfInfo.title,
          infom: message.id,
          channel: infoChannel.id,
          endtime: ctfInfo.endTime,
        });

        // Revert any CTFs whose time has run out
        await discordService.syncEndedCTFs(interaction.guild);

        await interaction.editReply({
          embeds: [successEmbed(`Đã tạo channel cho <***${ctfInfo.title}***>`)],
        });

        // Log to log channel
        if (config.LOG_CHANNELID) {
          const logChannel = interaction.guild.channels.cache.get(config.LOG_CHANNELID) as TextChannel;
          if (logChannel) {
            await logChannel.send(`${interaction.user.username} has created <***${ctfInfo.title}***>`);
          }
        }

        // Create Discord scheduled event
        try {
          const startTime = new Date(ctfInfo.startTime * 1000);
          const endTime = new Date((ctfInfo.endTime - 604800) * 1000); // Remove the 1 week buffer for event

          await discordService.createCTFEvent(
            interaction.guild,
            ctfInfo.title,
            startTime,
            endTime
          );

          if (config.LOG_CHANNELID) {
            const logChannel = interaction.guild.channels.cache.get(config.LOG_CHANNELID) as TextChannel;
            if (logChannel) {
              await logChannel.send(`Event '${ctfInfo.title}' created successfully!`);
            }
          }
        } catch (eventError) {
          logger.error('Error creating scheduled event:', eventError);
          if (config.LOG_CHANNELID) {
            const logChannel = interaction.guild.channels.cache.get(config.LOG_CHANNELID) as TextChannel;
            if (logChannel) {
              await logChannel.send(`Failed to create event for '${ctfInfo.title}'`);
            }
          }
        }

        // Auto-hide old CTFs
        await autoHideOldCTFs(interaction);

        logger.info(`User ${interaction.user.tag} registered CTF: ${ctfInfo.title} (ID: ${ctftimeId})`);
      } catch (error) {
        logger.error('Error during CTF registration:', error);
        await interaction.editReply({
          embeds: [errorEmbed('Error: Please make sure I have view permission.')],
        });
      }
    } catch (error) {
      logger.error('Error in ct-reg command:', error);

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds: [errorEmbed('An error occurred')] });
      }
    }
  },
};

/**
 * Auto-hide expired CTFs
 */
async function autoHideOldCTFs(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;

  const currentTime = Math.floor(Date.now() / 1000);
  const expiredCTFs = await databaseService.getExpiredCTFs(currentTime);

  if (expiredCTFs.length > 0) {
    for (const ctf of expiredCTFs) {
      await discordService.archiveCTFCategory(interaction.guild, ctf.data.cate, ctf.data.channel);
      await databaseService.updateCTF(ctf.key, { archived: true });
    }

    if (config.LOG_CHANNELID) {
      const logChannel = interaction.guild.channels.cache.get(config.LOG_CHANNELID) as TextChannel;
      if (logChannel) {
        await logChannel.send('`reg` - Auto hiding some CTFs');
      }
    }
  }
}

export default command;
