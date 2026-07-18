import {
  ActionRowBuilder,
  EmbedBuilder,
  GuildMember,
  ModalBuilder,
  ModalSubmitInteraction,
  PermissionFlagsBits,
  StringSelectMenuInteraction,
  TextChannel,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import databaseService from '../services/database.service';
import { config } from '../config/env';
import { TaskCategory } from '../types';
import { errorEmbed, successEmbed } from '../utils/embed.builder';
import {
  isTaskCategory,
  roleIdForTaskCategory,
  taskCategoryLabels,
  taskCustomIds,
} from '../utils/task.constants';
import logger from '../utils/logger';

export async function handleTaskModalInteraction(
  interaction: ModalSubmitInteraction
): Promise<boolean> {
  if (interaction.customId.startsWith(`${taskCustomIds.issueModal}:`)) {
    await handleIssueTaskModal(interaction);
    return true;
  }

  if (interaction.customId.startsWith(taskCustomIds.submitModalPrefix)) {
    await handleSubmitModal(interaction);
    return true;
  }

  return false;
}

export async function handleTaskSelectInteraction(
  interaction: StringSelectMenuInteraction
): Promise<boolean> {
  if (interaction.customId === taskCustomIds.submitSelect) {
    await handleSubmitSelect(interaction);
    return true;
  }

  if (interaction.customId === taskCustomIds.showAllSelect) {
    await handleShowAllSelect(interaction);
    return true;
  }

  return false;
}

async function handleIssueTaskModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.guild || !interaction.channel || !interaction.channel.isTextBased()) {
    await interaction.reply({
      embeds: [errorEmbed('This command must be used in a text channel')],
      ephemeral: true,
    });
    return;
  }

  const [, categoryValue, encodedName] = interaction.customId.split(':');
  if (!isTaskCategory(categoryValue)) {
    await interaction.reply({ embeds: [errorEmbed('Invalid task category')], ephemeral: true });
    return;
  }

  const category = categoryValue as TaskCategory;
  const name = decodeURIComponent(encodedName);
  const requirement = interaction.fields.getTextInputValue(taskCustomIds.requirementInput).trim();
  const roleId = roleIdForTaskCategory(category);
  const sourceChannel = interaction.channel as TextChannel;

  await interaction.deferReply({ ephemeral: true });

  try {
    const thread = await sourceChannel.threads.create({
      name: name.slice(0, 100),
      autoArchiveDuration: 10080,
      reason: `Club task issued by ${interaction.user.tag}`,
    });

    const task = await databaseService.createTask({
      name,
      category,
      requirement,
      threadId: thread.id,
      channelId: sourceChannel.id,
      roleId,
      createdBy: interaction.user.id,
    });

    const embed = new EmbedBuilder()
      .setTitle(`Task: ${task.name}`)
      .setColor(0x3498db)
      .addFields(
        { name: 'Category', value: taskCategoryLabels[task.category], inline: true },
        { name: 'Requirement', value: task.requirement.slice(0, 1024) }
      )
      .setTimestamp();

    await thread.send({ content: `<@&${roleId}>`, embeds: [embed] });

    await interaction.editReply({ embeds: [successEmbed(`Task created in <#${thread.id}>`)] });
  } catch (error) {
    logger.error('Failed to issue task:', error);
    await interaction.editReply({ embeds: [errorEmbed('Failed to create task')] });
  }
}

async function handleSubmitSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  const taskId = Number(interaction.values[0]);
  const task = await databaseService.getTask(taskId);

  if (!task) {
    await interaction.update({ content: 'Task not found.', components: [] });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(`${taskCustomIds.submitModalPrefix}${task.id}`)
    .setTitle(`Submit: ${task.name.slice(0, 35)}`);

  const submissionInput = new TextInputBuilder()
    .setCustomId(taskCustomIds.submitInput)
    .setLabel('Submission link or description')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(3000);

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(submissionInput));
  await interaction.showModal(modal);
}

async function handleSubmitModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.guild || !interaction.channel || !interaction.channel.isTextBased()) {
    await interaction.reply({
      embeds: [errorEmbed('This command must be used in a text channel')],
      ephemeral: true,
    });
    return;
  }

  const taskId = Number(interaction.customId.slice(taskCustomIds.submitModalPrefix.length));
  const task = await databaseService.getTask(taskId);

  if (!task) {
    await interaction.reply({ embeds: [errorEmbed('Task not found')], ephemeral: true });
    return;
  }

  const content = interaction.fields.getTextInputValue(taskCustomIds.submitInput).trim();
  await interaction.deferReply({ ephemeral: true });

  try {
    const submission = await databaseService.upsertTaskSubmission({
      taskId: task.id,
      userId: interaction.user.id,
      username: interaction.user.tag,
      content,
    });

    await (interaction.channel as TextChannel).send(
      `${interaction.user} has submitted for task **${task.name}**.`
    );

    const adminChannel = interaction.guild.channels.cache.get(config.TASK_ADMIN_CHANNEL_ID) as
      TextChannel | undefined;
    if (adminChannel) {
      const embed = new EmbedBuilder()
        .setTitle(`Submission: ${task.name}`)
        .setColor(0x2ecc71)
        .addFields(
          { name: 'Member', value: `${interaction.user} (${interaction.user.tag})`, inline: false },
          { name: 'Category', value: taskCategoryLabels[task.category], inline: true },
          { name: 'Content', value: submission.content.slice(0, 1024), inline: false }
        )
        .setTimestamp();

      await adminChannel.send({ embeds: [embed] });
    }

    await interaction.editReply({ embeds: [successEmbed('Submission received')] });
  } catch (error) {
    logger.error('Failed to submit task:', error);
    await interaction.editReply({ embeds: [errorEmbed('Failed to submit task')] });
  }
}

async function handleShowAllSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!interaction.guild || !interaction.member) {
    await interaction.update({ content: 'This command must be used in a server.', components: [] });
    return;
  }

  const taskId = Number(interaction.values[0]);
  const task = await databaseService.getTask(taskId);

  if (!task) {
    await interaction.update({ content: 'Task not found.', components: [] });
    return;
  }

  const member = interaction.member as GuildMember;
  const isAdmin =
    member.roles.cache.has(config.ADMIN_ROLE_ID) ||
    member.permissions.has(PermissionFlagsBits.Administrator);

  if (!task.revealed && !isAdmin) {
    await interaction.update({
      content: 'Submissions for this task are not revealed yet.',
      components: [],
    });
    return;
  }

  const visibleTask = task.revealed ? task : await databaseService.revealTask(task.id);
  const submissions = await databaseService.getTaskSubmissions(task.id);

  const embed = new EmbedBuilder()
    .setTitle(`Submissions: ${visibleTask?.name ?? task.name}`)
    .setColor(0x9b59b6)
    .setDescription(submissions.length ? null : 'No submissions yet.')
    .setTimestamp();

  for (const submission of submissions.slice(0, 20)) {
    embed.addFields({
      name: submission.username,
      value: submission.content.slice(0, 1024),
    });
  }

  await interaction.update({
    content: task.revealed ? 'Submissions are visible.' : 'Task submissions are now revealed.',
    embeds: [embed],
    components: [],
  });
}
