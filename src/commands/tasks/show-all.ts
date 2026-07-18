import {
  ActionRowBuilder,
  ChatInputCommandInteraction,
  GuildMember,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  SlashCommandBuilder,
} from 'discord.js';
import { Command } from '../../types';
import { config } from '../../config/env';
import databaseService from '../../services/database.service';
import { errorEmbed } from '../../utils/embed.builder';
import { taskCategoryLabels, taskCustomIds } from '../../utils/task.constants';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('show-all')
    .setDescription('Reveal or view all submissions for a task'),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild || !interaction.member) {
      await interaction.reply({
        embeds: [errorEmbed('This command must be used in a server')],
        ephemeral: true,
      });
      return;
    }

    const member = interaction.member as GuildMember;
    const isAdmin =
      member.roles.cache.has(config.ADMIN_ROLE_ID) ||
      member.permissions.has(PermissionFlagsBits.Administrator);
    const tasks = isAdmin
      ? await databaseService.getAllTasks()
      : await databaseService.getRevealedTasks();

    if (tasks.length === 0) {
      await interaction.reply({
        embeds: [errorEmbed('No visible task submissions are available')],
        ephemeral: true,
      });
      return;
    }

    const select = new StringSelectMenuBuilder()
      .setCustomId(taskCustomIds.showAllSelect)
      .setPlaceholder('Select a task')
      .addOptions(
        tasks.slice(0, 25).map((task) => ({
          label: task.name.slice(0, 100),
          description: `${taskCategoryLabels[task.category]}${task.revealed ? '' : ' • reveal'}`,
          value: task.id.toString(),
        }))
      );

    await interaction.reply({
      content: isAdmin
        ? 'Select a task to reveal and show its submissions.'
        : 'Select a revealed task to show its submissions.',
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
      ephemeral: true,
    });
  },
};

export default command;
