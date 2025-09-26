// Carga la librería 'dotenv' para leer el archivo .env (donde está el Token secreto)
require('dotenv').config();

// Importa las clases necesarias de discord.js
const { 
    Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder, 
    ActionRowBuilder, ButtonBuilder, ButtonStyle 
} = require('discord.js');
const fs = require('fs'); // Módulo para interactuar con el sistema de archivos
const path = require('path'); // Módulo para gestionar rutas de archivos

// =========================================================================
// === CONFIGURACIÓN BASE ===
// =========================================================================

// ID del rol de Administrador que puede usar los comandos de Staff
const ADMIN_ROLE_ID = "1420026299090731050"; 
const PREFIX = '!Z'; 
const LIST_EMBED_COLOR = '#427522'; 
const TIPOS_VALIDOS = ['moneda', 'objeto', 'keyitem']; 

// CONFIGURACIÓN DEL CLIENTE (EL BOT)
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,           
        GatewayIntentBits.GuildMessages,    
        GatewayIntentBits.MessageContent    
    ] 
});

// =========================================================================
// === ESTRUCTURA DE DATOS Y PERSISTENCIA ===
// =========================================================================

const ITEMS_DATA_FILE = path.resolve(__dirname, 'items.json');
let compendio = {}; 

function cargarCompendio() {
    try {
        const data = fs.readFileSync(ITEMS_DATA_FILE, 'utf8');
        compendio = JSON.parse(data); 
        console.log(`[PERSISTENCIA] Items cargados: ${Object.keys(compendio).length}`);
    } catch (error) {
        // 'ENOENT' es el código de error para "File Not Found" (archivo no encontrado)
        if (error.code === 'ENOENT') {
            console.log(`[PERSISTENCIA] items.json no encontrado. Creando nuevo archivo...`);
            compendio = {};
            // Intenta guardar el objeto vacío para crear el archivo
            guardarCompendio(); 
        } else {
             console.error(`[ERROR] Fallo al cargar items.json: ${error.message}`);
        }
    }
}

function guardarCompendio() {
    try {
        // Usamos JSON.stringify(..., null, 4) para un formato legible
        fs.writeFileSync(ITEMS_DATA_FILE, JSON.stringify(compendio, null, 4));
        console.log('✅ [PERSISTENCIA] Compendio de Items guardado correctamente.');
    } catch (error) {
        // Capturamos cualquier error, siendo el más común el de permisos (EACCES)
        console.error(`❌ [ERROR CRÍTICO DE PERSISTENCIA] No se pudo guardar items.json.`);
        console.error(`Ruta intentada: ${ITEMS_DATA_FILE}`);
        console.error(`Mensaje de error del sistema: ${error.message}`);
    }
}

// =========================================================================
// === EVENTOS DEL BOT ===
// =========================================================================

client.on('ready', () => {
    cargarCompendio(); // Carga los datos al iniciar
    console.log(`¡Zelda BOT iniciado como ${client.user.tag}!`);
    client.user.setActivity('Reiniciando la base de datos');
});

client.on('messageCreate', async message => {
    if (message.author.bot) return; 

    if (!message.content.startsWith(PREFIX)) return;

    const fullCommand = message.content.slice(PREFIX.length).trim();
    const args = fullCommand.split(/ +/);
    const command = args.shift().toLowerCase();
    
    const hasAdminPerms = message.member.roles.cache.has(ADMIN_ROLE_ID) || message.member.permissions.has(PermissionsBitField.Flags.Administrator);

    
    // --- COMANDO: HELP ---
    if (command === '-help') {
        const helpEmbed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('📖 Guía de Comandos Base')
            .setDescription('Estamos re-implementando la base de datos. Solo la creación de ítems está activa.')
            .addFields({
                name: 'Comandos disponibles',
                value: `\`!Zcrearitem "Nombre" "Descripción" "Tipo" "URL"\`: Registra un nuevo objeto. (Staff)\n\`!Z-help\`: Muestra esta guía.`,
                inline: false
            })
            .setFooter({ text: 'Prefijo: !Z' });
        
        return message.channel.send({ embeds: [helpEmbed] });
    }
    
    // --- COMANDO: CREAR ITEM (Staff) ---
    if (command === 'crearitem') {
        if (!hasAdminPerms) {
            return message.reply('¡Alto ahí! Solo los **Administradores Canon** pueden registrar objetos mágicos.');
        }
        
        const regex = /"([^"]+)"/g;
        const matches = [...message.content.matchAll(regex)];

        if (matches.length < 4) {
            return message.reply('Sintaxis incorrecta. Uso: `!Zcrearitem "Nombre" "Descripción" "Tipo (moneda/objeto/keyitem)" "URL de Imagen"`');
        }

        const nombre = matches[0][1];
        const descripcion = matches[1][1];
        const tipo = matches[2][1].toLowerCase();
        const imagenUrl = matches[3][1];
        
        if (!TIPOS_VALIDOS.includes(tipo)) {
            return message.reply(`El tipo de objeto debe ser uno de estos: ${TIPOS_VALIDOS.join(', ')}.`);
        }

        const id = nombre.toLowerCase().replace(/ /g, '_');

        if (compendio[id]) {
            return message.reply(`¡El objeto **${nombre}** ya está registrado!`);
        }

        compendio[id] = {
            nombre: nombre,
            descripcion: descripcion,
            tipo: tipo,
            disponible: true, 
            imagen: imagenUrl,
            registradoPor: message.author.tag,
            fecha: new Date().toLocaleDateString('es-ES')
        };
        
        guardarCompendio(); // <-- ¡Llamada crucial para guardar el JSON!
        
        const embed = new EmbedBuilder()
            .setColor(LIST_EMBED_COLOR) 
            .setTitle(`✅ Objeto Registrado: ${nombre}`)
            .setDescription(`Un nuevo artefacto ha sido añadido al Compendio de Hyrule.`)
            .addFields(
                { name: 'Descripción', value: descripcion, inline: false },
                { name: 'Tipo', value: tipo.toUpperCase(), inline: true },
                { name: 'Estado', value: 'Disponible', inline: true }
            )
            .setImage(imagenUrl)
            .setFooter({ text: `Registrado por: ${message.author.tag}` });
        
        message.channel.send({ embeds: [embed] });
    }
    
    // Aquí implementaremos los comandos de listar objetos, enemigos, etc.
});

client.login(process.env.DISCORD_TOKEN);