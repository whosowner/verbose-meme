// index.js
// Discord Bot: AutoRole + ModMail (thread-based) + Express keep-alive
// Config: GUILD_ID, MODMAIL_CHANNEL_ID, AUTOROLE_ID set below (not env)
// Only TOKEN comes from .env

require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  ChannelType,
  EmbedBuilder,
  ActivityType
} = require('discord.js');
const express = require('express');

// ==================== CONFIG (edit these) ====================
const GUILD_ID = '1368201487687094282';
const MODMAIL_CHANNEL_ID = '1527243341530665041'; // channel where threads get created
const AUTOROLE_ID = '1455565004098244658';
// ================================================================

const TOKEN = process.env.TOKEN;
const PORT = process.env.PORT || 3000;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message]
});

// Map to track userId -> threadId for modmail
const modmailThreads = new Map();

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);

  client.user.setPresence({
    activities: [{ name: 'DMs for support | ModMail', type: ActivityType.Watching }],
    status: 'online'
  });
});

// ==================== AUTOROLE ====================
client.on('guildMemberAdd', async (member) => {
  if (member.guild.id !== GUILD_ID) return;
  try {
    await member.roles.add(AUTOROLE_ID);
  } catch (err) {
    console.error('Failed to assign autorole:', err.message);
  }
});

// ==================== MODMAIL ====================
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // DM from user -> forward to thread in modmail channel
  if (message.channel.type === ChannelType.DM) {
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) return;

    const parentChannel = guild.channels.cache.get(MODMAIL_CHANNEL_ID);
    if (!parentChannel) return;

    let threadId = modmailThreads.get(message.author.id);
    let thread = threadId ? guild.channels.cache.get(threadId) : null;

    if (!thread) {
      thread = await parentChannel.threads.create({
        name: `modmail-${message.author.username}`,
        autoArchiveDuration: 1440,
        reason: 'New modmail thread'
      });
      modmailThreads.set(message.author.id, thread.id);

      const infoEmbed = new EmbedBuilder()
        .setTitle('New ModMail Thread')
        .setDescription(`From: <@${message.author.id}> (${message.author.tag})`)
        .setColor('Blue')
        .setTimestamp();
      await thread.send({ embeds: [infoEmbed] });
    }

    const embed = new EmbedBuilder()
      .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL() })
      .setDescription(message.content || '*(no content)*')
      .setColor('Green')
      .setTimestamp();

    const files = message.attachments.map(a => a.url);
    await thread.send({ embeds: [embed], files });

    await message.reply('Your message has been sent to the staff team. They will respond here.').catch(() => {});
    return;
  }

  // Reply inside modmail thread -> forward to user DM
  if (message.channel.isThread() && message.channel.parentId === MODMAIL_CHANNEL_ID) {
    const userId = [...modmailThreads.entries()].find(([, tId]) => tId === message.channel.id)?.[0];
    if (!userId) return;

    const user = await client.users.fetch(userId).catch(() => null);
    if (!user) return;

    const embed = new EmbedBuilder()
      .setAuthor({ name: `Staff (${message.author.tag})`, iconURL: message.author.displayAvatarURL() })
      .setDescription(message.content || '*(no content)*')
      .setColor('Orange')
      .setTimestamp();

    const files = message.attachments.map(a => a.url);
    await user.send({ embeds: [embed], files }).catch(() => {
      message.reply('Could not DM the user. They may have DMs disabled.');
    });
  }
});

// ==================== EXPRESS SERVER ====================
const app = express();

app.get('/', (req, res) => {
  res.send('Bot is running.');
});

app.listen(PORT, () => {
  console.log(`Express server listening on port ${PORT}`);
});

client.login(TOKEN);
