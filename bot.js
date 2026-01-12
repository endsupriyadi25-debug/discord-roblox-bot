// ============================================
// DISCORD TO ROBLOX VERIFICATION BOT
// ONE-TIME VERIFICATION SYSTEM
// ============================================

const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes } = require('discord.js');
const express = require('express');
const bodyParser = require('body-parser');
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
    const data = fs.readFileSync(VERIFIED_FILE, 'utf8');
    verifiedUsers = new Map(Object.entries(JSON.parse(data)));
    console.log(`✅ Loaded ${verifiedUsers.size} verified users from database`);
}

// Save verified users to file
function saveVerifiedUsers() {
    const obj = Object.fromEntries(verifiedUsers);
    fs.writeFileSync(VERIFIED_FILE, JSON.stringify(obj, null, 2));
}

// ✅ ENVIRONMENT VARIABLES - Railway akan inject values dari Variables tab
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const VERIFIED_ROLE_ID = process.env.VERIFIED_ROLE_ID;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;

// Generate random verification code
function generateCode() {
    return crypto.randomBytes(4).toString('hex').toUpperCase();
}

// Slash command: /verify
const commands = [
    new SlashCommandBuilder()
        .setName('verify')
        .setDescription('Link your Roblox account to Discord')
        .addStringOption(option =>
            option.setName('username')
                .setDescription('Your Roblox username')
                .setRequired(true)
        )
].map(command => command.toJSON());

// Register commands
const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
(async () => {
    try {
        console.log('🔄 Registering slash commands...');
        await rest.put(
            Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
            { body: commands }
        );
        console.log('✅ Slash commands registered!');
    } catch (error) {
        console.error('❌ Error registering commands:', error);
    }
})();

// Discord bot ready
client.once('ready', () => {
    console.log(`✅ Discord bot logged in as ${client.user.tag}`);
});

// Handle /verify command
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    
    if (interaction.commandName === 'verify') {
        const robloxUsername = interaction.options.getString('username');
        const discordId = interaction.user.id;
        
        // Check if already verified
        if (verifiedUsers.has(discordId)) {
            return interaction.reply({
                content: `❌ You are already verified as **${verifiedUsers.get(discordId)}**!`,
                ephemeral: true
            });
        }
        
        // Generate verification code
        const code = generateCode();
        verificationCodes.set(discordId, {
            code: code,
            robloxUsername: robloxUsername,
            timestamp: Date.now()
        });
        
        // Send verification instructions
        await interaction.reply({
            content: `✅ **Verification Started!**\n\n` +
                     `🎮 Roblox Username: **${robloxUsername}**\n` +
                     `🔐 Your Verification Code: \`${code}\`\n\n` +
                     `📋 **Instructions:**\n` +
                     `1. Join our Roblox game\n` +
                     `2. Look for the verification terminal\n` +
                     `3. Enter this code: \`${code}\`\n` +
                     `4. Click "Verify"\n\n` +
                     `⏰ Code expires in 10 minutes!`,
            ephemeral: true
        });
        
        // Auto-delete code after 10 minutes
        setTimeout(() => {
            verificationCodes.delete(discordId);
        }, 10 * 60 * 1000);
    }
});

// ============================================
// ROBLOX GAME API ENDPOINT
// ============================================

// Endpoint: Roblox game checks verification code
app.post('/verify', (req, res) => {
    const { discordId, code } = req.body;
    
    if (!discordId || !code) {
        return res.json({ success: false, message: 'Missing discordId or code' });
    }
    
    const verification = verificationCodes.get(discordId);
    
    if (!verification) {
        return res.json({ success: false, message: 'No verification request found' });
    }
    
    if (verification.code !== code.toUpperCase()) {
        return res.json({ success: false, message: 'Invalid code' });
    }
    
    // Code is valid - grant verified role
    const guild = client.guilds.cache.get(GUILD_ID);
    if (!guild) {
        return res.json({ success: false, message: 'Guild not found' });
    }
    
    guild.members.fetch(discordId)
        .then(member => {
            member.roles.add(VERIFIED_ROLE_ID)
                .then(() => {
                    // Save to permanent verified users
                    verifiedUsers.set(discordId, verification.robloxUsername);
                    saveVerifiedUsers();
                    verificationCodes.delete(discordId);
                    
                    console.log(`✅ Verified: ${verification.robloxUsername} (${discordId})`);
                    res.json({
                        success: true,
                        message: 'Verification successful!',
                        robloxUsername: verification.robloxUsername
                    });
                })
                .catch(err => {
                    console.error('❌ Error adding role:', err);
                    res.json({ success: false, message: 'Failed to add role' });
                });
        })
        .catch(err => {
            console.error('❌ Member not found:', err);
            res.json({ success: false, message: 'Member not found in server' });
        });
});

// Endpoint: Check if Discord user is already verified
app.get('/check/:discordId', (req, res) => {
    const discordId = req.params.discordId;
    const isVerified = verifiedUsers.has(discordId);
    
    res.json({
        verified: isVerified,
        robloxUsername: isVerified ? verifiedUsers.get(discordId) : null
    });
});

// Health check
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        bot: client.user ? client.user.tag : 'not ready',
        verifiedUsers: verifiedUsers.size,
        pendingVerifications: verificationCodes.size
    });
});

// Start Express server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Express server running on port ${PORT}`);
});

// Login to Discord
client.login(DISCORD_TOKEN);
