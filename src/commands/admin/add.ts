import { ChannelType, ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types';
import databaseService from '../../services/database.service';
import discordService from '../../services/discord.service';
import { successEmbed, errorEmbed, warningEmbed } from '../../utils/embed.builder';
import logger from '../../utils/logger';
import { config } from '../../config/env';
import { requireAdmin } from '../../utils/role.guard';

async function currentCategoryId(interaction: ChatInputCommandInteraction): Promise<string | null> {
  const channel = interaction.channel;
  if (!channel || !interaction.guild) return null;
  if (channel.isThread()) {
    if (!channel.parentId) return null;
    const parent = await interaction.guild.channels.fetch(channel.parentId).catch(() => null);
    return parent && 'parentId' in parent ? parent.parentId : null;
  }
  return 'parentId' in channel ? channel.parentId : null;
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('admin-add')
    .setDescription('Thêm một Discord category có sẵn vào danh sách CTF')
    .addStringOption((option) =>
      option
        .setName('cate_id')
        .setDescription('Discord Category ID; tự nhận diện nếu bỏ trống')
        .setMaxLength(20)
        .setRequired(false)
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      if (!(await requireAdmin(interaction))) return;
      if (!interaction.guild) return;

      await interaction.deferReply({ ephemeral: true });
      const categoryId =
        interaction.options.getString('cate_id') || (await currentCategoryId(interaction));
      if (!categoryId || !/^\d{17,20}$/.test(categoryId)) {
        await interaction.editReply({ embeds: [errorEmbed('Category ID không hợp lệ.')] });
        return;
      }

      const existing = await databaseService.findByCategoryId(categoryId);
      if (existing) {
        await interaction.editReply({
          embeds: [warningEmbed('CTF đã tồn tại', 'Category này đã có trong database.')],
        });
        return;
      }

      const channel = await interaction.guild.channels.fetch(categoryId).catch(() => null);
      if (channel?.type !== ChannelType.GuildCategory) {
        await interaction.editReply({ embeds: [errorEmbed('Không tìm thấy Discord category.')] });
        return;
      }

      const originalName = channel.name;
      const categoryName = originalName.replace(/^\[UNLISTED\]\s*/, '').trim();
      const role = await discordService.relistCTFCategory(
        interaction.guild,
        categoryId,
        categoryName
      );
      if (!role) {
        await interaction.editReply({ embeds: [errorEmbed('Không thể tạo role cho CTF.')] });
        return;
      }

      try {
        await databaseService.addCTF({
          ctftimeid: 0,
          role: role.id,
          cate: categoryId,
          name: categoryName,
          infom: '0',
          channel: '0',
          endtime: 0,
          starttime: 0,
          competitionEndtime: 0,
        });
      } catch (error) {
        await role.delete('Rolling back failed admin-add').catch(() => undefined);
        await discordService.unlistCTFCategory(interaction.guild, categoryId);
        await channel.setName(originalName).catch(() => undefined);
        throw error;
      }

      await interaction.editReply({
        embeds: [successEmbed(`<***${categoryName}***> đã được thêm vào danh sách.`)],
      });

      if (config.LOG_CHANNELID) {
        const logChannel = interaction.guild.channels.cache.get(config.LOG_CHANNELID);
        if (logChannel?.isTextBased()) {
          await logChannel
            .send(`${interaction.user.username} manually listed <***${categoryName}***>`)
            .catch((error) => logger.warn('Could not write admin-add audit log:', error));
        }
      }
    } catch (error) {
      logger.error('Error in admin-add command:', error);
      const payload = { embeds: [errorEmbed('Không thể thêm CTF vào database.')] };
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(payload).catch(() => undefined);
      } else {
        await interaction.reply({ ...payload, ephemeral: true }).catch(() => undefined);
      }
    }
  },
};

export default command;
