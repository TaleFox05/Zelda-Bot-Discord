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
const TREASURE_EMBED_COLOR = '#634024';   // Cofres (Marrón)
const REWARD_EMBED_COLOR = '#F7BD28';     // Recompensa de Cofre 

// ID del rol de Administrador que puede usar los comandos de Staff
const ADMIN_ROLE_ID = "1420026299090731050";

// Palabras clave para la gestión
const CANCEL_EDIT_WORD = '!cancelar';
const TIPOS_VALIDOS = ['moneda', 'objeto', 'keyitem'];

// DEFINICIÓN DE COFRES
const CHEST_TYPES = {
    pequeño: {
        nombre: 'Cofre Pequeño',
        img: 'https://i.imgur.com/O6wo7s4.png'
    },
    grande: {
        nombre: 'Cofre de Mazmorra',
        img: 'https://i.imgur.com/yqdATqX.png'
    },
    jefe: {
        nombre: 'Cofre de Llave Maestra',
        img: 'https://i.imgur.com/eLywDCo.png'
    }
};

// Almacén temporal para la edición. Guarda el ID del usuario y el ID del objeto que está editando.
const edicionActiva = {};
// Nota: 'encuentrosActivos' fue eliminado para permitir spawns múltiples.

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
    try {
        const filePath = path.resolve(__dirname, 'enemies.json');

        // Intenta escribir el archivo
        fs.writeFileSync(filePath, JSON.stringify(enemigosBase, null, 4));

        // Log de éxito (si llegamos aquí, el guardado funcionó)
        console.log(`✅ [PERSISTENCIA] ¡Éxito! Enemigos guardados en: ${filePath}`);
    } catch (error) {
        // Log de fallo (si esto aparece, el problema es real)
        console.error(`❌ [ERROR CRÍTICO DE PERSISTENCIA] No se pudo guardar enemies.json.`);
        console.error(`Ruta intentada: ${path.resolve(__dirname, 'enemies.json')}`);
        console.error(`Mensaje de error del sistema: ${error.message}`);

        // Nota: El proceso seguirá, pero los datos no se guardarán.
    }
}


// =========================================================================
// === LÓGICA DE PAGINACIÓN / EDICIÓN ===
// =========================================================================

