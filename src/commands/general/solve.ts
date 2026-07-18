import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types';
import { config } from '../../config/env';
import databaseService from '../../services/database.service';
import challengeService from '../../services/challenge.service';
import { errorEmbed, successEmbed } from '../../utils/embed.builder';
import { requireRole } from '../../utils/role.guard';
import logger from '../../utils/logger';

const memberIds = (value:string) => [...new Set(value.match(/\d{17,20}/g) ?? [])];
const command: Command = {
  data: new SlashCommandBuilder().setName('solve').setDescription('Đánh dấu challenge hiện tại là solved')
    .addStringOption((o) => o.setName('members').setDescription('Danh sách mention người solve').setRequired(true))
    .addIntegerOption((o) => o.setName('points').setDescription('Điểm thực nhận').setMinValue(0)) as SlashCommandBuilder,
  async execute(interaction: ChatInputCommandInteraction) {
    try {
      if (!interaction.guild || !interaction.channel?.isThread()) {
        await interaction.reply({embeds:[errorEmbed('Hãy chạy /solve trong challenge thread.')],ephemeral:true}); return;
      }
      if (!(await requireRole(interaction,config.ACTIVE_CTF_ROLEID))) return;
      const challenge=await databaseService.getChallengeByThread(interaction.channel.id);
      if (!challenge) { await interaction.reply({embeds:[errorEmbed('Thread này chưa được tạo bằng /challenge create.')],ephemeral:true}); return; }
      const ids=memberIds(interaction.options.getString('members',true));
      if (!ids.length) { await interaction.reply({embeds:[errorEmbed('Hãy mention ít nhất một thành viên.')],ephemeral:true}); return; }
      for (const id of ids) if (!await interaction.guild.members.fetch(id).catch(()=>null)) { await interaction.reply({embeds:[errorEmbed(`Không tìm thấy member ${id}.`)],ephemeral:true}); return; }
      await interaction.deferReply({ephemeral:true});
      const ctf=await databaseService.findByKey(String(challenge.ctfId)); if (!ctf) throw new Error('CTF not found');
      const before=await databaseService.getChallengesByCTF(challenge.ctfId);
      const firstBlood=!before.some((c)=>c.status==='solved' && c.category===challenge.category);
      const solveTime=Math.floor(Date.now()/1000); const elapsed=challenge.claimedAt ? solveTime-challenge.claimedAt : null;
      const updated=await databaseService.updateChallenge(challenge.id,{status:'solved',solverIds:ids,solvedBy:interaction.user.id,solvedAt:solveTime,points:interaction.options.getInteger('points')??challenge.points,claimedBy:undefined});
      await databaseService.upsertSolvedChallenge({ctfId:challenge.ctfId,threadId:challenge.threadId,challengeName:challenge.name,solverIds:ids,solvedBy:interaction.user.id});
      await challengeService.renameThread(interaction.guild,updated);
      await challengeService.announce(interaction.guild,ctf.data,
        `[CHALLENGE SOLVED] **${challenge.name}**\n` +
        `Category: **${challenge.category.toUpperCase()}**${updated.points ? `\nPoints: **${updated.points}**` : ''}\n` +
        `Solved by: ${ids.map((id)=>`<@${id}>`).join(', ')}\n` +
        `Recorded by: <@${interaction.user.id}>` +
        `${firstBlood?'\nRecognition: **Category First Blood**':''}` +
        `${elapsed!==null?`\nElapsed time: **${Math.floor(elapsed/3600)}h ${Math.floor(elapsed%3600/60)}m**`:''}\n` +
        `Thread: <#${challenge.threadId}>`
      );
      await challengeService.refreshDashboard(interaction.guild,ctf.key,ctf.data);
      await interaction.channel.send('[WRITEUP TASK] Unassigned. Use `/writeup claim`, then `/writeup submit` when completed.');
      await interaction.editReply({embeds:[successEmbed(`Đã solve **${challenge.name}**${firstBlood?' — First blood!':''}`)]});
    } catch(error) { logger.error('Solve failed:',error); if(interaction.deferred||interaction.replied) await interaction.editReply({embeds:[errorEmbed('Không thể cập nhật solve.')]}); }
  }
}; export default command;
