import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { Command } from '../../types';
import ctftimeService, { CTFTimeAPIError } from '../../services/ctftime.service';
import { createEmbed, errorEmbed, warningEmbed } from '../../utils/embed.builder';
import logger from '../../utils/logger';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('ct-info_find')
    .setDescription('[CTFTime] Tìm thông tin giải CTF')
    .addStringOption((option) =>
      option
        .setName('search-key')
        .setDescription('Nhập CTFtime ID / hoặc string tên CTF (chưa diễn ra) cần tìm kiếm')
        .setRequired(true)
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      await interaction.deferReply();

      const searchKey = interaction.options.get('search-key')?.value as string;

      // Determine if search key is numeric (CTFtime ID) or text (CTF name)
      let ctftimeId: number;

      if (/^\d+$/.test(searchKey)) {
        ctftimeId = parseInt(searchKey);
      } else {
        ctftimeId = await ctftimeService.findCTF(searchKey);
      }

      if (ctftimeId === 0) {
        await interaction.editReply({ embeds: [errorEmbed('CTF not found')] });
        return;
      }

      // Get CTF info
      const result = await ctftimeService.getCTF(ctftimeId);

      if (!result || typeof result !== 'object' || !('title' in result)) {
        await interaction.editReply({ embeds: [errorEmbed()] });
        return;
      }

      const embed = createEmbed(result);
      await interaction.editReply({ embeds: [embed] });

      logger.info(
        `User ${interaction.user.tag} searched for CTF: ${searchKey} (ID: ${ctftimeId})`
      );
    } catch (error) {
      logger.error('Error in ct-info_find command:', error);

      if (interaction.deferred || interaction.replied) {
        const embed = error instanceof CTFTimeAPIError
          ? warningEmbed('CTFtime is unreachable', `The bot is fine — CTFtime.org appears to be down.\n\`${error.message}\`\nPlease try again later.`)
          : errorEmbed('An error occurred');
        await interaction.editReply({ embeds: [embed] });
      }
    }
  },
};

export default command;