function createPaginationRow(currentPage, totalPages) {
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

function createEnemyEmbedPage(enemies, pageIndex) {
    const ENEMIES_PER_PAGE = 5;
    const start = pageIndex * ENEMIES_PER_PAGE;
    const end = start + ENEMIES_PER_PAGE;
    const enemiesToShow = enemies.slice(start, end);
    const totalPages = Math.ceil(enemies.length / ENEMIES_PER_PAGE);

    const embed = new EmbedBuilder()
        .setColor(ENEMY_EMBED_COLOR)
        .setTitle('👹 Compendio de Monstruos de Nuevo Hyrule ⚔️')
        .setDescription(`*Página ${pageIndex + 1} de ${totalPages}. Solo se muestran ${ENEMIES_PER_PAGE} enemigos por página.*`)
        .setFooter({ text: `Página ${pageIndex + 1} de ${totalPages} | Consultado vía Zelda BOT | Usa los comandos de edición para modificar.` });

    enemiesToShow.forEach(e => {
        // [MODIFICACIÓN AQUÍ] Se elimina la línea de pluralización.
        embed.addFields({
            name: `**${e.nombre}**`,
            value: `**HP Base:** ${e.hp}`,
            inline: false
        });
    });

    return { embed, totalPages };
}

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

client.on('interactionCreate', async interaction => {
    // 1. Lógica de Paginación (Objetos)
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

    // 2. Lógica de Edición 
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

    // 3. Lógica de Apertura de Cofre
    if (interaction.isButton() && interaction.customId.startsWith('open_chest_')) {
        const itemId = interaction.customId.replace('open_chest_', '');
        const item = compendio[itemId];

        // Verifica si el cofre ya fue abierto (deshabilitando el botón)
        if (interaction.message.components.length === 0 || interaction.message.components[0].components[0].disabled) {
            return interaction.reply({ content: 'Este cofre ya ha sido abierto.', ephemeral: true });
        }

        if (!item) {
            return interaction.reply({ content: 'El tesoro no se encontró en el compendio. Notifica al Staff.', ephemeral: true });
        }

        // Deshabilitar el botón original para evitar spam
        const disabledRow = new ActionRowBuilder().addComponents(
            ButtonBuilder.from(interaction.message.components[0].components[0]).setDisabled(true)
        );

        // Actualizar el mensaje original del cofre
        await interaction.update({
            components: [disabledRow]
        });

        // Crear el nuevo embed de recompensa 
        const rewardEmbed = new EmbedBuilder()
            .setColor(REWARD_EMBED_COLOR)
            .setTitle(`✨ ¡Cofre Abierto! ✨`)
            .setDescription(`**¡${interaction.user.username}** ha encontrado ${item.nombre} dentro!`)
            .setThumbnail(item.imagen) // IMAGEN DEL ITEM COMO THUMBNAIL
            .addFields(
                { name: 'Descripción del Objeto', value: item.descripcion, inline: false }
                // Campo 'Tipo' eliminado por petición del usuario
            );

        // Enviar el mensaje de recompensa
        await interaction.channel.send({
            content: `${interaction.user} ha abierto el cofre.`,
            embeds: [rewardEmbed]
        });
    }

    // 4. Lógica de Botones de Encuentro
    if (interaction.isButton() && interaction.customId.startsWith('enemy_')) {
        const action = interaction.customId.split('_')[1];

        if (action === 'accept') {
            // Lógica de aceptar combate (por ahora, solo confirmación para futuros módulos)
            await interaction.reply({ content: `**${interaction.user.username}** acepta el combate contra ${interaction.message.embeds[0].title.replace('⚔️ ¡ALERTA! ', '')}. ¡Que comience la batalla!`, ephemeral: false });

            // Remover botones y footer para evitar interacciones repetidas
            const editedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setFooter(null)
                .setDescription(interaction.message.embeds[0].description + `\n\n_El combate ha sido aceptado por ${interaction.user.username}._`);

            await interaction.message.edit({
                embeds: [editedEmbed],
                components: []
            });


        } else if (action === 'deny') {
            // Lógica de denegar combate
            const enemyName = interaction.message.embeds[0].title.replace('⚔️ ¡ALERTA! Enemigo(s) a la vista: ', '').replace(/!$/, '');

            // Eliminar el mensaje original del encuentro
            await interaction.message.delete();

            // Enviar mensaje de desaparición
            await interaction.channel.send(`✨ **${interaction.user.username}** ha decidido evitar el encuentro. ¡Los ${enemyName} se han marchado!`);

            // Responder a la interacción (ya que el mensaje original fue eliminado)
            // Se usa followUp ya que deferReply no fue usado, pero como se eliminó, el reply directo podría fallar
            // Optamos por eliminar sin dejar rastro de la interacción inicial.

        }
        return;
    }
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    // 1. Lógica de Respuesta de Edición 
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

    // 2. Lógica de Comandos 
    const prefix = '!Z';
    if (!message.content.startsWith(prefix)) return;

    const fullCommand = message.content.slice(prefix.length).trim();
    const args = fullCommand.split(/ +/);
    const command = args.shift().toLowerCase();

    const hasAdminPerms = message.member.roles.cache.has(ADMIN_ROLE_ID) || message.member.permissions.has(PermissionsBitField.Flags.Administrator);


    // --- COMANDO: HELP ---
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
                        `\`!Zcrearitem "Nombre" "Desc" "Tipo" "URL"\`: Registra un nuevo objeto.`,
                        `\`!Zeliminaritem "Nombre"\`: Borra un objeto.`,
                        `\`!Zeditaritem "Nombre"\`: Inicia edición de objeto.`,
                        `\n**— Gestión de Encuentros —**`,
                        `\`!Zcrearenemigo "Nombre" "HP" "URL" ["Mensaje"] [pluralizar_nombre]\`: Registra un enemigo base.`,
                        `\`!Zeliminarenemigo "Nombre"\`: Borra un enemigo base.`,
                        `\`!Zspawn <CanalID> "EnemigoNombre" [Cantidad] [sinbotones]\`: Hace aparecer enemigos.`,
                        `\`!Zcrearcofre <CanalID> "Tipo" "ItemNombre"\`: Crea un cofre.`,
                        `*Comandos de edición en curso pueden cancelarse escribiendo \`${CANCEL_EDIT_WORD}\`*`
                    ].join('\n'),
                    inline: false
                },

                // Sección de Comandos Públicos 
                {
                    name: '🌎 Comandos de Consulta (Público)',
                    value: [
                        `\`!Zlistaritems\`: Muestra el compendio de objetos.`,
                        `\`!Zlistarenemigos\`: Muestra el compendio de monstruos.`,
                        `\`!Zveritem "Nombre"\`: Muestra la ficha detallada de un objeto.`,
                        `\`!Z-help\`: Muestra esta guía de comandos.`
                    ].join('\n'),
                    inline: false
                }
            )
            .setFooter({ text: 'Desarrollado para el Rol de Nuevo Hyrule | Prefijo: !Z' });

        return message.channel.send({ embeds: [helpEmbed] });
    }

    // --- COMANDO: CREAR ENEMIGO (Staff) ---
    if (command === 'crearenemigo') {
        if (!hasAdminPerms) {
            return message.reply('¡Solo los Administradores Canon pueden registrar enemigos!');
        }

        const regex = /"([^"]+)"/g;
        const matches = [...message.content.matchAll(regex)];

        if (matches.length < 3) {
            return message.reply('Sintaxis incorrecta. Uso: `!Zcrearenemigo "Nombre" "HP" "URL de Imagen" ["Mensaje de Aparición Opcional"] [pluralizar_nombre(true/false)]`');
        }

        const nombre = matches[0][1];
        const hp = parseInt(matches[1][1]);
        const imagenUrl = matches[2][1];
        const mensajeAparicion = matches.length > 3 ? matches[3][1] : `¡Un **${nombre}** ha aparecido de repente!`;

        // El último argumento después de las comillas, si existe, puede ser 'true' o 'false' para pluralizar
        const allArgs = fullCommand.split(/\s+/);
        let pluralizarNombre = true;
        if (allArgs.length > 3) {
            const lastArg = allArgs[allArgs.length - 1].toLowerCase();
            // Solo se ajusta si se especifica un booleano al final
            if (lastArg === 'false') {
                pluralizarNombre = false;
            } else if (lastArg === 'true') {
                pluralizarNombre = true;
            }
        }

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
            mensajeAparicion: mensajeAparicion,
            pluralizar_nombre: pluralizarNombre, // Nuevo campo
            registradoPor: message.author.tag
        };

        guardarEnemigosBase();

        const embed = new EmbedBuilder()
            .setColor(ENEMY_EMBED_COLOR)
            .setTitle(`✅ Enemigo Registrado: ${nombre}`)
            .setDescription(`Un nuevo enemigo ha sido añadido a la base de datos de monstruos.`)
            .addFields(
                { name: 'HP Base', value: hp.toString(), inline: true },
                { name: 'Pluralización Automática', value: pluralizarNombre ? 'Sí (Añade "s")' : 'No (Usa nombre base)', inline: true }
            )
            .setThumbnail(imagenUrl);

        message.channel.send({ embeds: [embed] });
    }

    // --- COMANDO: ELIMINAR ENEMIGO (Staff) ---
    if (command === 'eliminarenemigo') {
        if (!hasAdminPerms) {
            return message.reply('¡Alto ahí! Solo los **Administradores Canon** pueden eliminar enemigos.');
        }

        const regex = /"([^"]+)"/;
        const match = fullCommand.match(regex);

        if (!match) {
            return message.reply('Uso: `!Zeliminarenemigo "Nombre Completo del Enemigo"`');
        }

        const nombreEnemigo = match[1];
        const id = nombreEnemigo.toLowerCase().replace(/ /g, '_');

        if (!enemigosBase[id]) {
            return message.reply(`No se encontró ningún enemigo llamado **${nombreEnemigo}** en la base de datos.`);
        }

        const enemigoEliminado = enemigosBase[id];
        delete enemigosBase[id];
        guardarEnemigosBase();

        const embed = new EmbedBuilder()
            .setColor('#cc0000')
            .setTitle(`🗑️ Enemigo Eliminado: ${enemigoEliminado.nombre}`)
            .setDescription(`El enemigo **${enemigoEliminado.nombre}** ha sido borrado permanentemente de la base de datos.`);

        message.channel.send({ embeds: [embed] });
    }

    // --- COMANDO: SPAWN ENEMIGO (Staff) ---
    if (command === 'spawn') {
        if (!hasAdminPerms) {
            return message.reply('¡Solo los Administradores Canon pueden invocar monstruos!');
        }

        const fullCommandContent = message.content.slice(prefix.length + command.length).trim();
        const argsList = fullCommandContent.split(/\s+/);

        if (argsList.length < 2) {
            return message.reply('Sintaxis incorrecta. Uso: `!Zspawn <CanalID> "Nombre Enemigo" [Cantidad] [sinbotones]`');
        }

        const canalId = argsList[0].replace(/<#|>/g, '');

        const nameMatch = fullCommandContent.match(/"([^"]+)"/);
        let nombreEnemigo;
        let cantidad = 1;
        let sinBotones = false;

        let remainingArgs = fullCommandContent;
        if (nameMatch) {
            nombreEnemigo = nameMatch[1];
            // Buscar argumentos después del nombre citado
            remainingArgs = fullCommandContent.slice(fullCommandContent.indexOf(nameMatch[0]) + nameMatch[0].length).trim();
            const partsAfterQuote = remainingArgs.split(/\s+/).filter(p => p.length > 0);

            if (partsAfterQuote.length > 0) {
                const firstPart = partsAfterQuote[0].toLowerCase();
                const lastPart = partsAfterQuote[partsAfterQuote.length - 1].toLowerCase();

                // Determinar la cantidad (si el primer argumento es un número)
                if (!isNaN(parseInt(firstPart))) {
                    cantidad = parseInt(firstPart);
                }

                // Determinar si hay botones (puede ser el primer o el último argumento)
                if (firstPart === 'sinbotones' || lastPart === 'sinbotones') {
                    sinBotones = true;
                }
            }
        } else if (argsList.length >= 2) {
            // Asumir nombre sin espacios: argsList[1]
            nombreEnemigo = argsList[1];
            if (argsList.length > 2 && !isNaN(parseInt(argsList[2]))) {
                cantidad = parseInt(argsList[2]);
            }
            if (argsList.includes('sinbotones')) {
                sinBotones = true;
            }
        } else {
            return message.reply('Sintaxis incorrecta. Debes especificar el nombre del enemigo.');
        }

        const enemigoId = nombreEnemigo.toLowerCase().replace(/ /g, '_');
        const enemigoBase = enemigosBase[enemigoId];

        if (!enemigoBase) {
            return message.reply(`El enemigo **${nombreEnemigo}** no está registrado. Usa \`!Zcrearenemigo\`.`);
        }

        cantidad = Math.max(1, Math.min(10, cantidad));

        const targetChannel = client.channels.cache.get(canalId);
        if (!targetChannel) {
            return message.reply('No se pudo encontrar ese Canal ID. Asegúrate de que el bot tenga acceso.');
        }

        const isPlural = cantidad > 1;

        // 1. Nombre y mensaje para el cuerpo del embed (pluralización controlada)
        let nombreEnemigoPlural = enemigoBase.nombre;
        if (isPlural) {
            if (enemigoBase.pluralizar_nombre !== false) {
                nombreEnemigoPlural += 's'; // Añade 's' si no se ha deshabilitado
            }
        }

        const spawnMessage = isPlural
            ? `¡Varios **${nombreEnemigoPlural}** han aparecido de repente!`
            : enemigoBase.mensajeAparicion;

        // 2. Título del embed (Nombre siempre singular, (s) solo si es plural)
        const titleText = `⚔️ ¡ALERTA! Enemigo${isPlural ? '(s)' : ''} a la vista: ${enemigoBase.nombre}!`;

        const spawnEmbed = new EmbedBuilder()
            .setColor(ENEMY_EMBED_COLOR)
            .setTitle(titleText)
            .setDescription(spawnMessage)
            .addFields(
                { name: 'HP Base', value: enemigoBase.hp.toString(), inline: true },
                { name: 'Cantidad', value: cantidad.toString(), inline: true }
            )
            .setThumbnail(enemigoBase.imagen)
            .setFooter({ text: `Encuentro activo en el canal ${targetChannel.name}.` });

        let components = [];
        if (!sinBotones) {
            const buttonRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('enemy_accept')
                    .setLabel('Aceptar')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId('enemy_deny')
                    .setLabel('Denegar')
                    .setStyle(ButtonStyle.Danger)
            );
            components.push(buttonRow);
        }

        await targetChannel.send({ embeds: [spawnEmbed], components: components });

        message.reply(`✅ **${cantidad}x ${enemigoBase.nombre}** invocado(s) en ${targetChannel}${sinBotones ? ' (sin botones de acción)' : ''}.`);
    }

    // --- COMANDO: CREAR COFRE (Staff) ---
    if (command === 'crearcofre') {
        if (!hasAdminPerms) {
            return message.reply('¡Solo los Administradores Canon pueden crear cofres!');
        }

        const fullCommandContent = message.content.slice(prefix.length + command.length).trim();

        const argsList = fullCommandContent.split(/\s+/);
        const canalId = argsList[0].replace(/<#|>/g, '');

        const quotedRegex = /"([^"]+)"/g;
        const matches = [...fullCommandContent.matchAll(quotedRegex)];

        if (!canalId || matches.length < 2) {
            return message.reply('Sintaxis incorrecta. Uso: `!Zcrearcofre <CanalID> "Tipo (pequeño/grande/jefe)" "Nombre del Item"`');
        }

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

        // Crear el embed del cofre (ACTUALIZADO)
        const treasureEmbed = new EmbedBuilder()
            .setColor(TREASURE_EMBED_COLOR)
            .setTitle(`🔑 ¡Tesoro Encontrado! 🎁`)
            .setDescription(`¡Un cofre ha aparecido de la nada! ¡Ábrelo para revelar el tesoro!`)
            .setThumbnail(cofre.img)
            // Eliminación del Item ID en el footer
            .setFooter({ text: 'Pulsa el botón para interactuar.' });

        // Botón de Abrir
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`open_chest_${itemId}`)
                .setLabel('Abrir Cofre')
                .setStyle(ButtonStyle.Success)
        );

        targetChannel.send({ embeds: [treasureEmbed], components: [row] });
        message.reply(`✅ **${cofre.nombre}** creado en ${targetChannel} con el item **${item.nombre}** dentro.`);
    }

    // --- Comando: LISTAR ENEMIGOS (Público) ---
    if (command === 'listarenemigos') {
        const enemies = Object.values(enemigosBase);

        if (enemies.length === 0) {
            return message.channel.send('***El Compendio de Monstruos está vacío. ¡Que se registre la primera criatura!***');
        }

        const currentPage = 0;
        // Solo se muestra la primera página por ahora (sin paginación por botones)
        const { embed } = createEnemyEmbedPage(enemies, currentPage);

        message.channel.send({ embeds: [embed] });
    }

    // --- COMANDOS RESTANTES (CREAR ITEM, ELIMINAR ITEM, EDITAR ITEM, VER ITEM, LISTAR OBJETOS) ---
    // ... Se mantienen sin cambios significativos en esta iteración.

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

        const embed = createEditSelectionEmbed(item);
        const rows = createEditButtons(itemId);

        message.channel.send({ embeds: [embed], components: rows });
    }

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