import { ChannelType, EmbedBuilder, Guild, TextChannel } from 'discord.js';
import databaseService from './database.service';
import { CHALLENGE_CATEGORIES, CTFChallenge, CTFData, ChallengeStatus } from '../types';
import logger from '../utils/logger';
import { config } from '../config/env';

export const statusSymbols: Record<ChallengeStatus, string> = {
  unclaimed: '[OPEN]',
  working: '[ACTIVE]',
  idea: '[LEAD]',
  solved: '[SOLVED]',
};

export function fitDashboardLines(lines: string[], limit = 1024): string {
  if (lines.length === 0) return 'Chưa có challenge';

  const included: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const remaining = lines.length - index - 1;
    const suffix = remaining > 0 ? `\n… và ${remaining} challenge khác` : '';
    const candidate = [...included, lines[index]].join('\n') + suffix;
    if (candidate.length > limit) break;
    included.push(lines[index]);
  }

  const omitted = lines.length - included.length;
  const suffix = omitted > 0 ? `\n… và ${omitted} challenge khác` : '';
  return `${included.join('\n')}${suffix}`.slice(0, limit);
}

class ChallengeService {
  private announcementCreations = new Map<string, Promise<TextChannel | null>>();

  async dashboardChannel(guild: Guild, ctf: CTFData): Promise<TextChannel | null> {
    if (ctf.channel !== '0') {
      const infoChannel = await guild.channels.fetch(ctf.channel).catch(() => null);
      if (infoChannel?.type === ChannelType.GuildText) return infoChannel;
    }
    return this.notificationChannel(guild, ctf);
  }

