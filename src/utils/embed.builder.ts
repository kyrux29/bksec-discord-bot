import { EmbedBuilder, ColorResolvable } from 'discord.js';
import { CTFEmbedData } from '../types';

// Discord API hard limits
const LIMITS = {
  title: 256,
  description: 4096,
  fieldName: 256,
  fieldValue: 1024,
  footerText: 2048,
  authorName: 256,
  maxFields: 25,
} as const;

const trunc = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + '…' : s);

export function createEmbed(data: Partial<CTFEmbedData>): EmbedBuilder {
  const embed = new EmbedBuilder();

  if (data.title) embed.setTitle(trunc(data.title, LIMITS.title));
  if (data.description) embed.setDescription(trunc(data.description, LIMITS.description));
  if (data.url) embed.setURL(data.url);
  if (data.color !== undefined) embed.setColor(data.color as ColorResolvable);
  if (data.thumbnail) embed.setThumbnail(data.thumbnail);
  if (data.image) embed.setImage(data.image);
  if (data.timestamp !== undefined) embed.setTimestamp(data.timestamp);

  if (data.author) {
    embed.setAuthor({
      name: trunc(data.author.name, LIMITS.authorName),
      iconURL: data.author.iconURL,
      url: data.author.url,
    });
  }

  if (data.footer) {
    const footer =
      typeof data.footer === 'string'
        ? { text: trunc(data.footer, LIMITS.footerText) }
        : { text: trunc(data.footer.text, LIMITS.footerText), iconURL: data.footer.iconURL };
    embed.setFooter(footer);
  }

  if (data.fields && data.fields.length > 0) {
    const capped = data.fields.slice(0, LIMITS.maxFields);
    embed.setFields(
      capped.map((f) => ({
        name: trunc(f.name, LIMITS.fieldName),
        value: trunc(f.value, LIMITS.fieldValue),
        inline: f.inline ?? false,
      }))
    );
  }

  return embed;
}

export function simpleEmbed(
  title: string,
  description: string,
  color: number = 0xfcba03
): EmbedBuilder {
  return createEmbed({ title, description, color, fields: [] });
}

export function errorEmbed(message: string = "Can't see shit"): EmbedBuilder {
  return simpleEmbed('Error', message, 0x000000);
}

export function loadingEmbed(): EmbedBuilder {
  return simpleEmbed('Đợi chút...', '', 0xfee12b);
}

export function successEmbed(message: string): EmbedBuilder {
  return simpleEmbed('Xong!', message, 0x03ac13);
}

export function warningEmbed(title: string, message: string): EmbedBuilder {
  return simpleEmbed(title, message, 0xfee12b);
}
