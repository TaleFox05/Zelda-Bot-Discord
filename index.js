// Carga la librería 'dotenv' para leer el archivo .env (donde está el Token secreto)
require('dotenv').config();

// Importa las clases necesarias de discord.js
const { 
    Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder, 
    ActionRowBuilder, ButtonBuilder, ButtonStyle 
} = require('discord.js');
const fs = require('fs'); // Módulo para interactuar con el sistema de archivos (guardar JSON)
const path = require('path'); // Módulo para gestionar rutas de archivos

// =========================================================================
// === CONFIGURACIÓN Y DEFINICIONES ===
// =========================================================================

// Color del embed de listado para uniformidad (¡COLOR CORREGIDO a #427522!)
const LIST_EMBED_COLOR = '#427522'; 
// ID del rol de Administrador que puede usar los comandos de Staff
const ADMIN_ROLE_ID = "1420026299090731050"; 

// Tipos de Objeto válidos para validación en !Zcrearitem
const TIPOS_VALIDOS = ['moneda', 'objeto', 'keyitem']; 

// Ruta y lectura del archivo de datos (Base de datos de Items)
const DATA_FILE = path.resolve(__dirname, 'items.json');
let compendio = {}; 

// CONFIGURACIÓN DEL CLIENTE (EL BOT)
const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds,           
        GatewayIntentBits.GuildMessages,    
        GatewayIntentBits.MessageContent    
    ] 
});

// =========================================================================
// === FUNCIONES DE DATOS ===
// =========================================================================

// Función para cargar los items al inicio del bot
function cargarCompendio() {
    try {
        const data = fs.readFileSync(DATA_FILE, 'utf8');
        compendio = JSON.parse(data); 
    } catch (error) {
        console.log('Creando nuevo archivo de datos para items:', error.message);
        compendio = {};
    }
}

// Función para guardar los datos en el archivo JSON
function guardarCompendio() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(compendio, null, 4));
}

// =========================================================================
// === LÓGICA DE PAGINACIÓN ===
// =========================================================================

// Crea los botones de paginación
function createPaginationRow(currentPage, totalPages) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('first')
            .setLabel('⏮️ Primera')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentPage === 0),
        new ButtonBuilder()
            .setCustomId('prev')
            .setLabel('◀️ Anterior')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(currentPage === 0),
        new ButtonBuilder()
            .setCustomId('next')
            .setLabel('▶️ Siguiente')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(currentPage === totalPages - 1),
        new ButtonBuilder()
            .setCustomId('last')
            .setLabel('⏭️ Última')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentPage === totalPages - 1)
    );
}

// Genera el embed para una página específica
function createItemEmbedPage(items, pageIndex) {
    const ITEMS_PER_PAGE = 5;
    const start = pageIndex * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const itemsToShow = items.slice(start, end);
    const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);

    const embed = new EmbedBuilder()
        .setColor(LIST_EMBED_COLOR) 
        .setTitle('🏰 Compendio de Objetos de Nuevo Hyrule 🏰')
        .setDescription(`*Página ${pageIndex + 1} de ${totalPages}. Solo se muestran ${ITEMS_PER_PAGE} objetos por página.*`)
        .setFooter({ text: `Página ${pageIndex + 1} de ${totalPages} | Consultado vía Zelda BOT | Usa los botones para navegar.` });

    // Añade los campos para los items de la página
    itemsToShow.forEach(p => {
        embed.addFields({
            name: `**${p.nombre}**`,
            value: `**Descripción:** *${p.descripcion}*\n**Tipo:** ${p.tipo.toUpperCase()} | **Estado:** ${p.disponible ? 'Disponible' : 'En Posesión'}`,
            inline: false
        });
    });

    return { embed, totalPages };
}

// =========================================================================
// === EVENTOS DEL BOT ===
// =========================================================================

// Evento que se dispara cuando el bot se conecta a Discord
client.on('ready', () => {
    cargarCompendio(); 
    console.log(`¡Zelda BOT iniciado como ${client.user.tag}!`);
    client.user.setActivity('Registra los objetos del reino');
});

