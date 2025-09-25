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

// Color del embed de listado para uniformidad
const LIST_EMBED_COLOR = '#427522'; 
// ID del rol de Administrador que puede usar los comandos de Staff
const ADMIN_ROLE_ID = "1420026299090731050"; 

// Palabras clave para la gestión
const CANCEL_EDIT_WORD = '!cancelar'; 
const TIPOS_VALIDOS = ['moneda', 'objeto', 'keyitem']; 

// Almacén temporal para la edición. Guarda el ID del usuario y el ID del objeto que está editando.
const edicionActiva = {};

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

function cargarCompendio() {
    try {
        const data = fs.readFileSync(DATA_FILE, 'utf8');
        compendio = JSON.parse(data); 
    } catch (error) {
        console.log('Creando nuevo archivo de datos para items:', error.message);
        compendio = {};
    }
}

function guardarCompendio() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(compendio, null, 4));
}

// =========================================================================
// === LÓGICA DE PAGINACIÓN ===
// =========================================================================

// Crea los botones de paginación (Texto ELIMINADO)
function createPaginationRow(currentPage, totalPages) {
    // NOTA: Esta función DEBE devolver UN SOLO ActionRowBuilder.
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('first')
            .setEmoji('⏮️') 
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentPage === 0),
        new ButtonBuilder()
            .setCustomId('prev')
            .setEmoji('◀️') 
            .setStyle(ButtonStyle.Primary)
            .setDisabled(currentPage === 0),
        new ButtonBuilder()
            .setCustomId('next')
            .setEmoji('▶️') 
            .setStyle(ButtonStyle.Primary)
            .setDisabled(currentPage === totalPages - 1),
        new ButtonBuilder()
            .setCustomId('last')
            .setEmoji('⏭️') 
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentPage === totalPages - 1)
    );
}

// Genera el embed para una página específica (SIN CAMBIOS)
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
// === LÓGICA DE EDICIÓN ===
// =========================================================================

// Crea los botones para seleccionar qué campo editar
function createEditButtons(itemId) {
    // Fila 1: Opciones de Edición
    const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`edit_nombre_${itemId}`)
            .setLabel('✏️ Nombre')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`edit_descripcion_${itemId}`)
            .setLabel('📖 Descripción')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`edit_tipo_${itemId}`)
            .setLabel('🏷️ Tipo')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`edit_imagen_${itemId}`)
            .setLabel('🖼️ Imagen URL')
            .setStyle(ButtonStyle.Secondary)
    );

    // Fila 2: Botón de Cancelación 
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`edit_cancel_${itemId}`)
            .setLabel('Cancelar Edición')
            .setStyle(ButtonStyle.Danger)
    );

    return [row1, row2]; // Devuelve ambas filas
}

// Genera el embed de confirmación y selección de campo
function createEditSelectionEmbed(item) {
    return new EmbedBuilder()
        .setColor(LIST_EMBED_COLOR)
        .setTitle(`🛠️ Editando: ${item.nombre}`)
        .setDescription(`Selecciona qué campo deseas modificar para el objeto **${item.nombre}**.\n\n*Elige uno de los botones de abajo o **Cancelar Edición**.*`)
        .addFields(
            { name: 'Descripción Actual', value: item.descripcion.substring(0, 100) + (item.descripcion.length > 100 ? '...' : ''), inline: false },
            { name: 'Tipo Actual', value: item.tipo.toUpperCase(), inline: true },
            { name: 'Imagen Actual', value: item.imagen, inline: true }
        )
        .setThumbnail(item.imagen);
}


// =========================================================================
// === EVENTOS DEL BOT ===
// =========================================================================

client.on('ready', () => {
    cargarCompendio(); 
    console.log(`¡Zelda BOT iniciado como ${client.user.tag}!`);
    client.user.setActivity('Registra los objetos del reino');
});

