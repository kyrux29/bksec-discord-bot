import { ChannelType, ChatInputCommandInteraction, SlashCommandBuilder, TextChannel } from 'discord.js';
import { ChallengeCategory, ChallengeStatus, Command } from '../../types';
import databaseService from '../../services/database.service';
import challengeService from '../../services/challenge.service';
import { config } from '../../config/env';
import { requireRole } from '../../utils/role.guard';
import { errorEmbed, successEmbed } from '../../utils/embed.builder';

const categories = ['web','pwn','crypto','rev','forensics','misc'] as const;
async function threadChallenge(interaction: ChatInputCommandInteraction) {
  return interaction.channel?.isThread() ? databaseService.getChallengeByThread(interaction.channel.id) : null;
}

const command: Command = {
  data: new SlashCommandBuilder().setName('challenge').setDescription('Quản lý challenge CTF')
    .addSubcommand((s) => s.setName('create').setDescription('Tạo challenge thread')
      .addStringOption((o) => o.setName('name').setDescription('Tên challenge').setRequired(true).setMaxLength(80))
      .addStringOption((o) => o.setName('category').setDescription('Category').setRequired(true).addChoices(...categories.map((x) => ({name:x.toUpperCase(),value:x}))))
      .addIntegerOption((o) => o.setName('points').setDescription('Điểm').setMinValue(0)))
    .addSubcommand((s) => s.setName('claim').setDescription('Nhận làm challenge hiện tại'))
    .addSubcommand((s) => s.setName('release').setDescription('Bỏ nhận challenge hiện tại'))
    .addSubcommand((s) => s.setName('status').setDescription('Cập nhật trạng thái')
      .addStringOption((o) => o.setName('value').setDescription('Trạng thái').setRequired(true).addChoices({name:'Đang làm',value:'working'},{name:'Có hướng',value:'idea'},{name:'Chưa nhận',value:'unclaimed'})))
    .addSubcommand((s) => s.setName('dashboard').setDescription('Tạo/cập nhật dashboard của giải')) as SlashCommandBuilder,
  async execute(interaction) {
    if (!interaction.guild || !(await requireRole(interaction,config.ACTIVE_CTF_ROLEID))) return;
    const sub = interaction.options.getSubcommand();
    if (sub === 'create') {
      if (!interaction.channel || interaction.channel.type !== ChannelType.GuildText || !interaction.channel.parentId) {
        await interaction.reply({embeds:[errorEmbed('Hãy chạy lệnh trong text channel thuộc CTF category.')],ephemeral:true}); return;
      }
      const ctf = await databaseService.findByCategoryId(interaction.channel.parentId);
      if (!ctf) { await interaction.reply({embeds:[errorEmbed('Category chưa được đăng ký là CTF.')],ephemeral:true}); return; }
      await interaction.deferReply({ephemeral:true});
      const name=interaction.options.getString('name',true); const category=interaction.options.getString('category',true) as ChallengeCategory;
      if (!categories.includes(interaction.channel.name.toLowerCase() as typeof categories[number])) {
        await interaction.reply({embeds:[errorEmbed('Challenge chỉ được tạo trong channel web, pwn, crypto, rev, forensics hoặc misc.')],ephemeral:true}); return;
      }
      const thread=await (interaction.channel as TextChannel).threads.create({name:`[OPEN] ${name}`.slice(0,100),autoArchiveDuration:10080,reason:`Challenge created by ${interaction.user.tag}`});
      const challenge=await databaseService.createChallenge({ctfId:Number(ctf.key),threadId:thread.id,channelId:interaction.channel.id,name,category,points:interaction.options.getInteger('points')??0});
      await thread.send(`Challenge **${challenge.name}** · ${category.toUpperCase()}${challenge.points ? ` · ${challenge.points} points` : ''}\nGửi tin nhắn đầu tiên hoặc dùng \`/challenge claim\` để tham gia.`);
      await challengeService.refreshDashboard(interaction.guild,ctf.key,ctf.data);
      await interaction.editReply({embeds:[successEmbed(`Đã tạo <#${thread.id}>.`)]}); return;
    }
    if (sub === 'dashboard') {
      const categoryId = interaction.channel?.isThread()
        ? (interaction.channel.parentId ? (await interaction.guild.channels.fetch(interaction.channel.parentId).catch(()=>null))?.parentId : null)
        : interaction.channel && 'parentId' in interaction.channel ? interaction.channel.parentId : null;
      const ctf = categoryId ? await databaseService.findByCategoryId(categoryId) : null;
      if (!ctf) { await interaction.reply({embeds:[errorEmbed('Hãy chạy trong channel/thread của CTF đã đăng ký.')],ephemeral:true}); return; }
      await challengeService.refreshDashboard(interaction.guild,ctf.key,ctf.data);
      await interaction.reply({embeds:[successEmbed('Dashboard đã được cập nhật.')],ephemeral:true}); return;
    }
    const challenge=await threadChallenge(interaction);
    if (!challenge) { await interaction.reply({embeds:[errorEmbed('Lệnh này phải chạy trong challenge thread đã đăng ký.')],ephemeral:true}); return; }
    const ctf=await databaseService.findByKey(String(challenge.ctfId)); if (!ctf) return;
    let updated;
    if (sub === 'claim') {
      const result = await databaseService.addChallengeClaimant(challenge.id, interaction.user.id);
      updated = result.challenge;
      if (!result.added) { await interaction.reply({embeds:[successEmbed('Bạn đã có trong danh sách claim.')],ephemeral:true}); return; }
    } else if (sub === 'release') {
      const result = await databaseService.removeChallengeClaimant(challenge.id, interaction.user.id);
      updated = result.challenge;
      if (!result.removed) { await interaction.reply({embeds:[errorEmbed('Bạn chưa claim challenge này.')],ephemeral:true}); return; }
    } else {
      const status=interaction.options.getString('value',true) as ChallengeStatus;
      updated=await databaseService.updateChallenge(challenge.id,status==='unclaimed'?{status,claimantIds:[],claimedBy:undefined,claimedAt:undefined}:{status});
    }
    await challengeService.renameThread(interaction.guild,updated); await challengeService.refreshDashboard(interaction.guild,ctf.key,ctf.data);
    await interaction.reply({embeds:[successEmbed(`Đã cập nhật **${updated.name}**: ${updated.status}.`)],ephemeral:true});
  }
};
export default command;
