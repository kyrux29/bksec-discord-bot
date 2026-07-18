import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  GuildMember,
  PermissionFlagsBits,
} from 'discord.js';
import { config } from '../config/env';
import { errorEmbed } from './embed.builder';

export async function requireRole(
  interaction: ChatInputCommandInteraction,
  roleId: string
): Promise<boolean> {
  if (!interaction.guild || !interaction.member) {
    await interaction.reply({
      embeds: [errorEmbed('This command must be used in a server')],
      ephemeral: true,
    });
    return false;
  }

  const member = interaction.member as GuildMember;
  const hasRole = member.roles.cache.has(roleId);
  const isAdministrator = member.permissions.has(PermissionFlagsBits.Administrator);

  if (!hasRole && !isAdministrator) {
    await interaction.reply({
      embeds: [errorEmbed('You do not have permission to use this command')],
      ephemeral: true,
    });
    return false;
  }

  return true;
}

export async function isAdmin(
  interaction: ChatInputCommandInteraction | ButtonInteraction
): Promise<boolean> {
  if (!interaction.guild || !config.ADMIN_ROLE_ID) return false;

  const member = await interaction.guild.members.fetch(interaction.user.id);
  return (
    member.roles.cache.has(config.ADMIN_ROLE_ID) ||
    member.permissions.has(PermissionFlagsBits.Administrator)
  );
}

export async function requireAdmin(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (await isAdmin(interaction)) return true;

  await interaction.reply({
    embeds: [errorEmbed('You do not have permission to use this command')],
    ephemeral: true,
  });
  return false;
}