// Listener para interacciones: Paginación y Edición
client.on('interactionCreate', async interaction => {
    // 1. Lógica de Paginación (Botones first, prev, next, last)
    if (interaction.isButton() && ['first', 'prev', 'next', 'last'].includes(interaction.customId)) {
        // ... (Lógica de paginación existente)
        const footerText = interaction.message.embeds[0].footer.text;
        const match = footerText.match(/Página (\d+) de (\d+)/);
        
        if (!match) return; 

        const currentPage = parseInt(match[1]) - 1; 
        const items = Object.values(compendio);

        if (items.length === 0) return interaction.update({ content: 'El compendio está vacío.' });

        const ITEMS_PER_PAGE = 5;
        const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);
        let newPage = currentPage;

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

        const { embed: newEmbed } = createItemEmbedPage(items, newPage);
        const newRow = createPaginationRow(newPage, totalPages);
        
        // CORRECCIÓN: Pasamos el ActionRowBuilder dentro de un array
        await interaction.update({ embeds: [newEmbed], components: [newRow] }); 
        return; 
    }
    
    // 2. Lógica de Edición (Botones edit_...)
    if (interaction.isButton() && interaction.customId.startsWith('edit_')) {
        // Verificación de Staff (seguridad)
        if (!interaction.member.roles.cache.has(ADMIN_ROLE_ID) && !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: '¡Solo los Administradores Canon pueden usar las herramientas de edición!', ephemeral: true });
        }
        
        const parts = interaction.customId.split('_');
        const campo = parts[1];
        const itemId = parts[2]; // Capturamos el ID del item
        const item = compendio[itemId];
        
        // CORRECCIÓN: Verificamos si el item existe ANTES de hacer el deferReply.
        if (!item) {
            return interaction.reply({ content: 'El objeto que intentas editar ya no existe o el ID es incorrecto.', ephemeral: true });
        }

        // 2a. CANCELAR EDICIÓN (NUEVO)
        if (campo === 'cancel') {
            await interaction.update({ 
                content: `❌ Edición de **${item.nombre}** cancelada por el Staff.`,
                embeds: [],
                components: []
            });
            return;
        }

        // 2b. LÓGICA PARA SELECCIÓN DE CAMPO
        await interaction.deferReply({ ephemeral: true });
        
        let prompt;
        if (campo === 'tipo') {
            prompt = `Has elegido editar el **TIPO**.\n\n**Escribe el nuevo valor:**\nDebe ser uno de estos: \`${TIPOS_VALIDOS.join(', ')}\`\n\n*Para cancelar, escribe \`${CANCEL_EDIT_WORD}\`.*`;
        } else if (campo === 'imagen') {
             prompt = `Has elegido editar la **IMAGEN URL**.\n\n**Escribe la nueva URL** (debe empezar por http/https):\n\n*Para cancelar, escribe \`${CANCEL_EDIT_WORD}\`.*`;
        } else {
            prompt = `Has elegido editar el **${campo.toUpperCase()}**.\n\n**Escribe el nuevo valor:**\n\n*Para cancelar, escribe \`${CANCEL_EDIT_WORD}\`.*`;
        }
        
        // 2c. Almacenar el estado de edición del usuario
        edicionActiva[interaction.user.id] = { 
            itemId: itemId, 
            campo: campo,
            channelId: interaction.channelId
        };

        // 2d. Enviar el prompt al usuario
        await interaction.followUp({ 
            content: prompt, 
            ephemeral: true 
        });
        
        // Opcional: Eliminar los botones del mensaje original para evitar clics dobles
        // Dejamos el mensaje como estaba para no confundir al resto.
    }
});