  private async configureAnnouncementChannel(
    guild: Guild,
    channel: TextChannel,
    ctf: CTFData
  ): Promise<void> {
    const readOnlyRoleIds = [config.ACTIVE_CTF_ROLEID, config.VIEW_ALL_CTF_ROLEID, ctf.role].filter(
      Boolean
    );

    await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false });
    for (const roleId of new Set(readOnlyRoleIds)) {
      await channel.permissionOverwrites.edit(roleId, { SendMessages: false });
    }

    if (guild.members.me) {
      await channel.permissionOverwrites.edit(guild.members.me, {
        ViewChannel: true,
        SendMessages: true,
      });
    }
  }

  async notificationChannel(guild: Guild, ctf: CTFData): Promise<TextChannel | null> {
    const category = await guild.channels.fetch(ctf.cate).catch(() => null);
    if (category?.type !== ChannelType.GuildCategory) return null;

    const existingAnnouncements = category.children.cache.find(
      (channel) => channel.type === ChannelType.GuildText && channel.name === 'announcements'
    );
    let announcements: TextChannel | null =
      existingAnnouncements?.type === ChannelType.GuildText ? existingAnnouncements : null;

    if (!announcements) {
      let pending = this.announcementCreations.get(category.id);
      if (!pending) {
        pending = guild.channels
          .create({
            name: 'announcements',
            type: ChannelType.GuildText,
            parent: category.id,
            reason: `CTF notifications for ${ctf.name}`,
          })
          .then((channel) => channel)
          .catch((error) => {
            logger.warn(`Could not create announcements channel for ${ctf.name}:`, error);
            return null;
          });
        this.announcementCreations.set(category.id, pending);
      }

      announcements = await pending;
      this.announcementCreations.delete(category.id);
    }

    if (!announcements || announcements.type !== ChannelType.GuildText) return null;
    await this.configureAnnouncementChannel(guild, announcements, ctf).catch((error) => {
      logger.warn(`Could not make announcements read-only for ${ctf.name}:`, error);
    });
    return announcements;
  }

  threadName(challenge: CTFChallenge): string {
    const claimCount =
      challenge.status !== 'solved' && challenge.claimantIds.length > 0
        ? ` (${challenge.claimantIds.length})`
        : '';
    return `${statusSymbols[challenge.status]} ${challenge.name}${claimCount}`.slice(0, 100);
  }

  async refreshDashboard(guild: Guild, ctfKey: string, ctf: CTFData): Promise<void> {
    const ctfId = Number(ctfKey);
    const challenges = await databaseService.getChallengesByCTF(ctfId);
    const now = Math.floor(Date.now() / 1000);
    const end = ctf.competitionEndtime || ctf.endtime;
    const solved = challenges.filter((challenge) => challenge.status === 'solved');
    const working = challenges.filter(
      (challenge) => challenge.status === 'working' || challenge.status === 'idea'
    );

    const categoryLines = CHALLENGE_CATEGORIES.map((category) => {
      const categoryChallenges = challenges.filter((challenge) => challenge.category === category);
      if (categoryChallenges.length === 0) return null;
      const categorySolved = categoryChallenges.filter(
        (challenge) => challenge.status === 'solved'
      ).length;
      return `**${category.toUpperCase()}**: ${categorySolved}/${categoryChallenges.length}`;
    })
      .filter((line): line is string => line !== null)
      .join('\n');

    const challengeLines = challenges.map((challenge) => {
      const members = challenge.status === 'solved' ? challenge.solverIds : challenge.claimantIds;
      const memberText = members.length ? ` — ${members.map((id) => `<@${id}>`).join(', ')}` : '';
      const points = challenge.points ? ` (${challenge.points} pts)` : '';
      return `${statusSymbols[challenge.status]} <#${challenge.threadId}>${memberText}${points}`;
    });

    const time = end > now ? `Kết thúc <t:${end}:R> · <t:${end}:f>` : 'Đã kết thúc';
    const embed = new EmbedBuilder()
      .setTitle(`${ctf.name} — Progress ${solved.length}/${challenges.length}`.slice(0, 256))
      .setColor(0xd50000)
      .setDescription(
        `${time}\n\n[SOLVED] **${solved.length}** · [ACTIVE] **${working.length}** · [TOTAL] **${challenges.length}**`
      )
      .addFields(
        { name: 'Theo category', value: categoryLines || 'Chưa có challenge' },
        { name: 'Challenges', value: fitDashboardLines(challengeLines) }
      )
      .setTimestamp();

    const targetChannel = await this.dashboardChannel(guild, ctf);
    if (!targetChannel) throw new Error('Dashboard channel not found');

    const existing = await databaseService.getDashboard(ctfId);
    if (existing?.channelId === targetChannel.id) {
      const message = await targetChannel.messages.fetch(existing.messageId).catch(() => null);
      if (message) {
        await message.edit({ embeds: [embed] });
        return;
      }
    }

    const message = await targetChannel.send({ embeds: [embed] });
    await message.pin().catch((error) => {
      logger.warn(`Could not pin dashboard for ${ctf.name}:`, error);
    });
    await databaseService.setDashboard(ctfId, targetChannel.id, message.id);

    if (existing && existing.messageId !== message.id) {
      const oldChannel = await guild.channels.fetch(existing.channelId).catch(() => null);
      if (oldChannel?.type === ChannelType.GuildText) {
        const oldMessage = await oldChannel.messages.fetch(existing.messageId).catch(() => null);
        await oldMessage?.delete().catch(() => undefined);
      }
    }
  }

  async renameThread(guild: Guild, challenge: CTFChallenge): Promise<void> {
    const channel = await guild.channels.fetch(challenge.threadId).catch(() => null);
    if (channel?.isThread()) await channel.setName(this.threadName(challenge));
  }

  async announce(guild: Guild, ctf: CTFData, content: string): Promise<void> {
    const channel = await this.notificationChannel(guild, ctf);
    if (!channel) throw new Error(`No announcement channel for ${ctf.name}`);
    await channel.send({ content, allowedMentions: { parse: ['users'] } });
  }
}

export default new ChallengeService();
