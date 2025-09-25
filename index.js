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

// COLORES DE EMBEDS
const LIST_EMBED_COLOR = '#427522';       // Compendio y General
const ENEMY_EMBED_COLOR = '#E82A2A';      // Enemigos (Rojo)
const TREASURE_EMBED_COLOR = '#F0C726';   // Cofres (Oro)

// ID del rol de Administrador que puede usar los comandos de Staff
const ADMIN_ROLE_ID = "1420026299090731050"; 

// Palabras clave para la gestión
const CANCEL_EDIT_WORD = '!cancelar'; 
const TIPOS_VALIDOS = ['moneda', 'objeto', 'keyitem']; 

// DEFINICIÓN DE COFRES (Con imágenes de ejemplo)
const CHEST_TYPES = {
    pequeño: { 
        nombre: 'Cofre Pequeño', 
        img: 'https://i.imgur.com/k2gYQ0p.png'
    },
    grande: { 
        nombre: 'Cofre de Mazmorra', 
        img: 'https://i.imgur.com/5Xh3M8w.png'
    },
    jefe: { 
        nombre: 'Cofre de Llave Maestra', 
        img: 'https://i.imgur.com/7YV6c8g.png'
    }
};

// Almacén temporal para la edición. Guarda el ID del usuario y el ID del objeto que está editando.
const edicionActiva = {};
// Almacén para encuentros activos (spawn del enemigo)
const encuentrosActivos = {}; // { channelId: { enemigoId: '...', cantidad: 2, mensajeId: '...' } }

// --- ESTRUCTURA DE DATOS ---
const ITEMS_DATA_FILE = path.resolve(__dirname, 'items.json');
const ENEMIES_DATA_FILE = path.resolve(__dirname, 'enemies.json');
let compendio = {}; 
let enemigosBase = {}; 

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
        const data = fs.readFileSync(ITEMS_DATA_FILE, 'utf8');
        compendio = JSON.parse(data); 
    } catch (error) {
        console.log('Creando nuevo archivo de datos para items:', error.message);
        compendio = {};
    }
}

function guardarCompendio() {
    fs.writeFileSync(ITEMS_DATA_FILE, JSON.stringify(compendio, null, 4));
}

function cargarEnemigosBase() {
    try {
        const data = fs.readFileSync(ENEMIES_DATA_FILE, 'utf8');
        enemigosBase = JSON.parse(data); 
    } catch (error) {
        console.log('Creando nuevo archivo de datos para enemigos:', error.message);
        enemigosBase = {};
    }
}

function guardarEnemigosBase() {
    fs.writeFileSync(ENEMIES_DATA_FILE, JSON.stringify(enemigosBase, null, 4));
}


// =========================================================================
// === LÓGICA DE PAGINACIÓN / EDICIÓN (SIN CAMBIOS) ===
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

// Crea los botones para seleccionar qué campo editar
function createEditButtons(itemId) {
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
    const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`edit_cancel_${itemId}`)
            .setLabel('❌ Cancelar Edición')
            .setStyle(ButtonStyle.Danger)
    );
    return [row1, row2]; 
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
    cargarEnemigosBase();
    console.log(`¡Zelda BOT iniciado como ${client.user.tag}!`);
    client.user.setActivity('Registra los objetos del reino');
});

// Listener para interacciones: Paginación y Edición
client.on('interactionCreate', async interaction => {
    // 1. Lógica de Paginación (Mantenido)
    if (interaction.isButton() && ['first', 'prev', 'next', 'last'].includes(interaction.customId)) {
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
            case 'first': newPage = 0; break;
            case 'prev': newPage = Math.max(0, currentPage - 1); break;
            case 'next': newPage = Math.min(totalPages - 1, currentPage + 1); break;
            case 'last': newPage = totalPages - 1; break;
        }
        const { embed: newEmbed } = createItemEmbedPage(items, newPage);
        const newRow = createPaginationRow(newPage, totalPages);
        await interaction.update({ embeds: [newEmbed], components: [newRow] }); 
        return; 
    }
    
    // 2. Lógica de Edición (Mantenido)
    if (interaction.isButton() && interaction.customId.startsWith('edit_')) {
        if (!interaction.member.roles.cache.has(ADMIN_ROLE_ID) && !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: '¡Solo los Administradores Canon pueden usar las herramientas de edición!', ephemeral: true });
        }
        
        const parts = interaction.customId.split('_');
        const campo = parts[1];
        const itemId = parts[2]; 
        const item = compendio[itemId];
        
        if (!item) {
            return interaction.reply({ content: 'El objeto que intentas editar ya no existe o el ID es incorrecto.', ephemeral: true });
        }

        if (campo === 'cancel') {
            await interaction.update({ 
                content: `❌ Edición de **${item.nombre}** cancelada por el Staff.`,
                embeds: [],
                components: []
            });
            return;
        }

        await interaction.deferReply({ ephemeral: true });
        
        let prompt;
        if (campo === 'tipo') {
            prompt = `Has elegido editar el **TIPO**.\n\n**Escribe el nuevo valor:**\nDebe ser uno de estos: \`${TIPOS_VALIDOS.join(', ')}\`\n\n*Para cancelar, escribe \`${CANCEL_EDIT_WORD}\`.*`;
        } else if (campo === 'imagen') {
             prompt = `Has elegido editar la **IMAGEN URL**.\n\n**Escribe la nueva URL** (debe empezar por http/https):\n\n*Para cancelar, escribe \`${CANCEL_EDIT_WORD}\`.*`;
        } else {
            prompt = `Has elegido editar el **${campo.toUpperCase()}**.\n\n**Escribe el nuevo valor:**\n\n*Para cancelar, escribe \`${CANCEL_EDIT_WORD}\`.*`;
        }
        
        edicionActiva[interaction.user.id] = { 
            itemId: itemId, 
            campo: campo,
            channelId: interaction.channelId
        };

        await interaction.followUp({ 
            content: prompt, 
            ephemeral: true 
        });
    }
});