// Listener para la interacción con botones (la paginación)
client.on('interactionCreate', async interaction => {
    // Solo responde a interacciones de botones
    if (!interaction.isButton()) return;
    
    // Solo responde a interacciones con el ID de paginación
    if (!['first', 'prev', 'next', 'last'].includes(interaction.customId)) return;

    // Obtiene los datos de la lista y la página actual desde el footer
    const footerText = interaction.message.embeds[0].footer.text;
    const match = footerText.match(/Página (\d+) de (\d+)/);
    
    if (!match) return; // No es un embed de paginación

    const currentPage = parseInt(match[1]) - 1; // Ajuste a índice 0
    const items = Object.values(compendio);

    if (items.length === 0) return interaction.update({ content: 'El compendio está vacío.' });

    const ITEMS_PER_PAGE = 5;
    const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);
    let newPage = currentPage;

    // Lógica para cambiar de página
    switch (interaction.customId) {
        case 'first':
            newPage = 0;
            break;
        case 'prev':
            newPage = Math.max(0, currentPage - 1);
            break;
        case 'next':
            newPage = Math.min(totalPages - 1, currentPage + 1);
            break;
        case 'last':
            newPage = totalPages - 1;
            break;
    }

    // Genera el nuevo embed y actualiza el mensaje
    const { embed: newEmbed } = createItemEmbedPage(items, newPage);
    const newRow = createPaginationRow(newPage, totalPages);
    
    // Reemplaza el mensaje original con la nueva página y botones
    await interaction.update({ embeds: [newEmbed], components: [newRow] });
});

// Cuando alguien envía un mensaje (comandos)
client.on('messageCreate', message => {
    if (message.author.bot) return; 

    const prefix = '!Z'; 
    if (!message.content.startsWith(prefix)) return;

    const fullCommand = message.content.slice(prefix.length).trim();
    const args = fullCommand.split(/ +/);
    const command = args.shift().toLowerCase();
    
    // --- Comando: CREAR ITEM (RESTRICCIÓN POR ID DE ROL)
    if (command === 'crearitem') {
        // Verifica si el autor tiene el rol específico O si es un Administrador general
        if (!message.member.roles.cache.has(ADMIN_ROLE_ID) && !message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
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
        
        guardarCompendio();
        
        const embed = new EmbedBuilder()
            .setColor('#427522') 
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

    // --- Comando: VER OBJETO INDIVIDUAL 
    if (command === 'veritem') { 
        const regex = /"([^"]+)"/; 
        const match = fullCommand.match(regex);
        
        if (!match) {
            return message.reply('Uso: `!Zveritem "Nombre Completo del Objeto"`');
        }
        
        const nombreItem = match[1]; 
        const id = nombreItem.toLowerCase().replace(/ /g, '_');
        const item = compendio[id];

        if (!item) {
            return message.reply(`No se encontró ningún objeto llamado **${nombreItem}** en el Compendio.`);
        }

        const embed = new EmbedBuilder()
            .setColor('#427522') 
            .setTitle(item.nombre) 
            .addFields(
                { name: 'Descripción', value: item.descripcion, inline: false },
                { name: 'Tipo', value: item.tipo.toUpperCase(), inline: true },
                { name: 'Estado', value: item.disponible ? 'Disponible' : 'En Posesión', inline: true },
                { name: 'Fecha de Registro', value: item.fecha, inline: true }
            )
            .setImage(item.imagen)
            .setFooter({ text: `Registrado por: ${item.registradoPor}` });
        
        message.channel.send({ embeds: [embed] });
    }
    
    // --- Comando: LISTAR OBJETOS 
    if (command === 'listaritems') {
        const items = Object.values(compendio);
        
        if (items.length === 0) {
            return message.channel.send('***El Compendio de Objetos está vacío. ¡Que se registre el primer tesoro!***');
        }

        const currentPage = 0;
        const { embed, totalPages } = createItemEmbedPage(items, currentPage);
        const row = createPaginationRow(currentPage, totalPages);
        
        message.channel.send({ embeds: [embed], components: [row] });
    }
});

client.login(process.env.DISCORD_TOKEN);