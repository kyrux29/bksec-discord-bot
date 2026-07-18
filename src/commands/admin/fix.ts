import { SlashCommandBuilder, ChatInputCommandInteraction, TextChannel } from 'discord.js';
import { Command } from '../../types';
import databaseService from '../../services/database.service';
import discordService from '../../services/discord.service';
import { successEmbed, errorEmbed } from '../../utils/embed.builder';
import logger from '../../utils/logger';
import { config } from '../../config/env';
import { requireAdmin } from '../../utils/role.guard';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('admin-fix')
    .setDescription('Sửa quyền info channel cho các CTF đã archive (hotfix)'),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      if (!(await requireAdmin(interaction))) return;

      if (!interaction.guild) {
        await interaction.reply({ content: 'This command must be used in a server', ephemeral: true });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      const allCTFs = await databaseService.getAllCTFs();
      let fixedCount = 0;
      const errors: string[] = [];

      for (const ctf of allCTFs) {
        if (!ctf.data.archived) continue;
        if (!ctf.data.channel || ctf.data.channel === '0') continue;

        const infoChannel = interaction.guild.channels.cache.get(ctf.data.channel) as TextChannel;
        if (!infoChannel) continue;

        try {
          await infoChannel.permissionOverwrites.create(interaction.guild.roles.everyone, {
            ViewChannel: false,
            SendMessages: false,
          });
          fixedCount++;
          logger.info(`Fixed info channel permissions for: ${ctf.data.name}`);
        } catch (err) {
          errors.push(ctf.data.name);
          logger.error(`Failed to fix info channel for ${ctf.data.name}:`, err);
        }
      }

      const reverted = await discordService.syncEndedCTFs(interaction.guild);

      const msg = `Fixed ${fixedCount} archived CTF info channel(s). Reverted ${reverted} ended CTF(s) to normal visibility.` +
        (errors.length > 0 ? `\nFailed: ${errors.join(', ')}` : '');

      await interaction.editReply({ embeds: [successEmbed(msg)] });

      if (config.LOG_CHANNELID) {
        const logChannel = interaction.guild.channels.cache.get(config.LOG_CHANNELID) as TextChannel;
        if (logChannel) {
          await logChannel.send(`\`admin-fix\` - ${msg} (by ${interaction.user.username})`);
        }
      }

      logger.info(`User ${interaction.user.tag} ran admin-fix (${fixedCount} fixed)`);
    } catch (error) {
      logger.error('Error in admin-fix command:', error);

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ embeds: [errorEmbed('An error occurred')] });
      }
    }
  },
};

export default command;
