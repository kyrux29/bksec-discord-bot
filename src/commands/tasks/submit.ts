import {
  ActionRowBuilder,
  ChatInputCommandInteraction,
  StringSelectMenuBuilder,
  SlashCommandBuilder,
} from 'discord.js';
import { Command } from '../../types';
import databaseService from '../../services/database.service';
import { errorEmbed } from '../../utils/embed.builder';
import { taskCategoryLabels, taskCustomIds } from '../../utils/task.constants';

const command: Command = {
  data: new SlashCommandBuilder().setName('submit').setDescription('Submit work for a club task'),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guild) {
      await interaction.reply({
        embeds: [errorEmbed('This command must be used in a server')],
        ephemeral: true,
      });
      return;
    }

    const tasks = await databaseService.getAllTasks();

    if (tasks.length === 0) {
      await interaction.reply({
        embeds: [errorEmbed('No tasks are available for submission')],
        ephemeral: true,
      });
      return;
    }

    const select = new StringSelectMenuBuilder()
      .setCustomId(taskCustomIds.submitSelect)
      .setPlaceholder('Select a task')
      .addOptions(
        tasks.slice(0, 25).map((task) => ({
          label: task.name.slice(0, 100),
          description: taskCategoryLabels[task.category],
          value: task.id.toString(),
        }))
      );

    await interaction.reply({
      content: 'Select the task you want to submit for.',
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
      ephemeral: true,
    });
  },
};

export default command;