// Listener para Mensajes (Comandos y Respuestas de Edición)
client.on('messageCreate', async message => {
    if (message.author.bot) return; 

    // 1. Lógica de Respuesta de Edición (Mantenido)
    const userId = message.author.id;
    if (edicionActiva[userId] && edicionActiva[userId].channelId === message.channelId) {
        
        const { itemId, campo } = edicionActiva[userId];
        const item = compendio[itemId];
        const nuevoValor = message.content.trim();

        if (nuevoValor.toLowerCase() === CANCEL_EDIT_WORD) {
            delete edicionActiva[userId];
            return message.reply(`❌ Proceso de edición de **${item ? item.nombre : 'item'}** cancelado por el Staff.`);
        }
        
        if (!message.member.roles.cache.has(ADMIN_ROLE_ID) && !message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            delete edicionActiva[userId];
            return message.reply({ content: 'No tienes permiso para responder a esta solicitud de edición.', ephemeral: true });
        }
        
        if (!item) {
            delete edicionActiva[userId];
            return message.reply(`Error: El objeto con ID ${itemId} ya no existe.`);
        }

        if (campo === 'tipo' && !TIPOS_VALIDOS.includes(nuevoValor.toLowerCase())) {
            return message.reply(`⚠️ **Valor Inválido:** El nuevo tipo debe ser uno de estos: \`${TIPOS_VALIDOS.join(', ')}\`. Inténtalo de nuevo en este mismo canal.`);
        }
        
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
            item[campo] = nuevoValor;
        }

        guardarCompendio();
        delete edicionActiva[userId];

        const confirmEmbed = new EmbedBuilder()
            .setColor(LIST_EMBED_COLOR)
            .setTitle(`✅ Edición Completa`)
            .setDescription(`El campo **${campo.toUpperCase()}** de **${item.nombre}** ha sido actualizado.`)
            .addFields(
                { name: `Nuevo Valor de ${campo.toUpperCase()}`, value: nuevoValor, inline: false }
            )
            .setThumbnail(item.imagen);
        
        message.reply({ embeds: [confirmEmbed] });
        
        return;
    }
    
    // 2. Lógica de Comandos (Comandos que inician con !Z)
    const prefix = '!Z'; 
    if (!message.content.startsWith(prefix)) return;

    const fullCommand = message.content.slice(prefix.length).trim();
    const args = fullCommand.split(/ +/);
    const command = args.shift().toLowerCase();
    
    const hasAdminPerms = message.member.roles.cache.has(ADMIN_ROLE_ID) || message.member.permissions.has(PermissionsBitField.Flags.Administrator);

    
    // --- COMANDO: HELP --- (Actualizado con nuevos comandos)
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
                        `\`!Zeditaritem "Nombre"\`: Inicia el menú interactivo para modificar los datos de un objeto.`,
                        `\n**— Gestión de Encuentros (NUEVO) —**`,
                        `\`!Zcrearenemigo "Nombre" "HP" "URL" ["Mensaje"]\`: Registra un enemigo base.`,
                        `\`!Zspawn "CanalID" "EnemigoNombre" [Cantidad]\`: Hace aparecer uno o varios enemigos en un canal.`,
                        `\`!Zcrearcofre "CanalID" "Tipo" "ItemNombre"\`: Crea un cofre con un item en un canal.`,
                        `*Comandos de edición en curso pueden cancelarse escribiendo \`${CANCEL_EDIT_WORD}\`*`
                    ].join('\n'),
                    inline: false
                },
                
                // Sección de Comandos Públicos (Mantenido)
                {
                    name: '🌎 Comandos de Consulta (Público)',
                    value: [
                        `\`!Zlistaritems\`: Muestra el compendio completo.`,
                        `\`!Zveritem "Nombre"\`: Muestra la ficha detallada de un objeto.`,
                        `\`!Z-help\`: Muestra esta guía de comandos.`
                    ].join('\n'),
                    inline: false
                }
            )
            .setFooter({ text: 'Desarrollado para el Rol de Nuevo Hyrule | Prefijo: !Z' });
        
        return message.channel.send({ embeds: [helpEmbed] });
    }
    
    // --- NUEVO COMANDO: CREAR ENEMIGO (Staff) ---
    if (command === 'crearenemigo') {
        if (!hasAdminPerms) {
            return message.reply('¡Solo los Administradores Canon pueden registrar enemigos!');
        }
        
        // Expresión regular para capturar hasta 4 argumentos entre comillas (el 4to es opcional)
        const regex = /"([^"]+)"/g;
        const matches = [...message.content.matchAll(regex)];

        if (matches.length < 3) {
            return message.reply('Sintaxis incorrecta. Uso: `!Zcrearenemigo "Nombre" "HP" "URL de Imagen" ["Mensaje de Aparición Opcional"]`');
        }

        const nombre = matches[0][1];
        const hp = parseInt(matches[1][1]);
        const imagenUrl = matches[2][1];
        // El cuarto match es opcional
        const mensajeAparicion = matches.length > 3 ? matches[3][1] : `¡Un **${nombre}** ha aparecido de repente!`;
        
        if (isNaN(hp) || hp <= 0) {
            return message.reply('El HP debe ser un número entero positivo.');
        }

        const id = nombre.toLowerCase().replace(/ /g, '_');

        if (enemigosBase[id]) {
            return message.reply(`¡El enemigo **${nombre}** ya está registrado!`);
        }

        enemigosBase[id] = {
            nombre: nombre,
            hp: hp,
            imagen: imagenUrl,
            mensajeAparicion: mensajeAparicion, // Nuevo campo
            registradoPor: message.author.tag
        };
        
        guardarEnemigosBase();
        
        const embed = new EmbedBuilder()
            .setColor(ENEMY_EMBED_COLOR) 
            .setTitle(`✅ Enemigo Registrado: ${nombre}`)
            .setDescription(`Un nuevo enemigo ha sido añadido a la base de datos de monstruos.`)
            .addFields(
                { name: 'HP Base', value: hp.toString(), inline: true },
                { name: 'Mensaje de Spawn', value: mensajeAparicion, inline: false }
            )
            .setThumbnail(imagenUrl);
        
        message.channel.send({ embeds: [embed] });
    }
    
    // --- NUEVO COMANDO: SPAWN ENEMIGO (Staff) ---
    if (command === 'spawn') {
        if (!hasAdminPerms) {
            return message.reply('¡Solo los Administradores Canon pueden invocar monstruos!');
        }
        
        const partes = fullCommand.split(/\s+/);
        // Esperamos: [spawn, CanalID, EnemigoNombre (con _ o comillas), Cantidad(opcional)]
        
        if (partes.length < 2) {
            return message.reply('Sintaxis incorrecta. Uso: `!Zspawn <CanalID> "Nombre Enemigo" [Cantidad (por defecto 1)]`');
        }

        const canalId = partes[1].replace(/<#|>/g, '');
        
        // Usamos regex para capturar el nombre del enemigo entre comillas (si se usan)
        const nameMatch = fullCommand.match(/"([^"]+)"/);
        let nombreEnemigo;
        
        if (nameMatch) {
            nombreEnemigo = nameMatch[1];
        } else if (partes.length > 2) {
            nombreEnemigo = partes[2]; // Asume que es el ID (sin espacios) si no hay comillas
        } else {
             return message.reply('Sintaxis incorrecta. Debes especificar el nombre del enemigo.');
        }

        const enemigoId = nombreEnemigo.toLowerCase().replace(/ /g, '_');
        const enemigoBase = enemigosBase[enemigoId];
        
        if (!enemigoBase) {
            return message.reply(`El enemigo **${nombreEnemigo}** no está registrado. Usa \`!Zcrearenemigo\`.`);
        }

        let cantidad = 1;
        // Si hay comillas, la cantidad viene después, si no, viene como tercer argumento.
        if (nameMatch) {
            const lastPart = partes[partes.length - 1];
            if (!isNaN(parseInt(lastPart))) {
                cantidad = parseInt(lastPart);
            }
        } else if (partes.length > 3 && !isNaN(parseInt(partes[3]))) {
            cantidad = parseInt(partes[3]);
        }
        
        cantidad = Math.max(1, Math.min(10, cantidad)); // Limitar a 1-10 por seguridad

        // Buscar el canal
        const targetChannel = client.channels.cache.get(canalId);
        if (!targetChannel) {
            return message.reply('No se pudo encontrar ese Canal ID. Asegúrate de que el bot tenga acceso.');
        }

        // Crear el embed de aparición
        const spawnEmbed = new EmbedBuilder()
            .setColor(ENEMY_EMBED_COLOR)
            .setTitle(`⚔️ ¡ALERTA! Enemigo a la vista: ${enemigoBase.nombre}!`)
            .setDescription(enemigoBase.mensajeAparicion) // Mensaje personalizado o por defecto
            .addFields(
                { name: 'HP', value: enemigoBase.hp.toString(), inline: true },
                { name: 'Cantidad', value: cantidad.toString(), inline: true }
            )
            .setImage(enemigoBase.imagen)
            .setFooter({ text: `Encuentro en curso en el canal ${targetChannel.name}.` });
        
        
        const sentMessage = await targetChannel.send({ embeds: [spawnEmbed] });

        // Registrar el encuentro activo
        encuentrosActivos[canalId] = {
            enemigoId: enemigoId,
            cantidad: cantidad,
            hpRestante: enemigoBase.hp * cantidad, // HP total del grupo
            mensajeId: sentMessage.id
        };

        message.reply(`✅ **${cantidad}x ${enemigoBase.nombre}** invocado(s) en ${targetChannel}.`);
    }

    // --- NUEVO COMANDO: CREAR COFRE (Staff) ---
    if (command === 'crearcofre') {
        if (!hasAdminPerms) {
            return message.reply('¡Solo los Administradores Canon pueden crear cofres!');
        }
        
        // Uso: !Zcrearcofre <CanalID> "Tipo (pequeño/grande/jefe)" "Nombre del Item"
        const regex = /"([^"]+)"/g;
        const matches = [...message.content.matchAll(regex)];
        
        if (matches.length < 2) {
            return message.reply('Sintaxis incorrecta. Uso: `!Zcrearcofre <CanalID> "Tipo (pequeño/grande/jefe)" "Nombre del Item"`');
        }

        const canalId = args[1].replace(/<#|>/g, '');
        const tipoCofre = matches[0][1].toLowerCase();
        const nombreItem = matches[1][1];
        const itemId = nombreItem.toLowerCase().replace(/ /g, '_');

        const cofre = CHEST_TYPES[tipoCofre];
        const item = compendio[itemId];
        
        if (!cofre) {
            return message.reply(`Tipo de cofre inválido. Tipos permitidos: \`${Object.keys(CHEST_TYPES).join(', ')}\`.`);
        }
        if (!item) {
            return message.reply(`El item **${nombreItem}** no está registrado en el compendio.`);
        }

        const targetChannel = client.channels.cache.get(canalId);
        if (!targetChannel) {
            return message.reply('No se pudo encontrar ese Canal ID. Asegúrate de que el bot tenga acceso.');
        }

        // Crear el embed del cofre
        const treasureEmbed = new EmbedBuilder()
            .setColor(TREASURE_EMBED_COLOR)
            .setTitle(`💎 ¡Tesoro Encontrado!`)
            .setDescription(`Has encontrado un **${cofre.nombre}**! ¿Qué contendrá?`)
            .addFields(
                { name: 'Contenido (Información de Staff)', value: `Este cofre contiene el item: **${item.nombre}**`, inline: false },
                { name: 'Tipo', value: cofre.nombre, inline: true }
            )
            .setImage(cofre.img)
            .setFooter({ text: 'Reacciona para abrir (Mecánica de RP). Item ID: ' + itemId });
        
        // Botón de Abrir (Ejemplo para futura funcionalidad)
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`open_chest_${itemId}`)
                .setLabel('Abrir Cofre')
                .setEmoji('🗝️')
                .setStyle(ButtonStyle.Success)
        );

        targetChannel.send({ embeds: [treasureEmbed], components: [row] });
        message.reply(`✅ **${cofre.nombre}** creado en ${targetChannel} con el item **${item.nombre}** dentro.`);
    }

    
    // --- Comandos de Compendio (Mantenido) ---
    if (command === 'crearitem') {
        // ... Lógica de crearitem
    }
    if (command === 'eliminaritem') {
        // ... Lógica de eliminaritem
    }
    if (command === 'editaritem') {
        // ... Lógica de editaritem
    }
    if (command === 'veritem') { 
        // ... Lógica de veritem
    }
    if (command === 'listaritems') {
        // ... Lógica de listaritems
    }
});

client.login(process.env.DISCORD_TOKEN);