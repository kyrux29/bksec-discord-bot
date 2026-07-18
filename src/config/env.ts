import dotenv from 'dotenv';
import { EnvConfig } from '../types';
import logger from '../utils/logger';

// Load environment variables
dotenv.config();

/**
 * Validate and export environment configuration
 */
function validateEnv(): EnvConfig {
  const requiredVars = [
    'SERVER_ID',
    'BOT_TOKEN',
    'VIEW_ALL_CTF_ROLEID',
    'ACTIVE_CTF_ROLEID',
    'ADMIN_ROLE_ID',
    // TODO: RE-ENABLE — task commands temporarily disabled. Uncomment these
    // when the task env vars are set in .env, and also restore the imports/
    // registrations/handlers in src/index.ts.
    // 'TASK_ADMIN_CHANNEL_ID',
    // 'TASK_ROLE_PWN',
    // 'TASK_ROLE_REV',
    // 'TASK_ROLE_CRYPTO',
    // 'TASK_ROLE_ALL',
  ];
  const missing: string[] = [];

  for (const varName of requiredVars) {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  }

  if (missing.length > 0) {
    logger.error(`Missing required environment variables: ${missing.join(', ')}`);
    logger.error('Please create a .env file based on .env.example');
    process.exit(1);
  }

  return {
    SERVER_ID: process.env.SERVER_ID!,
    BOT_TOKEN: process.env.BOT_TOKEN!,
    VIEW_ALL_CTF_ROLEID: process.env.VIEW_ALL_CTF_ROLEID!,
    ACTIVE_CTF_ROLEID: process.env.ACTIVE_CTF_ROLEID!,
    VERIFIED_ROLE_ID: process.env.VERIFIED_ROLE_ID ?? '',
    ADMIN_ROLE_ID: process.env.ADMIN_ROLE_ID ?? '',
    TASK_ADMIN_CHANNEL_ID: process.env.TASK_ADMIN_CHANNEL_ID ?? '',
    TASK_ROLE_PWN: process.env.TASK_ROLE_PWN ?? '',
    TASK_ROLE_REV: process.env.TASK_ROLE_REV ?? '',
    TASK_ROLE_CRYPTO: process.env.TASK_ROLE_CRYPTO ?? '',
    TASK_ROLE_ALL: process.env.TASK_ROLE_ALL ?? '',
    LOG_CHANNELID: process.env.LOG_CHANNELID,
    DENY_CTF_ROLEID: process.env.DENY_CTF_ROLEID,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN ?? '',
    GH_INVITE_REPO_OWNER: process.env.GH_INVITE_REPO_OWNER ?? '',
    GH_INVITE_REPO_NAME: process.env.GH_INVITE_REPO_NAME ?? '',
  };
}

export const config = validateEnv();
