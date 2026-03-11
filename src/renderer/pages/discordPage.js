import { $ } from '../helpers.js';
import { DISCORD_INVITE } from '../data/discord.js';

export function setupDiscordPage() {
  $('discord-join-btn').addEventListener('click', () => {
    window.launcher.openExternal(DISCORD_INVITE);
  });
}
