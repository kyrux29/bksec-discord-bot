import { ChannelType, Message } from 'discord.js';
import databaseService from '../services/database.service';
import challengeService from '../services/challenge.service';
import { CHALLENGE_CATEGORIES, ChallengeCategory } from '../types';
import logger from '../utils/logger';

const challengeCategories = new Set<ChallengeCategory>(CHALLENGE_CATEGORIES);

function cleanThreadName(name: string): string {
  return name
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/\s(?:\(\d+\)|\[\d+\])$/, '')
    .trim();
}

export async function handleChallengeMessage(message: Message): Promise<void> {
  if (!message.guild || message.author.bot || !message.channel.isThread()) return;

  try {
    const thread = message.channel;
    const parent = thread.parentId
      ? await message.guild.channels.fetch(thread.parentId).catch(() => null)
      : null;
    if (!parent || parent.type !== ChannelType.GuildText || !parent.parentId) return;

    const inferred = parent.name.toLowerCase() as ChallengeCategory;
    if (!challengeCategories.has(inferred)) return;

    const ctf = await databaseService.findByCategoryId(parent.parentId);
    if (!ctf) return;

    let challenge = await databaseService.getChallengeByThread(thread.id);
    if (!challenge) {
      try {
        challenge = await databaseService.createChallenge({
          ctfId: Number(ctf.key),
          threadId: thread.id,
          channelId: parent.id,
          name: cleanThreadName(thread.name) || 'untitled-challenge',
          category: inferred,
          points: 0,
        });
      } catch {
        // Another message may have registered the thread concurrently.
        challenge = await databaseService.getChallengeByThread(thread.id);
      }
    }
    if (!challenge || challenge.status === 'solved') return;

    const result = await databaseService.addChallengeClaimant(challenge.id, message.author.id);
    if (!result.added) return;

    await challengeService.renameThread(message.guild, result.challenge);
    await challengeService.refreshDashboard(message.guild, ctf.key, ctf.data);
    await thread.send({
      content: `[PARTICIPANT ADDED] <@${message.author.id}> joined this challenge.`,
      allowedMentions: { users: [message.author.id] },
    });
  } catch (error) {
    logger.error('Failed to auto-claim challenge from first message:', error);
  }
}
