import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { Command } from '../../types'; import { requireAdmin } from '../../utils/role.guard';
import databaseService from '../../services/database.service'; import challengeService from '../../services/challenge.service';
import { errorEmbed,successEmbed } from '../../utils/embed.builder';
const command:Command={data:new SlashCommandBuilder().setName('admin-unsolve').setDescription('Hoàn tác solve của challenge hiện tại'),async execute(interaction:ChatInputCommandInteraction){
  if(!(await requireAdmin(interaction)))return; if(!interaction.guild||!interaction.channel?.isThread()){await interaction.reply({embeds:[errorEmbed('Hãy chạy trong challenge thread.')],ephemeral:true});return;}
  const challenge=await databaseService.getChallengeByThread(interaction.channel.id);if(!challenge){await interaction.reply({embeds:[errorEmbed('Challenge không tồn tại.')],ephemeral:true});return;}
  const ctf=await databaseService.findByKey(String(challenge.ctfId));if(!ctf)return;
  const updated=await databaseService.updateChallenge(challenge.id,{status:challenge.claimantIds.length?'working':'unclaimed',claimedAt:challenge.claimantIds.length?challenge.claimedAt:undefined,solverIds:[],solvedBy:undefined,solvedAt:undefined,writeupOwner:undefined,writeupUrl:undefined});
  await databaseService.deleteChallengeSolveRecord(challenge.threadId); await challengeService.renameThread(interaction.guild,updated);await challengeService.refreshDashboard(interaction.guild,ctf.key,ctf.data);
  await interaction.reply({embeds:[successEmbed(`Đã hoàn tác solve **${challenge.name}**.`)],ephemeral:true});
}};export default command;
