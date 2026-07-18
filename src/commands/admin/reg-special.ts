import { SlashCommandBuilder, ChatInputCommandInteraction, TextChannel } from 'discord.js';
import { Command } from '../../types';
import databaseService from '../../services/database.service';
import discordService from '../../services/discord.service';
import { successEmbed, errorEmbed } from '../../utils/embed.builder';
import logger from '../../utils/logger';
import { config } from '../../config/env';
import { requireAdmin } from '../../utils/role.guard';
import challengeService from '../../services/challenge.service';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('admin-reg_special')
    .setDescription('Đăng kí giải CTF thủ công (không trên CTFTime) cho server')
    .addStringOption((option) =>
      option.setName('name').setDescription('Tên của giải CTF muốn tạo').setRequired(true)
    )
    .addIntegerOption((option) =>
      option
        .setName('hide_after')
        .setDescription('Số ngày hiện kênh trước khi auto ẩn')
        .setMinValue(1)
        .setRequired(true)
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      if (!(await requireAdmin(interaction))) return;

      if (!interaction.guild) {
        await interaction.reply({ embeds: [errorEmbed('This command must be used in a server')], ephemeral: true });
        return;
      }

      await interaction.deferReply();

      const name = interaction.options.get('name')?.value as string;
      const days = interaction.options.get('hide_after')?.value as number;

      // Create special category, role, and channels
      const created = await discordService.createSpecialCTFCategory(interaction.guild, name);

      if (!created) {
        await interaction.editReply({ embeds: [errorEmbed('Failed to create CTF category')] });
        return;
      }

      const { category, role, infoChannel, generalChannel } = created;

      // Calculate end time (current time + days)
      const endTime = Math.floor(Date.now() / 1000) + 86400 * days;

      // Add CTF to database
      const databaseId = await databaseService.addCTF({
        ctftimeid: 0,
        role: role.id,
        cate: category.id,
        name: name.trim(),
        infom: '0',
        channel: infoChannel.id,
        endtime: endTime,
        starttime: Math.floor(Date.now() / 1000),
        competitionEndtime: endTime,
      });

      const registeredCTF = await databaseService.findByKey(databaseId.toString());
      if (registeredCTF) {
        await challengeService.refreshDashboard(
          interaction.guild,
          registeredCTF.key,
          registeredCTF.data
        );
      }

      // Revert any CTFs whose time has run out
      await discordService.syncEndedCTFs(interaction.guild);

      await interaction.editReply({
        embeds: [
          successEmbed(
            `Đã tạo channel cho <***${name}***>\nVui lòng tự cung cấp info giải CTF vào <#${infoChannel.id}>. Thảo luận chung tại <#${generalChannel.id}>.`
          ),
        ],
      });

      // Log to log channel
      if (config.LOG_CHANNELID) {
        const logChannel = interaction.guild.channels.cache.get(config.LOG_CHANNELID) as TextChannel;
        if (logChannel) {
          await logChannel.send(`${interaction.user.username} has manually created ***${name}***`);
        }
      }

      // Auto-hide old CTFs
      const currentTime = Math.floor(Date.now() / 1000);
      const expiredCTFs = await databaseService.getExpiredCTFs(currentTime);

      if (expiredCTFs.length > 0) {
        for (const ctf of expiredCTFs) {
          await discordService.archiveCTFCategory(interaction.guild, ctf.data.cate, ctf.data.channel);
          await databaseService.updateCTF(ctf.key, { archived: true });
        }

        if (config.LOG_CHANNELID) {
          const logChannel = interaction.guild.channels.cache.get(config.LOG_CHANNELID) as TextChannel;
          if (logChannel) {
            await logChannel.send('`reg-special` - Auto hiding some CTFs');
          }
        }
      }

      logger.info(`User ${interaction.user.tag} created special CTF: ${name} (hide after ${days} days)`);
    } catch (error) {
      logger.error('Error in admin-reg_special command:', error);

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds: [errorEmbed('An error occurred')] });
      }
    }
  },
};

export default command;
