import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { Command } from '../../types';
import databaseService from '../../services/database.service';
import logger from '../../utils/logger';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('whoami')
    .setDescription('Display bot information and statistics'),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      // Get database statistics
      const stats = await databaseService.getStats();

      // Get bot uptime
      const uptime = process.uptime();
      const days = Math.floor(uptime / 86400);
      const hours = Math.floor((uptime % 86400) / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      const seconds = Math.floor(uptime % 60);

      const uptimeString = `${days}d ${hours}h ${minutes}m ${seconds}s`;

      // Get memory usage
      const memUsage = process.memoryUsage();
      const memUsedMB = (memUsage.heapUsed / 1024 / 1024).toFixed(2);
      const memTotalMB = (memUsage.heapTotal / 1024 / 1024).toFixed(2);

      // Build embed
      const embed = new EmbedBuilder()
        .setTitle('🤖 Bot Information')
        .setColor(0xd50000)
        .setDescription('CTF management bot for Discord servers')
        .addFields(
          {
            name: '⏱️ Uptime',
            value: uptimeString,
            inline: true,
          },
          {
            name: '💾 Memory Usage',
            value: `${memUsedMB}MB / ${memTotalMB}MB`,
            inline: true,
          },
          {
            name: '🚩 Total CTFs',
            value: `${stats.totalCTFs}`,
            inline: true,
          },
          {
            name: '✅ Active CTFs',
            value: `${stats.activeCTFs}`,
            inline: true,
          },
          {
            name: '📦 Archived CTFs',
            value: `${stats.archivedCTFs}`,
            inline: true,
          },
          {
            name: '📝 Counter',
            value: `${stats.counter}`,
            inline: true,
          },
          {
            name: '🔗 Links',
            value:
              '[GitHub](https://github.com/teebow1e/Hweplir) • [Report Issue](https://github.com/teebow1e/Hweplir/issues)',
            inline: false,
          }
        )
        .setTimestamp()
        .setFooter({
          text: `Developed exclusively for CLB BKSEC`,
          iconURL: interaction.user.displayAvatarURL(),
        });

      await interaction.reply({ embeds: [embed] });

      logger.info(`User ${interaction.user.tag} requested bot info`);
    } catch (error) {
      logger.error('Error in whoami command:', error);
      await interaction.reply({
        content: '❌ An error occurred while fetching bot information.',
        ephemeral: true,
      });
    }
  },
};

export default command;
