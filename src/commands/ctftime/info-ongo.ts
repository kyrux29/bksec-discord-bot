import { SlashCommandBuilder, CommandInteraction } from 'discord.js';
import { Command } from '../../types';
import ctftimeService, { CTFTimeAPIError } from '../../services/ctftime.service';
import { createEmbed, loadingEmbed, errorEmbed, warningEmbed } from '../../utils/embed.builder';
import logger from '../../utils/logger';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('ct-info_ongo')
    .setDescription('[CTFTime] Xem các CTF đang diễn ra'),

  async execute(interaction: CommandInteraction) {
    try {
      await interaction.deferReply();

      // Show loading badge while processing
      await interaction.editReply({ embeds: [loadingEmbed()] });

      const result = await ctftimeService.getOngoingCTF(true);

      if (!result) {
        await interaction.editReply({ embeds: [errorEmbed()] });
        return;
      }

      const embed = createEmbed(result.embed);

      // Import button view dynamically to avoid circular dependency
      const { ShowOngoButtons } = await import('../../components/buttons');
      const view = new ShowOngoButtons();

      await interaction.editReply({ embeds: [embed], components: [view] });

      logger.info(`User ${interaction.user.tag} viewed ongoing CTFs`);
    } catch (error) {
      logger.error('Error in ct-info_ongo command:', error);

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
