import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types'; import databaseService from '../../services/database.service';
import { errorEmbed,successEmbed } from '../../utils/embed.builder'; import challengeService from '../../services/challenge.service';
const command:Command={data:new SlashCommandBuilder().setName('writeup').setDescription('Quản lý writeup challenge')
 .addSubcommand((s)=>s.setName('claim').setDescription('Nhận viết writeup'))
 .addSubcommand((s)=>s.setName('submit').setDescription('Nộp writeup').addStringOption((o)=>o.setName('url').setDescription('Link writeup/PR').setRequired(true))) as SlashCommandBuilder,
 async execute(interaction:ChatInputCommandInteraction){
  if(!interaction.guild||!interaction.channel?.isThread()){await interaction.reply({embeds:[errorEmbed('Hãy chạy trong challenge thread.')],ephemeral:true});return;}
  const challenge=await databaseService.getChallengeByThread(interaction.channel.id);if(!challenge||challenge.status!=='solved'){await interaction.reply({embeds:[errorEmbed('Challenge chưa solved hoặc chưa được đăng ký.')],ephemeral:true});return;}
  const ctf=await databaseService.findByKey(String(challenge.ctfId));if(!ctf)return;const sub=interaction.options.getSubcommand();
  if(sub==='claim'){if(challenge.writeupOwner&&challenge.writeupOwner!==interaction.user.id){await interaction.reply({embeds:[errorEmbed(`Writeup đã được <@${challenge.writeupOwner}> nhận.`)],ephemeral:true});return;}
   await databaseService.updateChallenge(challenge.id,{writeupOwner:interaction.user.id});await interaction.reply({embeds:[successEmbed('Bạn đã nhận viết writeup.') ]});return;}
  if(challenge.writeupOwner!==interaction.user.id){await interaction.reply({embeds:[errorEmbed('Bạn phải claim writeup trước khi submit.')],ephemeral:true});return;}
  const url=interaction.options.getString('url',true);if(!/^https?:\/\//i.test(url)){await interaction.reply({embeds:[errorEmbed('URL không hợp lệ.')],ephemeral:true});return;}
  await databaseService.updateChallenge(challenge.id,{writeupUrl:url});await challengeService.announce(
    interaction.guild,
    ctf.data,
    `[WRITEUP COMPLETED] **${challenge.name}**\n` +
    `Challenge solved by: ${challenge.solverIds.map((id)=>`<@${id}>`).join(', ') || 'Not recorded'}\n` +
    `Written by: <@${interaction.user.id}>\n` +
    `Document: ${url}\n` +
    `Thread: <#${challenge.threadId}>`
  );
  await interaction.channel.setLocked(true,'Writeup submitted').catch(()=>undefined); await interaction.channel.setArchived(true,'Writeup submitted').catch(()=>undefined);
  await interaction.reply({embeds:[successEmbed('Đã ghi nhận writeup.')]});
 }};export default command;
