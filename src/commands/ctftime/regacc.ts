import { ChannelType, ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types';
import ctftimeService from '../../services/ctftime.service';
import databaseService from '../../services/database.service';
import { createEmbed, errorEmbed, successEmbed } from '../../utils/embed.builder';
import logger from '../../utils/logger';
import { config } from '../../config/env';
import { requireAdmin } from '../../utils/role.guard';

async function currentCategoryId(interaction: ChatInputCommandInteraction): Promise<string | null> {
  const channel = interaction.channel;
  if (!channel) return null;

  if (channel.isThread()) {
    if (!channel.parentId || !interaction.guild) return null;
    const parent = await interaction.guild.channels.fetch(channel.parentId).catch(() => null);
    return parent && 'parentId' in parent ? parent.parentId : null;
  }

  return 'parentId' in channel ? channel.parentId : null;
}

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('ct-regacc')
    .setDescription('[CTFTime] Cập nhật tài khoản dùng chung của CTF')
    .addStringOption((option) =>
      option
        .setName('username')
        .setDescription('Tên đăng nhập của tài khoản dùng chung')
        .setMaxLength(128)
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('password')
        .setDescription('Mật khẩu của tài khoản dùng chung')
        .setMaxLength(256)
        .setRequired(true)
    )
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

      const username = interaction.options.getString('username', true);
      const password = interaction.options.getString('password', true);
      if (!username.trim() || !password) {
        await interaction.editReply({
          embeds: [errorEmbed('Username và password không được để trống.')],
        });
        return;
      }
      const suppliedCategoryId = interaction.options.getString('cate_id');
      const categoryId = suppliedCategoryId || (await currentCategoryId(interaction));

      if (!categoryId || !/^\d{17,20}$/.test(categoryId)) {
        await interaction.editReply({
          embeds: [errorEmbed('Không tìm thấy Discord Category ID hợp lệ.')],
        });
        return;
      }

      const ctf = await databaseService.findByCategoryId(categoryId);
      if (!ctf || ctf.data.ctftimeid === 0) {
        await interaction.editReply({
          embeds: [errorEmbed('CTFTime event không tồn tại trong DB.')],
        });
        return;
      }

      const competitionEnd = ctf.data.competitionEndtime || ctf.data.endtime;
      if (competitionEnd > 0 && Math.floor(Date.now() / 1000) >= competitionEnd) {
        await interaction.editReply({
          embeds: [errorEmbed('Không thể cập nhật credentials sau khi giải đã kết thúc.')],
        });
        return;
      }

      const result = await ctftimeService.getCTF(ctf.data.ctftimeid, true, username, password);
      if (!result || !('archiveAt' in result)) {
        await interaction.editReply({ embeds: [errorEmbed('Failed to fetch CTF info')] });
        return;
      }

      const infoChannel = await interaction.guild.channels
        .fetch(ctf.data.channel)
        .catch(() => null);
      if (infoChannel?.type !== ChannelType.GuildText) {
        await interaction.editReply({ embeds: [errorEmbed('Info channel not found')] });
        return;
      }

      const message = await infoChannel.messages.fetch(ctf.data.infom).catch(() => null);
      if (!message) {
        await interaction.editReply({ embeds: [errorEmbed('Info message not found')] });
        return;
      }

      await message.edit({ embeds: [createEmbed(result.embedData)] });
      await interaction.editReply({
        embeds: [
          successEmbed(
            `Đã cập nhật login của <***${ctf.data.name}***>. Mật khẩu được ẩn bằng spoiler và sẽ tự xoá khi giải kết thúc.`
          ),
        ],
      });

      if (config.LOG_CHANNELID) {
        const logChannel = interaction.guild.channels.cache.get(config.LOG_CHANNELID);
        if (logChannel?.isTextBased()) {
          await logChannel
            .send(`${interaction.user.username} updated shared login for ***${ctf.data.name}***`)
            .catch((error) => logger.warn('Could not write ct-regacc audit log:', error));
        }
      }

      logger.info(`User ${interaction.user.tag} updated login info for CTF: ${ctf.data.name}`);
    } catch (error) {
      logger.error('Error in ct-regacc command:', error);
      const payload = { embeds: [errorEmbed('Không thể cập nhật tài khoản CTF.')] };
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(payload).catch(() => undefined);
      } else {
        await interaction.reply({ ...payload, ephemeral: true }).catch(() => undefined);
      }
    }
  },
};

export default command;
