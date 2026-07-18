import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ButtonInteraction,
  TextChannel,
} from 'discord.js';
import ctftimeService from '../services/ctftime.service';
import databaseService from '../services/database.service';
import discordService from '../services/discord.service';
import { createEmbed, successEmbed, errorEmbed, warningEmbed } from '../utils/embed.builder';
import logger from '../utils/logger';
import { config } from '../config/env';
import { isAdmin } from '../utils/role.guard';

/**
 * Buttons for showing/hiding long ongoing CTFs
 */
export class ShowOngoButtons extends ActionRowBuilder<ButtonBuilder> {
  constructor() {
    super();
    this.addComponents(
      new ButtonBuilder()
        .setCustomId('ongo_show_all')
        .setLabel('Xem tất cả')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('👁')
    );
  }
}

/**
 * Buttons for hiding long ongoing CTFs
 */
export class HideOngoButtons extends ActionRowBuilder<ButtonBuilder> {
  constructor() {
    super();
    this.addComponents(
      new ButtonBuilder()
        .setCustomId('ongo_hide_long')
        .setLabel('Ẩn CTF >5 ngày')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('❌')
    );
  }
}

/**
 * Pagination buttons for upcoming CTFs
 */
export class UpcomingPaginationButtons extends ActionRowBuilder<ButtonBuilder> {
  constructor(currentPage: number, step: number, totalPages: number) {
    super();

    const prevButton = new ButtonBuilder()
      .setCustomId(`upco_prev_${currentPage}_${step}`)
      .setLabel('<')
      .setStyle(currentPage === 0 ? ButtonStyle.Secondary : ButtonStyle.Primary)
      .setDisabled(currentPage === 0);

    const nextButton = new ButtonBuilder()
      .setCustomId(`upco_next_${currentPage}_${step}`)
      .setLabel('>')
      .setStyle(currentPage === totalPages - 1 ? ButtonStyle.Secondary : ButtonStyle.Primary)
      .setDisabled(currentPage === totalPages - 1);

    this.addComponents(prevButton, nextButton);
  }
}

/**
 * Pagination buttons for CTF list
 */
export class ListPaginationButtons extends ActionRowBuilder<ButtonBuilder> {
  constructor(order: string, currentPage: number, step: number, totalPages: number) {
    super();

    const prevButton = new ButtonBuilder()
      .setCustomId(`list_prev_${order}_${currentPage}_${step}`)
      .setLabel('<')
      .setStyle(currentPage === 0 ? ButtonStyle.Secondary : ButtonStyle.Primary)
      .setDisabled(currentPage === 0);

    const nextButton = new ButtonBuilder()
      .setCustomId(`list_next_${order}_${currentPage}_${step}`)
      .setLabel('>')
      .setStyle(currentPage === totalPages - 1 ? ButtonStyle.Secondary : ButtonStyle.Primary)
      .setDisabled(currentPage === totalPages - 1);

    this.addComponents(prevButton, nextButton);
  }
}

/**
 * Confirmation buttons for deleting CTF
 */
export class DeleteConfirmButtons extends ActionRowBuilder<ButtonBuilder> {
  constructor(ctfKey: string, requesterId: string) {
    super();

    const deleteAllButton = new ButtonBuilder()
      .setCustomId(`delete_all_${ctfKey}_${requesterId}`)
      .setLabel('Xoá tất cả')
      .setStyle(ButtonStyle.Primary);

    const keepChannelsButton = new ButtonBuilder()
      .setCustomId(`delete_keep_${ctfKey}_${requesterId}`)
      .setLabel('Giữ lại channel')
      .setStyle(ButtonStyle.Primary);

    const cancelButton = new ButtonBuilder()
      .setCustomId(`delete_cancel_${ctfKey}_${requesterId}`)
      .setLabel('Huỷ')
      .setStyle(ButtonStyle.Secondary);

    this.addComponents(deleteAllButton, keepChannelsButton, cancelButton);
  }
}

/**
 * Buttons for terms acceptance confirmation
 */
export class TermsAcceptButtons extends ActionRowBuilder<ButtonBuilder> {
  constructor() {
    super();

    const agreeButton = new ButtonBuilder()
      .setCustomId('terms_agree')
      .setLabel('I Agree')
      .setStyle(ButtonStyle.Success)
      .setEmoji('✅');

    const disagreeButton = new ButtonBuilder()
      .setCustomId('terms_disagree')
      .setLabel('I Disagree')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('❌');

    this.addComponents(agreeButton, disagreeButton);
  }
}

