import { ChannelType, EmbedBuilder, Guild, TextChannel } from 'discord.js';
import databaseService from './database.service';
import { CTFChallenge, CTFData, ChallengeStatus } from '../types';
import logger from '../utils/logger';

export const statusSymbols: Record<ChallengeStatus,string> = {
  unclaimed: '[OPEN]',
  working: '[ACTIVE]',
  idea: '[LEAD]',
  solved: '[SOLVED]',
};

class ChallengeService {
  async dashboardChannel(guild: Guild, ctf: CTFData): Promise<TextChannel | null> {
    if (ctf.channel !== '0') {
      const infoChannel = await guild.channels.fetch(ctf.channel).catch(() => null);
      if (infoChannel?.type === ChannelType.GuildText) return infoChannel;
    }
    return this.notificationChannel(guild, ctf);
  }

  async notificationChannel(guild: Guild, ctf: CTFData): Promise<TextChannel | null> {
    const category = await guild.channels.fetch(ctf.cate).catch(() => null);
    if (category?.type === ChannelType.GuildCategory) {
      const announcements = category.children.cache.find(
        (c) => c.type === ChannelType.GuildText && c.name === 'announcements'
      );
      if (announcements?.type === ChannelType.GuildText) return announcements;

      try {
        return await guild.channels.create({
          name: 'announcements',
          type: ChannelType.GuildText,
          parent: category.id,
          reason: `CTF notifications for ${ctf.name}`,
        });
      } catch (error) {
        logger.warn(`Could not create announcements channel for ${ctf.name}:`, error);
      }

      const general = category.children.cache.find(
        (c) => c.type === ChannelType.GuildText && c.name === 'general'
      );
      if (general?.type === ChannelType.GuildText) return general;
    }
    const fallback = ctf.channel !== '0' ? await guild.channels.fetch(ctf.channel).catch(() => null) : null;
    return fallback?.type === ChannelType.GuildText ? fallback : null;
  }

  threadName(challenge: CTFChallenge): string {
    const claimCount = challenge.status !== 'solved' && challenge.claimantIds.length > 0
      ? ` (${challenge.claimantIds.length})`
      : '';
    return `${statusSymbols[challenge.status]} ${challenge.name}${claimCount}`.slice(0,100);
  }

  async refreshDashboard(guild: Guild, ctfKey: string, ctf: CTFData): Promise<void> {
    const ctfId = Number(ctfKey); const challenges = await databaseService.getChallengesByCTF(ctfId);
    const now = Math.floor(Date.now()/1000); const end = ctf.competitionEndtime || ctf.endtime;
    const solved = challenges.filter((c) => c.status === 'solved');
    const working = challenges.filter((c) => c.status === 'working' || c.status === 'idea');
    const categories = ['web','pwn','crypto','rev','forensics','misc'];
    const categoryLines = categories.map((cat) => {
      const all = challenges.filter((c) => c.category === cat); if (!all.length) return null;
      return `**${cat.toUpperCase()}**: ${all.filter((c) => c.status === 'solved').length}/${all.length}`;
    }).filter(Boolean).join('\n');
    const challengeLines = challenges.slice(0,35).map((c) => {
      const members = c.status === 'solved' ? c.solverIds : c.claimantIds;
      const memberText = members.length ? ` — ${members.map((id) => `<@${id}>`).join(', ')}` : '';
      return `${statusSymbols[c.status]} <#${c.threadId}>${memberText}${c.points ? ` (${c.points} pts)` : ''}`;
    }).join('\n');
    const time = end > now ? `Kết thúc <t:${end}:R> · <t:${end}:f>` : 'Đã kết thúc';
    const embed = new EmbedBuilder().setTitle(`${ctf.name} — Progress ${solved.length}/${challenges.length}`).setColor(0xd50000)
      .setDescription(`${time}\n\n[SOLVED] **${solved.length}** · [ACTIVE] **${working.length}** · [TOTAL] **${challenges.length}**`)
      .addFields({name:'Theo category',value:categoryLines || 'Chưa có challenge'},{name:'Challenges',value:challengeLines.slice(0,1024) || 'Chưa có challenge'})
      .setTimestamp();
    const targetChannel = await this.dashboardChannel(guild, ctf);
    if (!targetChannel) throw new Error('Dashboard channel not found');

    const existing = await databaseService.getDashboard(ctfId);
    if (existing && existing.channelId === targetChannel.id) {
      const channel = await guild.channels.fetch(existing.channelId).catch(() => null);
      if (channel?.type === ChannelType.GuildText) {
        const message = await channel.messages.fetch(existing.messageId).catch(() => null);
        if (message) { await message.edit({embeds:[embed]}); return; }
      }
    }

    const message = await targetChannel.send({embeds:[embed]});
    await message.pin().catch(() => undefined);
    await databaseService.setDashboard(ctfId,targetChannel.id,message.id);

    if (existing && existing.channelId !== targetChannel.id) {
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
    const channel = await this.notificationChannel(guild,ctf); if (channel) await channel.send(content);
    else logger.warn(`No announcement channel for ${ctf.name}`);
  }
}
export default new ChallengeService();
