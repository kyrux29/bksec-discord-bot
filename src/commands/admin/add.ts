import { SlashCommandBuilder, ChatInputCommandInteraction, TextChannel, CategoryChannel } from 'discord.js';
import { Command } from '../../types';
import databaseService from '../../services/database.service';
import discordService from '../../services/discord.service';
import { successEmbed, errorEmbed, warningEmbed } from '../../utils/embed.builder';
import logger from '../../utils/logger';
import { config } from '../../config/env';
import { requireAdmin } from '../../utils/role.guard';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('admin-add')
    .setDescription('Thêm vào List một giải CTF cũ')
    .addStringOption((option) =>
      option
        .setName('cate_id')
        .setDescription(
          'Nhập Discord Category ID của giải CTF trong server [Hoặc chỉ cần chạy trong channel thuộc CTF đó]'
        )
        .setRequired(false)
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      if (!(await requireAdmin(interaction))) return;

      if (!interaction.guild || !interaction.channel) {
        await interaction.reply({ embeds: [errorEmbed('This command must be used in a server')], ephemeral: true });
        return;
      }

      await interaction.deferReply();

      let cateId = interaction.options.get('cate_id')?.value as string | undefined;

      // Get category ID from current channel if not provided
      if (!cateId || cateId === '0') {
        const channel = interaction.channel as TextChannel;
        if (!channel.parent) {
          await interaction.editReply({ embeds: [errorEmbed('This channel is not in a category')] });
          return;
        }
        cateId = channel.parent.id;
      }

      // Validate category ID
      if (!/^\d+$/.test(cateId)) {
        await interaction.editReply({ embeds: [errorEmbed('Invalid category ID')] });
        return;
      }

      // Check if already exists in database
      const existing = await databaseService.findByCategoryId(cateId);

      if (existing) {
        await interaction.editReply({
          embeds: [warningEmbed('Oops...', 'CTF này đã có trong list.')],
        });
        return;
      }

      // Get category
      const category = interaction.guild.channels.cache.get(cateId) as CategoryChannel;

      if (!category) {
        await interaction.editReply({ embeds: [errorEmbed('Category not found')] });
        return;
      }

      try {
        // Remove [UNLISTED] prefix if present
        let categoryName = category.name;
        if (categoryName.startsWith('[UNLISTED]')) {
          categoryName = categoryName.replace('[UNLISTED]', '').trim();
          await category.setName(categoryName);
        }

        // Create role and set permissions
        const role = await discordService.relistCTFCategory(
          interaction.guild,
          cateId,
          categoryName
        );

        if (!role) {
          await interaction.editReply({ embeds: [errorEmbed('Failed to create role')] });
          return;
        }

        // Add to database
        await databaseService.addCTF({
          ctftimeid: 0,
          role: role.id,
          cate: cateId,
          name: categoryName,
          infom: '0',
          channel: '0',
          endtime: 0,
        });

        await interaction.editReply({
          embeds: [successEmbed(`<***${categoryName}***> đã thêm vào list`)],
        });

        // Log to log channel
        if (config.LOG_CHANNELID) {
          const logChannel = interaction.guild.channels.cache.get(config.LOG_CHANNELID) as TextChannel;
          if (logChannel) {
            await logChannel.send(
              `${interaction.user.username} has manually listed <***${categoryName}***>`
            );
          }
        }

        logger.info(`User ${interaction.user.tag} added CTF to list: ${categoryName}`);
      } catch (error) {
        logger.error('Error during category re-listing:', error);

        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ embeds: [errorEmbed('An error occurred')] });
        }
      }
    } catch (error) {
      logger.error('Error in admin-add command:', error);

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds: [errorEmbed('An error occurred')] });
      }
    }
  },
};

export default command;
