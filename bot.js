// ============================================
// DISCORD TO ROBLOX VERIFICATION BOT
// ONE-TIME VERIFICATION SYSTEM
// ============================================

const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes } = require('discord.js');
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

const app = express();
app.use(express.json());

// Store verification codes (temporary)
const verificationCodes = new Map();

// Store verified users (permanent - in production use database)
const VERIFIED_FILE = 'verified_users.json';
let verifiedUsers = new Map();

// Load verified users from file
if (fs.existsSync(VERIFIED_FILE)) {
    const data = JSON.parse(fs.readFileSync(VERIFIED_FILE, 'utf8'));
    verifiedUsers = new Map(Object.entries(data));
    console.log(`📁 Loaded ${verifiedUsers.size} verified users from database`);
}

// Save verified users to file
function saveVerifiedUsers() {
    const data = Object.fromEntries(verifiedUsers);
    fs.writeFileSync(VERIFIED_FILE, JSON.stringify(data, null, 2));
}

// ✅ GANTI INI DENGAN DATA KAMU!
const DISCORD_TOKEN = 'MTQ2MDI0OTU4MDg3MTYxODczMw.GJ7DJz.FM9oCjwEsASo4aa8v_p_KpX3BoEf1sJn-sSWio';
const CLIENT_ID = '1460249580871618733';
const GUILD_ID = '1460113407599710345';
const VERIFIED_ROLE_ID = '1460255823690469471';

// Generate random verification code
function generateCode() {
    return crypto.randomBytes(3).toString('hex').toUpperCase();
}

// Slash command: /verify
const commands = [
    new SlashCommandBuilder()
        .setName('verify')
        .setDescription('Link your Roblox account to Discord (one-time only)')
        .toJSON()
];

// Register slash commands
const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
(async () => {
    try {
        console.log('🔄 Registering slash commands...');
        await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
        console.log('✅ Slash commands registered!');
    } catch (error) {
        console.error('❌ Error registering commands:', error);
    }
})();

client.on('ready', () => {
    console.log(`✅ Bot logged in as ${client.user.tag}`);
    console.log(`📊 Total verified users: ${verifiedUsers.size}`);
});

// Handle /verify command
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    if (interaction.commandName === 'verify') {
        const userId = interaction.user.id;

        // ✅ CHECK IF ALREADY VERIFIED (PERMANENT)
        if (verifiedUsers.has(userId)) {
            const userData = JSON.parse(verifiedUsers.get(userId));
            await interaction.reply({
                content: `✅ **You are already verified!**\n\n` +
                         `🎮 Roblox: **${userData.robloxUsername}**\n` +
                         `📅 Verified: <t:${Math.floor(userData.verifiedAt / 1000)}:R>\n\n` +
                         `⚠️ Each Discord account can only verify once.`,
                ephemeral: true
            });
            console.log(`⚠️ ${interaction.user.username} tried to verify again (already verified)`);
            return;
        }

        // ✅ CHECK IF PENDING CODE EXISTS
        let existingCode = null;
        for (const [code, data] of verificationCodes.entries()) {
            if (data.discordId === userId) {
                existingCode = code;
                break;
            }
        }

        if (existingCode) {
            // User already has pending code
            await interaction.reply({
                content: `🔑 **Your Verification Code:** \`${existingCode}\`\n\n` +
                         `📌 You already have an active code.\n` +
                         `💡 Enter this code in the Roblox game within 10 minutes.\n` +
                         `⚠️ This code can only be used once.`,
                ephemeral: true
            });
            console.log(`ℹ️ ${interaction.user.username} requested code again: ${existingCode}`);
            return;
        }

        // Generate new code
        const code = generateCode();
        verificationCodes.set(code, {
            discordId: userId,
            username: interaction.user.username,
            timestamp: Date.now()
        });

        // Auto-expire after 10 minutes
        setTimeout(() => {
            if (verificationCodes.has(code)) {
                verificationCodes.delete(code);
                console.log(`⏱️ Code ${code} expired`);
            }
        }, 10 * 60 * 1000);

        await interaction.reply({
            content: `🔑 **Your Verification Code:** \`${code}\`\n\n` +
                     `📌 Enter this code in the Roblox game within **10 minutes**.\n` +
                     `💡 Open the "Discord Verify" GUI in game and paste this code.\n` +
                     `🎁 Reward: **1000 Money** after verification!\n\n` +
                     `⚠️ This code can only be used once and will expire in 10 minutes.`,
            ephemeral: true
        });

        console.log(`🔑 Generated code ${code} for ${interaction.user.username} (${userId})`);
    }
});

