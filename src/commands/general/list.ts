import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { Command } from '../../types';
import ctftimeService from '../../services/ctftime.service';
import { createEmbed, errorEmbed } from '../../utils/embed.builder';
import logger from '../../utils/logger';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('c-list')
    .setDescription('List tất cả các giải CTF trong server')
    .addStringOption((option) =>
      option
        .setName('order')
        .setDescription('Thứ tự list')
        .addChoices({ name: 'Cũ nhất', value: 'Cũ nhất' }, { name: 'Mới nhất', value: 'Mới nhất' })
        .setRequired(false)
    )
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
      await interaction.deferReply();

      const order =
        (interaction.options.get('order')?.value as 'Mới nhất' | 'Cũ nhất') || 'Mới nhất';
      const page = (interaction.options.get('page')?.value as number) || 1;
      const step = (interaction.options.get('step')?.value as number) || 5;

      const result = await ctftimeService.getListCTF(order, page - 1, step);

      if (!result) {
        await interaction.editReply({
          embeds: [errorEmbed('No CTFs found or invalid parameters')],
        });
        return;
      }

      const embed = createEmbed(result.embed);

      // Import button view dynamically to avoid circular dependency
      const { ListPaginationButtons } = await import('../../components/buttons');
      const view = new ListPaginationButtons(order, page - 1, step, result.totalPages);

      await interaction.editReply({ embeds: [embed], components: [view] });

      logger.info(
        `User ${interaction.user.tag} viewed CTF list (order: ${order}, page ${page}, step ${step})`
      );
    } catch (error) {
      logger.error('Error in c-list command:', error);

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds: [errorEmbed('An error occurred')] });
      }
    }
  },
};

export default command;
