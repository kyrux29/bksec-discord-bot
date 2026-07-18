import { Client } from 'discord.js';
import { config } from '../config/env';
import databaseService from './database.service';
import challengeService from './challenge.service';
import logger from '../utils/logger';

class CTFSchedulerService {
  private running=false;
  start(client:Client){ void this.tick(client); setInterval(()=>void this.tick(client),5*60*1000); }
  async tick(client:Client){if(this.running)return;this.running=true;try{
    const guild=await client.guilds.fetch(config.SERVER_ID);const now=Math.floor(Date.now()/1000);const ctfs=await databaseService.getAllCTFs();
    for(const ctf of ctfs){if(ctf.data.archived||ctf.data.channelsPurged)continue;
      await challengeService.notificationChannel(guild,ctf.data).catch((e)=>logger.warn(`Announcements channel check failed for ${ctf.data.name}`,e));
      const start=ctf.data.starttime??0;const end=ctf.data.competitionEndtime||ctf.data.endtime;if(!start||!end)continue;
      const milestones:[string,number,number,string][]=[['before_24h',start-86400,start-3600,'[REMINDER] **'+ctf.data.name+'** starts <t:'+start+':R>.'],['before_1h',start-3600,start,'[REMINDER] **'+ctf.data.name+'** starts in less than one hour.'],['started',start,Math.max(start+1,end-10800),'[START] **'+ctf.data.name+'** has started.'],['remaining_3h',end-10800,end-3600,'[TIME] **'+ctf.data.name+'** has less than three hours remaining.'],['remaining_1h',end-3600,end,'[TIME] **'+ctf.data.name+'** has less than one hour remaining.'],['ended',end,end+86400,'[END] **'+ctf.data.name+'** has ended.']];
      for(const [key,time,expires,text] of milestones){if(now>=time&&now<expires&&await databaseService.markReminderSent(Number(ctf.key),key))await challengeService.announce(guild,ctf.data,text);}
      if(now>=start-86400&&now<=end){await challengeService.refreshDashboard(guild,ctf.key,ctf.data).catch((e)=>logger.warn(`Dashboard refresh failed for ${ctf.data.name}`,e));}
    }
    await (await import('./discord.service')).default.syncEndedCTFs(guild);
  }catch(error){logger.error('CTF scheduler failed:',error);}finally{this.running=false;}}
}
export default new CTFSchedulerService();