// API endpoint for Roblox to verify code
app.post('/verify', async (req, res) => {
    const { code, robloxUserId, robloxUsername } = req.body;

    console.log(`📥 Verify request: Code=${code}, RobloxUser=${robloxUsername} (${robloxUserId})`);

    if (!code || !robloxUserId || !robloxUsername) {
        return res.status(400).json({ success: false, error: 'Missing parameters' });
    }

    // ✅ CHECK IF CODE EXISTS
    if (!verificationCodes.has(code)) {
        console.log(`❌ Invalid or expired code: ${code}`);
        return res.json({ success: false, error: 'Invalid or expired code' });
    }

    const verifyData = verificationCodes.get(code);
    const discordId = verifyData.discordId;

    // ✅ CHECK IF DISCORD ALREADY VERIFIED
    if (verifiedUsers.has(discordId)) {
        verificationCodes.delete(code);
        console.log(`❌ Discord user already verified: ${discordId}`);
        return res.json({ success: false, error: 'This Discord account is already verified' });
    }

    // ✅ CHECK IF ROBLOX ALREADY VERIFIED
    for (const [id, dataStr] of verifiedUsers.entries()) {
        const data = JSON.parse(dataStr);
        if (data.robloxUserId === robloxUserId) {
            verificationCodes.delete(code);
            console.log(`❌ Roblox account already verified: ${robloxUsername}`);
            return res.json({ success: false, error: 'This Roblox account is already verified' });
        }
    }

    try {
        // Get Discord guild and member
        const guild = await client.guilds.fetch(GUILD_ID);
        const member = await guild.members.fetch(discordId);

        // Add verified role
        await member.roles.add(VERIFIED_ROLE_ID);

        // ✅ SAVE VERIFICATION (PERMANENT)
        const verificationData = {
            robloxUserId: robloxUserId,
            robloxUsername: robloxUsername,
            discordUsername: verifyData.username,
            verifiedAt: Date.now()
        };

        verifiedUsers.set(discordId, JSON.stringify(verificationData));
        saveVerifiedUsers(); // Save to file

        // Remove used code
        verificationCodes.delete(code);

        console.log(`✅ VERIFIED: ${robloxUsername} (${robloxUserId}) ↔ ${verifyData.username} (${discordId})`);

        res.json({
            success: true,
            discordUsername: verifyData.username,
            reward: 1000
        });

    } catch (error) {
        console.error('❌ Verification error:', error);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

// Check if Discord user is verified
app.get('/check/discord/:discordId', (req, res) => {
    const discordId = req.params.discordId;
    const verified = verifiedUsers.has(discordId);
    
    res.json({ 
        verified: verified,
        data: verified ? JSON.parse(verifiedUsers.get(discordId)) : null
    });
});

// Check if Roblox user is verified
app.get('/check/roblox/:robloxUserId', (req, res) => {
    const robloxUserId = parseInt(req.params.robloxUserId);
    
    for (const [discordId, dataStr] of verifiedUsers.entries()) {
        const data = JSON.parse(dataStr);
        if (data.robloxUserId === robloxUserId) {
            return res.json({ verified: true, data: data });
        }
    }
    
    res.json({ verified: false, data: null });
});

// Health check
app.get('/', (req, res) => {
    res.json({ 
        status: 'online',
        verified_users: verifiedUsers.size,
        pending_codes: verificationCodes.size
    });
});

// Start Express server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`✅ API server running on http://localhost:${PORT}`);
});

// Start Discord bot
client.login(DISCORD_TOKEN);
