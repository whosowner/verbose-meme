// index.js
// Discord Bot: AutoRole + ModMail (thread-based, with close button) + Express keep-alive
// Config: GUILD_ID, MODMAIL_CHANNEL_ID, AUTOROLE_ID set below (not env)
// Only TOKEN comes from .env

require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  ChannelType,
  EmbedBuilder,
  ActivityType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
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
  partials: [Partials.Channel, Partials.Message, Partials.User, Partials.GuildMember]
});

// Map to track userId -> threadId for modmail
const modmailThreads = new Map();

// ==================== ACTIVITY (never dies) ====================
function setActivity() {
  if (!client.user) return;
  client.user.setPresence({
    activities: [{ name: 'DMs for support | ModMail', type: ActivityType.Watching }],
    status: 'online'
  });
}

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
  setActivity();
  // Discord/gateway sometimes clears presence after a while — reapply on an interval
  setInterval(setActivity, 5 * 60 * 1000); // every 5 minutes
});

// Presence can get wiped when the gateway reconnects; reapply then too
client.on('shardResume', setActivity);
client.on('shardReady', setActivity);

// ==================== AUTOROLE ====================
client.on('guildMemberAdd', async (member) => {
  try {
    if (!member.guild || member.guild.id !== GUILD_ID) return;

    // Fetch the role fresh to make sure cache isn't stale/empty
    const role = member.guild.roles.cache.get(AUTOROLE_ID)
      || await member.guild.roles.fetch(AUTOROLE_ID).catch(() => null);

    if (!role) {
      console.error(`Autorole failed: role ${AUTOROLE_ID} not found in guild ${member.guild.id}`);
      return;
    }

    // Check bot has ManageRoles and role is below bot's highest role
    const me = member.guild.members.me;
    if (!me || !me.permissions.has('ManageRoles')) {
      console.error('Autorole failed: bot is missing Manage Roles permission');
      return;
    }
    if (role.position >= me.roles.highest.position) {
      console.error('Autorole failed: bot role is not above the autorole in the role hierarchy');
      return;
    }

    await member.roles.add(role, 'Autorole on join');
    console.log(`Assigned autorole to ${member.user.tag}`);
  } catch (err) {
    console.error('Failed to assign autorole:', err);
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

      const closeRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`modmail_close_${message.author.id}`)
          .setLabel('Close Thread')
          .setStyle(ButtonStyle.Danger)
      );

      await thread.send({ embeds: [infoEmbed], components: [closeRow] });
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

  // Reply inside modmail thread -> forward to user DM (staff identity hidden)
  if (message.channel.isThread() && message.channel.parentId === MODMAIL_CHANNEL_ID) {
    const userId = [...modmailThreads.entries()].find(([, tId]) => tId === message.channel.id)?.[0];
    if (!userId) return;

    const user = await client.users.fetch(userId).catch(() => null);
    if (!user) return;

    const embed = new EmbedBuilder()
      .setAuthor({ name: 'Staff', iconURL: message.guild.iconURL() || undefined })
      .setDescription(message.content || '*(no content)*')
      .setColor('Orange')
      .setTimestamp();

    const files = message.attachments.map(a => a.url);
    await user.send({ embeds: [embed], files }).catch(() => {
      message.reply('Could not DM the user. They may have DMs disabled.');
    });
  }
});

// ==================== BUTTON HANDLER (close modmail) ====================
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith('modmail_close_')) return;

  const userId = interaction.customId.replace('modmail_close_', '');

  await interaction.reply({ content: 'Closing this modmail thread...', ephemeral: true });

  const user = await client.users.fetch(userId).catch(() => null);
  if (user) {
    const closedEmbed = new EmbedBuilder()
      .setTitle('ModMail Closed')
      .setDescription('This support thread has been closed by staff. Message us again to open a new one.')
      .setColor('Red')
      .setTimestamp();
    await user.send({ embeds: [closedEmbed] }).catch(() => {});
  }

  modmailThreads.delete(userId);

  if (interaction.channel && interaction.channel.isThread()) {
    await interaction.channel.setLocked(true).catch(() => {});
    await interaction.channel.setArchived(true).catch(() => {});
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
