import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types';
import { config } from '../../config/env';
import databaseService from '../../services/database.service';
import { requireRole } from '../../utils/role.guard';
import { taskCategoryLabels } from '../../utils/task.constants';
import { errorEmbed } from '../../utils/embed.builder';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('task-status')
    .setDescription('Show task submission status'),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!(await requireRole(interaction, config.ADMIN_ROLE_ID))) return;

    const tasks = await databaseService.getTasksWithSubmissions();

    if (tasks.length === 0) {
      await interaction.reply({ embeds: [errorEmbed('No tasks found')], ephemeral: true });
      return;
    }

    const embed = new EmbedBuilder().setTitle('Task Status').setColor(0xf1c40f).setTimestamp();

    for (const task of tasks.slice(0, 20)) {
      const submitters = task.submissions.length
        ? task.submissions.map((submission) => `<@${submission.userId}>`).join(', ')
        : 'No submissions';

      embed.addFields({
        name: `${task.name} (${taskCategoryLabels[task.category]})`,
        value: `Revealed: ${task.revealed ? 'yes' : 'no'}\nSubmissions: ${submitters}`.slice(
          0,
          1024
        ),
      });
    }

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};

export default command;
