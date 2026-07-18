import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { Command } from '../../types';
import databaseService from '../../services/database.service';
import { errorEmbed, warningEmbed } from '../../utils/embed.builder';
import logger from '../../utils/logger';
import { requireAdmin } from '../../utils/role.guard';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('admin-delete')
    .setDescription('Xoá một giải CTF đã tạo trong server')
    .addStringOption((option) =>
      option
        .setName('search_id')
        .setDescription('Nhập CTFTime ID, hoặc Discord Category ID')
        .setRequired(true)
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      if (!(await requireAdmin(interaction))) return;

      if (!interaction.guild) {
        await interaction.reply({ embeds: [errorEmbed('This command must be used in a server')], ephemeral: true });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      const searchId = interaction.options.get('search_id')?.value as string;

      // Find CTF by CTFtime ID or Category ID
      let ctf = await databaseService.findByCTFTimeId(parseInt(searchId));

      if (!ctf) {
        ctf = await databaseService.findByCategoryId(searchId);
      }

      if (!ctf) {
        await interaction.editReply({ embeds: [errorEmbed('CTF not found')] });
        return;
      }

      // Show confirmation buttons
      const { DeleteConfirmButtons } = await import('../../components/buttons');
      const view = new DeleteConfirmButtons(ctf.key, interaction.user.id);

      await interaction.editReply({
        embeds: [
          warningEmbed(
            'Xác nhận xoá',
            `Bạn muốn xoá tất cả dữ liệu của <***${ctf.data.name}***> hay vẫn giữ lại các kênh thảo luận?`
          ),
        ],
        components: [view],
      });

      logger.info(`User ${interaction.user.tag} initiated delete for CTF: ${ctf.data.name}`);
    } catch (error) {
      logger.error('Error in admin-delete command:', error);

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds: [errorEmbed('An error occurred')] });
      }
    }
  },
};

export default command;
