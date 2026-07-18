import {
  ActionRowBuilder,
  ChatInputCommandInteraction,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { Command, TaskCategory } from '../../types';
import { config } from '../../config/env';
import { requireRole } from '../../utils/role.guard';
import { taskCategories, taskCategoryLabels, taskCustomIds } from '../../utils/task.constants';

const command: Command = {
  data: new SlashCommandBuilder()
    .setName('issue-task')
    .setDescription('Issue a club task')
    .addStringOption((option) =>
      option.setName('name').setDescription('Task name').setRequired(true).setMaxLength(100)
    )
    .addStringOption((option) =>
      option
        .setName('category')
        .setDescription('Task category')
        .setRequired(true)
        .addChoices(
          ...taskCategories.map((category) => ({
            name: taskCategoryLabels[category],
            value: category,
          }))
        )
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    if (!(await requireRole(interaction, config.ADMIN_ROLE_ID))) return;

    const name = interaction.options.getString('name', true);
    const category = interaction.options.getString('category', true) as TaskCategory;

    const modal = new ModalBuilder()
      .setCustomId(`${taskCustomIds.issueModal}:${category}:${encodeURIComponent(name)}`)
      .setTitle('Issue Task');

    const requirementInput = new TextInputBuilder()
      .setCustomId(taskCustomIds.requirementInput)
      .setLabel('Task requirement')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(3000);

    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(requirementInput));

    await interaction.showModal(modal);
  },
};

export default command;
