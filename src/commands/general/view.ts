import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import { Command } from '../../types';
import { successEmbed, errorEmbed, warningEmbed } from '../../utils/embed.builder';
import databaseService from '../../services/database.service';
import logger from '../../utils/logger';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('c-view')
    .setDescription('Toggle ẩn/hiện channel thảo luận của một giải CTF trong server')
    .addRoleOption((option) =>
      option
        .setName('ctf-name')
        .setDescription('Nhập role CTF cần thêm (có dạng "<Tên CTF>")')
        .setRequired(true)
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      if (!interaction.guild) {
        await interaction.reply({ embeds: [errorEmbed('This command must be used in a server')], ephemeral: true });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      const role = interaction.options.get('ctf-name')?.role;

      if (!role) {
        await interaction.editReply({ embeds: [errorEmbed('Invalid role')] });
        return;
      }

      const ctfEntry = await databaseService.findByRoleId(role.id);
      if (ctfEntry?.data.channelsPurged) {
        await interaction.editReply({
          embeds: [warningEmbed(
            'Channels Unavailable',
            `Channels for **${ctfEntry.data.name}** have been cleaned up to free server space. The role is kept for record-keeping.`
          )],
        });
        return;
      }

      const member = await interaction.guild.members.fetch(interaction.user.id);

      // Check if user has the role
      if (member.roles.cache.has(role.id)) {
        // Remove role
        await member.roles.remove(role.id);
        await interaction.editReply({
          embeds: [successEmbed(`Đã ẩn ***${role.name}*** cho bạn!`)],
        });
        logger.info(`User ${interaction.user.tag} removed role: ${role.name}`);
      } else {
        // Add role
        await member.roles.add(role.id);
        await interaction.editReply({
          embeds: [successEmbed(`Đã hiện ***${role.name}*** cho bạn!`)],
        });
        logger.info(`User ${interaction.user.tag} added role: ${role.name}`);
      }
    } catch (error) {
      logger.error('Error in c-view command:', error);

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds: [errorEmbed('An error occurred')] });
      }
    }
  },
};

export default command;