// Listener para Mensajes (Comandos y Respuestas de Edición)
client.on('messageCreate', async message => {
    if (message.author.bot) return; 

    // 1. Lógica de Respuesta de Edición (Debe ir antes de la lógica de comandos)
    const userId = message.author.id;
    if (edicionActiva[userId] && edicionActiva[userId].channelId === message.channelId) {
        
        const { itemId, campo } = edicionActiva[userId];
        const item = compendio[itemId];
        const nuevoValor = message.content.trim();

        // **LÓGICA DE CANCELACIÓN POR MENSAJE**
        if (nuevoValor.toLowerCase() === CANCEL_EDIT_WORD) {
            delete edicionActiva[userId]; // Limpia el estado
            return message.reply(`❌ Proceso de edición de **${item ? item.nombre : 'item'}** cancelado por el Staff.`);
        }
        
        // Verificación de Staff (seguridad)
        if (!message.member.roles.cache.has(ADMIN_ROLE_ID) && !message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            delete edicionActiva[userId];
            return message.reply({ content: 'No tienes permiso para responder a esta solicitud de edición.', ephemeral: true });
        }
        
        if (!item) {
            delete edicionActiva[userId];
            return message.reply(`Error: El objeto con ID ${itemId} ya no existe.`);
        }

        // Validación de TIPO
        if (campo === 'tipo' && !TIPOS_VALIDOS.includes(nuevoValor.toLowerCase())) {
            return message.reply(`⚠️ **Valor Inválido:** El nuevo tipo debe ser uno de estos: \`${TIPOS_VALIDOS.join(', ')}\`. Inténtalo de nuevo en este mismo canal.`);
        }
        
        // 1a. Si el nombre se cambia, la clave del objeto debe cambiar (ID)
        let nombreItemOriginal = item.nombre;
        let nuevoItemId = itemId;

        if (campo === 'nombre') {
            nuevoItemId = nuevoValor.toLowerCase().replace(/ /g, '_');
            
            if (compendio[nuevoItemId] && nuevoItemId !== itemId) {
                return message.reply(`⚠️ **Nombre Existente:** Ya hay un objeto con el nombre **${nuevoValor}**. Usa un nombre diferente.`);
            }
            
            item.nombre = nuevoValor;
            compendio[nuevoItemId] = { ...item };
            delete compendio[itemId];
            
        } else {
            // 1b. Actualiza el campo directamente
            item[campo] = nuevoValor;
        }

        guardarCompendio();
        delete edicionActiva[userId]; // Limpia el estado

        const confirmEmbed = new EmbedBuilder()
            .setColor(LIST_EMBED_COLOR)
            .setTitle(`✅ Edición Completa`)
            .setDescription(`El campo **${campo.toUpperCase()}** de **${item.nombre}** ha sido actualizado.`)
            .addFields(
                { name: `Nuevo Valor de ${campo.toUpperCase()}`, value: nuevoValor, inline: false }
            )
            .setThumbnail(item.imagen);
        
        message.reply({ embeds: [confirmEmbed] });
        
        return; // Sale del evento messageCreate
    }
    
    // 2. Lógica de Comandos (Comandos que inician con !Z)
    const prefix = '!Z'; 
    if (!message.content.startsWith(prefix)) return;

    const fullCommand = message.content.slice(prefix.length).trim();
    const args = fullCommand.split(/ +/);
    const command = args.shift().toLowerCase();
    
    const hasAdminPerms = message.member.roles.cache.has(ADMIN_ROLE_ID) || message.member.permissions.has(PermissionsBitField.Flags.Administrator);

    
    // --- NUEVO COMANDO: HELP ---
    if (command === '-help') {
        const helpEmbed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('📖 Guía de Comandos del Zelda BOT')
            .setDescription('Aquí puedes consultar todos los comandos disponibles, diferenciando por el nivel de acceso.')
            .addFields(
                // Sección de Comandos de Staff
                {
                    name: '🛠️ Comandos de Administración (Solo Staff)',
                    value: [
                        `\`!Zcrearitem "Nombre" "Desc" "Tipo" "URL"\`: Registra un nuevo objeto en el compendio.`,
                        `\`!Zeliminaritem "Nombre"\`: Borra un objeto del compendio permanentemente.`,
                        `\`!Zeditaritem "Nombre"\`: Inicia el menú interactivo para modificar los datos (nombre, tipo, etc.) de un objeto existente.`,
                        `*Comandos de edición en curso pueden cancelarse escribiendo \`${CANCEL_EDIT_WORD}\`*`
                    ].join('\n'),
                    inline: false
                },
                
                // Sección de Comandos Públicos (Para futuros comandos de roleplay)
                {
                    name: '🌎 Comandos de Consulta (Público)',
                    value: [
                        `\`!Zlistaritems\`: Muestra el compendio completo en una lista paginada.`,
                        `\`!Zveritem "Nombre"\`: Muestra la ficha detallada de un objeto específico.`,
                        `\`!Z-help\`: Muestra esta guía de comandos.`
                    ].join('\n'),
                    inline: false
                }
            )
            .setFooter({ text: 'Desarrollado para el Rol de Nuevo Hyrule | Prefijo: !Z' });
        
        return message.channel.send({ embeds: [helpEmbed] });
    }
    
    // --- Comando: CREAR ITEM (Mantenido)
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
        
        guardarCompendio();
        
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
    
    // --- Comando: ELIMINAR ITEM (Mantenido)
    if (command === 'eliminaritem') {
        if (!hasAdminPerms) {
            return message.reply('¡Alto ahí! Solo los **Administradores Canon** pueden eliminar objetos.');
        }
        
        const regex = /"([^"]+)"/; 
        const match = fullCommand.match(regex);
        
        if (!match) {
            return message.reply('Uso: `!Zeliminaritem "Nombre Completo del Objeto"`');
        }
        
        const nombreItem = match[1]; 
        const id = nombreItem.toLowerCase().replace(/ /g, '_');
        
        if (!compendio[id]) {
            return message.reply(`No se encontró ningún objeto llamado **${nombreItem}** en el Compendio.`);
        }
        
        const itemEliminado = compendio[id];
        delete compendio[id];
        guardarCompendio();

        const embed = new EmbedBuilder()
            .setColor('#cc0000') 
            .setTitle(`🗑️ Objeto Eliminado: ${itemEliminado.nombre}`)
            .setDescription(`El objeto **${itemEliminado.nombre}** ha sido borrado permanentemente del Compendio de Nuevo Hyrule.`);
        
        message.channel.send({ embeds: [embed] });
    }

    // --- Comando: EDITAR ITEM (CORRECCIÓN en components)
    if (command === 'editaritem') {
        if (!hasAdminPerms) {
            return message.reply('¡Alto ahí! Solo los **Administradores Canon** pueden editar objetos.');
        }

        const regex = /"([^"]+)"/; 
        const match = fullCommand.match(regex);
        
        if (!match) {
            return message.reply('Uso: `!Zeditaritem "Nombre Completo del Objeto"`');
        }
        
        const nombreItem = match[1]; 
        const itemId = nombreItem.toLowerCase().replace(/ /g, '_');
        const item = compendio[itemId];

        if (!item) {
            return message.reply(`No se encontró ningún objeto llamado **${nombreItem}** para editar.`);
        }
        
        // Iniciar el proceso de edición con el embed y los botones
        const embed = createEditSelectionEmbed(item);
        const rows = createEditButtons(itemId); // Retorna [row1, row2]
        
        // CORRECCIÓN CLAVE: Pasamos el array de filas de botones (rows)
        message.channel.send({ embeds: [embed], components: rows });
    }

    // --- Comando: VER OBJETO INDIVIDUAL (Mantenido)
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
            .setColor(LIST_EMBED_COLOR) 
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
    
    // --- Comando: LISTAR OBJETOS (Mantenido)
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