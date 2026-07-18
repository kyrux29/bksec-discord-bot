import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import { Command } from '../../types';
import { errorEmbed } from '../../utils/embed.builder';
import logger from '../../utils/logger';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('enroll-htba')
    .setDescription("Enroll to get access to BKSEC's HTB Academy Sharing"),

  async execute(interaction: ChatInputCommandInteraction) {
    try {
      if (!interaction.guild) {
        await interaction.reply({
          embeds: [errorEmbed('This command must be used in a server')],
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      // Create terms embed with detailed terms
      const termsEmbed = new EmbedBuilder()
        .setTitle('📜 BKSEC Sharing - HTB Academy')
        .setColor(0xfcba03)
        .setDescription(
          'Bằng việc hoàn thành chạy lệnh này, bạn sẽ được add vào channel sharing tài khoản HTB Academy, tuy nhiên có một vài quy định:\n\n' +
            '**1. Tuân thủ các quy định được nêu ra trong kênh**\n' +
            '**2. Sử dụng tài nguyên hợp lý, hiệu quả, hướng đến sự phát triển chung của CLB.**\n' +
            '**3. Không chia sẻ các tài nguyên trong kênh với các thành viên không thuộc CLB.**\n' +
            'Bằng việc click "I Agree", bạn đồng ý với các quy định trên và sẽ sử dụng hiệu quả tài nguyên chung của CLB.'
        )
        .setFooter({ text: 'Your choice?' })
        .setTimestamp();

      // Import button view dynamically to avoid circular dependency
      const { TermsAcceptButtons } = await import('../../components/buttons');
      const view = new TermsAcceptButtons();

      await interaction.editReply({
        embeds: [termsEmbed],
        components: [view],
      });
    } catch (error) {
      logger.error('Error in verify command:', error);

      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({
          embeds: [errorEmbed('An error occurred')],
        });
      }
    }
  },
};

export default command;