/**
 * Handle button interactions
 */
export async function handleButtonInteraction(interaction: ButtonInteraction) {
  const customId = interaction.customId;

  try {
    // Handle ongoing CTF buttons
    if (customId === 'ongo_show_all') {
      await interaction.deferUpdate();
      const result = await ctftimeService.getOngoingCTF(false);
      if (result) {
        const embed = createEmbed(result.embed);
        await interaction.editReply({ embeds: [embed], components: [new HideOngoButtons()] });
      }
      return;
    }

    if (customId === 'ongo_hide_long') {
      await interaction.deferUpdate();
      const result = await ctftimeService.getOngoingCTF(true);
      if (result) {
        const embed = createEmbed(result.embed);
        await interaction.editReply({ embeds: [embed], components: [new ShowOngoButtons()] });
      }
      return;
    }

    // Handle upcoming CTF pagination
    if (customId.startsWith('upco_prev_') || customId.startsWith('upco_next_')) {
      await interaction.deferUpdate();
      const parts = customId.split('_');
      const currentPage = parseInt(parts[2]);
      const step = parseInt(parts[3]);
      const newPage = customId.startsWith('upco_prev_') ? currentPage - 1 : currentPage + 1;

      const result = await ctftimeService.getUpcomingCTF(newPage, step);
      if (result) {
        const embed = createEmbed(result.embed);
        await interaction.editReply({
          embeds: [embed],
          components: [new UpcomingPaginationButtons(newPage, step, result.totalPages)],
        });
      }
      return;
    }

    // Handle CTF list pagination
    if (customId.startsWith('list_prev_') || customId.startsWith('list_next_')) {
      await interaction.deferUpdate();
      const parts = customId.split('_');
      const order = parts[2] as 'Mới nhất' | 'Cũ nhất';
      const currentPage = parseInt(parts[3]);
      const step = parseInt(parts[4]);
      const newPage = customId.startsWith('list_prev_') ? currentPage - 1 : currentPage + 1;

      const result = await ctftimeService.getListCTF(order, newPage, step);
      if (result) {
        const embed = createEmbed(result.embed);
        await interaction.editReply({
          embeds: [embed],
          components: [new ListPaginationButtons(order, newPage, step, result.totalPages)],
        });
      }
      return;
    }

    // Handle delete confirmation buttons
    if (
      customId.startsWith('delete_all_') ||
      customId.startsWith('delete_keep_') ||
      customId.startsWith('delete_cancel_')
    ) {
      const parts = customId.split('_');
      const action = parts[1]; // 'all', 'keep', or 'cancel'
      const ctfKey = parts[2];
      const requesterId = parts[3];

      if (
        !interaction.guild ||
        interaction.user.id !== requesterId ||
        !(await isAdmin(interaction))
      ) {
        await interaction.reply({
          embeds: [errorEmbed('You do not have permission to perform this action')],
          ephemeral: true,
        });
        return;
      }

      if (action === 'cancel') {
        await interaction.update({
          embeds: [successEmbed('Đã huỷ')],
          components: [],
        });
        return;
      }

      await interaction.deferUpdate();

      const ctf = await databaseService.findByKey(ctfKey);
      if (!ctf) {
        await interaction.editReply({
          embeds: [errorEmbed('CTF not found in database')],
          components: [],
        });
        return;
      }
      const ctfData = ctf.data;

      if (action === 'all') {
        const categoryDeleted = await discordService.deleteCTFCategory(
          interaction.guild,
          ctfData.cate
        );
        if (!categoryDeleted) {
          await interaction.editReply({
            embeds: [errorEmbed('Failed to delete Discord category. Database was not changed.')],
            components: [],
          });
          return;
        }
      } else if (action === 'keep') {
        const credentialsRedacted = await discordService.redactCTFCredentials(
          interaction.guild,
          ctfData.channel,
          ctfData.infom
        );
        if (!credentialsRedacted) {
          await interaction.editReply({
            embeds: [
              errorEmbed(
                'Could not remove shared credentials. Channels and database were not changed.'
              ),
            ],
            components: [],
          });
          return;
        }

        const categoryUnlisted = await discordService.unlistCTFCategory(
          interaction.guild,
          ctfData.cate
        );
        if (!categoryUnlisted) {
          await interaction.editReply({
            embeds: [errorEmbed('Failed to unlist Discord category. Database was not changed.')],
            components: [],
          });
          return;
        }
      }

      const role = await interaction.guild.roles.fetch(ctfData.role).catch(() => null);
      if (role) {
        try {
          await role.delete('CTF removed through admin-delete');
        } catch (error) {
          logger.error(`Failed to delete role for ${ctfData.name}:`, error);
          await interaction.editReply({
            embeds: [
              errorEmbed(
                'Discord category was updated, but role deletion failed. Database was kept so the operation can be retried.'
              ),
            ],
            components: [],
          });
          return;
        }
      }

      // Discord is now in the requested state; only then remove persistent data.
      await databaseService.deleteCTF(ctfKey);

      if (action === 'all') {
        await interaction.editReply({
          embeds: [successEmbed(`Toàn bộ dữ liệu của <***${ctfData.name}***> đã bị xoá`)],
          components: [],
        });

        if (config.LOG_CHANNELID) {
          const logChannel = interaction.guild.channels.cache.get(
            config.LOG_CHANNELID
          ) as TextChannel;
          if (logChannel) {
            await logChannel.send(
              `${interaction.user.username} has deleted <***${ctfData.name}***>`
            );
          }
        }

        logger.info(`User ${interaction.user.tag} deleted CTF (all): ${ctfData.name}`);
      } else if (action === 'keep') {
        await interaction.editReply({
          embeds: [successEmbed(`<***${ctfData.name}***> đã bị bỏ khỏi list`)],
          components: [],
        });

        if (config.LOG_CHANNELID) {
          const logChannel = interaction.guild.channels.cache.get(
            config.LOG_CHANNELID
          ) as TextChannel;
          if (logChannel) {
            await logChannel.send(
              `${interaction.user.username} has unlinked <***${ctfData.name}***> from the database`
            );
          }
        }

        logger.info(`User ${interaction.user.tag} deleted CTF (keep channels): ${ctfData.name}`);
      }
    }

    // Handle terms acceptance buttons
    if (customId === 'terms_agree' || customId === 'terms_disagree') {
      if (!interaction.guild) {
        await interaction.update({
          embeds: [errorEmbed('This action must be performed in a server')],
          components: [],
        });
        return;
      }

      if (customId === 'terms_agree') {
        try {
          const member = await interaction.guild.members.fetch(interaction.user.id);

          // Check if user already has the role
          if (member.roles.cache.has(config.VERIFIED_ROLE_ID)) {
            await interaction.update({
              embeds: [
                warningEmbed(
                  'Already Verified',
                  'You have already accepted the terms and conditions.'
                ),
              ],
              components: [],
            });
            return;
          }

          // Add the verified role
          const role = interaction.guild.roles.cache.get(config.VERIFIED_ROLE_ID);

          if (!role) {
            await interaction.update({
              embeds: [errorEmbed('Verified role not found. Please contact an administrator.')],
              components: [],
            });
            logger.error(`Verified role ${config.VERIFIED_ROLE_ID} not found in guild`);
            return;
          }

          await member.roles.add(role.id);

          await interaction.update({
            embeds: [
              successEmbed(
                'Welcome! Your role has been added. You will now be able to access server channels.'
              ),
            ],
            components: [],
          });
        } catch (error) {
          logger.error('Error adding verified role:', error);
          await interaction.update({
            embeds: [
              errorEmbed('Failed to add role. Please try again or contact an administrator.'),
            ],
            components: [],
          });
        }
      } else if (customId === 'terms_disagree') {
        await interaction.update({
          embeds: [
            warningEmbed(
              'Terms Not Accepted',
              'You have declined the terms and conditions. You will not be able to access server channels until you accept them.\n\nYou can run `/verify` again when you are ready to accept.'
            ),
          ],
          components: [],
        });
      }
    }
  } catch (error) {
    logger.error('Error handling button interaction:', error);
    if (!interaction.isRepliable()) return;

    const payload = {
      embeds: [errorEmbed('Không thể xử lý thao tác này. Vui lòng thử lại.')],
      components: [],
    };
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload).catch(() => undefined);
    } else {
      await interaction.reply({ ...payload, ephemeral: true }).catch(() => undefined);
    }
  }
}
