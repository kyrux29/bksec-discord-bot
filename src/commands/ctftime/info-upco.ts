import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { Command } from '../../types';
import ctftimeService, { CTFTimeAPIError } from '../../services/ctftime.service';
import { createEmbed, loadingEmbed, errorEmbed, warningEmbed } from '../../utils/embed.builder';
import logger from '../../utils/logger';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('ct-info_upco')
    .setDescription('[CTFTime] Xem các CTF sắp diễn ra')
    .addIntegerOption((option) =>
      option.setName('page').setDescription('Số trang').setMinValue(1).setRequired(false)
    )
    .addIntegerOption((option) =>
      option
        .setName('step')
        .setDescription('Chỉnh số kết quả hiện trên 1 trang')
        .setMinValue(1)
        .setRequired(false)
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      // Defer the reply first to give us more time (15 minutes instead of 3 seconds)
      await interaction.deferReply();

      // Show loading badge while processing
      await interaction.editReply({ embeds: [loadingEmbed()] });

      const page = (interaction.options.get('page')?.value as number) || 1;
      const step = (interaction.options.get('step')?.value as number) || 3;

      const result = await ctftimeService.getUpcomingCTF(page - 1, step);

      if (!result) {
        await interaction.editReply({ embeds: [errorEmbed()] });
        return;
      }

      const embed = createEmbed(result.embed);

      // Import button view dynamically to avoid circular dependency
      const { UpcomingPaginationButtons } = await import('../../components/buttons');
      const view = new UpcomingPaginationButtons(page - 1, step, result.totalPages);

      await interaction.editReply({ embeds: [embed], components: [view] });

      logger.info(`User ${interaction.user.tag} viewed upcoming CTFs (page ${page}, step ${step})`);
    } catch (error) {
      logger.error('Error in ct-info_upco command:', error);

      if (interaction.deferred || interaction.replied) {
        const embed =
          error instanceof CTFTimeAPIError
            ? warningEmbed(
                'CTFtime is unreachable',
                `The bot is fine — CTFtime.org appears to be down.\n\`${error.message}\`\nPlease try again later.`
              )
            : errorEmbed('An error occurred');
        await interaction.editReply({ embeds: [embed] });
      }
    }
  },
};

export default command;
