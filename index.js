// Carga la librería 'dotenv' para leer el archivo .env (donde está el Token secreto)
require('dotenv').config();

// Importa las clases necesarias de discord.js
const {
    Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder
} = require('discord.js');

// --- LIBRERÍAS DE PERSISTENCIA (KEYV/REDIS) ---
const Keyv = require('keyv');

// =========================================================================
// === CONFIGURACIÓN Y DEFINICIONES ===
// =========================================================================

// COLORES DE EMBEDS
const LIST_EMBED_COLOR = '#427522';       // Compendio y General
const ENEMY_EMBED_COLOR = '#E82A2A';      // Enemigos (Rojo)
const TREASURE_EMBED_COLOR = '#634024';  // Cofres (Marrón)
const REWARD_EMBED_COLOR = '#F7BD28';     // Recompensa de Cofre 
const PREFIX = '!Z';

// ID del rol de Administrador que puede usar los comandos de Staff
const ADMIN_ROLE_ID = "1420026299090731050";

// Palabras clave para la gestión
const TIPOS_VALIDOS = ['moneda', 'objeto', 'keyitem'];

// DEFINICIÓN DE COFRES
const CHEST_TYPES = {
    pequeño: {
        nombre: 'Cofre Pequeño',
        img: 'https://i.imgur.com/O6wo7s4.png'
    },
    grande: {
        nombre: 'Cofre de Mazmorra',
        img: 'https://static.wikia.nocookie.net/zelda_gamepedia_en/images/0/0f/MM3D_Chest.png/revision/latest/scale-to-width/360?cb=20201125233413'
    },
    jefe: {
        nombre: 'Cofre de Llave Maestra',
        img: 'https://frommetolu.wordpress.com/wp-content/uploads/2012/01/treasure_chest_n64.png'
    }
};

// --- ESTRUCTURA DE DATOS: KEYV (REDIS) ---
const compendioDB = new Keyv(process.env.REDIS_URL, { namespace: 'items' });
const enemigosDB = new Keyv(process.env.REDIS_URL, { namespace: 'enemies' });
const personajesDB = new Keyv(process.env.REDIS_URL, { namespace: 'personajes' });

// CONFIGURACIÓN DEL CLIENTE (EL BOT)
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
    ]
});

// =========================================================================
// === FUNCIONES ASÍNCRONAS DE DATOS Y AYUDA ===
// =========================================================================

async function obtenerTodosEnemigos() {
    const enemies = {};
    for await (const [key, value] of enemigosDB.iterator()) {
        enemies[key] = value;
    }
    return Object.values(enemies);
}

async function obtenerTodosItems() {
    const items = {};
    for await (const [key, value] of compendioDB.iterator()) {
        items[key] = value;
    }
    const itemsArray = Object.values(items);

    itemsArray.sort((a, b) => (a.fechaCreacionMs || 0) - (b.fechaCreacionMs || 0));

    return itemsArray;
}

/**
 * Genera la clave única para un personaje/tupper.
 * @param {string} userId - La ID de Discord del usuario propietario.
 * @param {string} nombrePersonaje - El nombre del tupper (personaje).
 * @returns {string} La clave única compuesta.
 */
function generarPersonajeKey(userId, nombrePersonaje) {
    const nombreLimpio = nombrePersonaje.toLowerCase().replace(/ /g, '_');
    return `${userId}:${nombreLimpio}`;
}

/**
 * Añade un objeto al inventario de un personaje.
 * @param {string} key - La clave única del personaje (userId:nombre).
 * @param {object} item - El objeto a añadir (de compendioDB).
 * @returns {Promise<boolean>} True si se añadió, false si no se encontró el personaje.
 */
async function agregarItemAInventario(key, item) {
    let personaje = await personajesDB.get(key);

    if (!personaje) {
        return false;
    }

    if (!personaje.objetos) {
        personaje.objetos = [];
    }
    if (!personaje.rupias) {
        personaje.rupias = 0;
    }

    if (item.tipo === 'moneda') {
        // LÓGICA DE MONEDA: Suma el valor al contador de rupias
        personaje.rupias += (item.valorRupia || 1);
    } else {
        // LÓGICA DE OBJETO NORMAL: Añade el item a la lista
        const itemEnInventario = {
            nombre: item.nombre,
            id: item.nombre.toLowerCase().replace(/ /g, '_'),
            tipo: item.tipo,
        };
        personaje.objetos.push(itemEnInventario);
    }

    await personajesDB.set(key, personaje);
    return true;
}

/**
 * Realiza la migración de rupias de un inventario existente.
 * Busca items de tipo 'moneda' en el inventario de objetos y los transfiere al contador de rupias.
 * @param {object} personaje - El objeto del personaje a migrar.
 * @returns {Promise<boolean>} True si se realizó alguna migración.
 */
async function migrarRupias(personaje) {
    if (!personaje || !personaje.objetos || !personaje.propietarioId || !personaje.nombre) {
        return false;
    }

    let itemsNoMoneda = [];
    let cambiosRealizados = false;

    // Obtener todas las claves de items del compendio para no hacer llamadas individuales dentro del loop
    const compendioItems = {};
    for await (const [key, value] of compendioDB.iterator()) {
        compendioItems[key] = value;
    }

    for (const item of personaje.objetos) {
        const itemBase = compendioItems[item.id];

        if (itemBase && itemBase.tipo === 'moneda') {
            // Migra la rupia
            personaje.rupias = (personaje.rupias || 0) + (itemBase.valorRupia || 1);
            cambiosRealizados = true;
        } else {
            // Es un objeto normal o un item obsoleto (sin entrada en compendio)
            itemsNoMoneda.push(item);
        }
    }

    if (cambiosRealizados) {
        personaje.objetos = itemsNoMoneda; // Reemplazar con la lista filtrada
        const personajeKey = generarPersonajeKey(personaje.propietarioId, personaje.nombre);
        await personajesDB.set(personajeKey, personaje);
    }

    return cambiosRealizados;
}

/**
 * Intenta obtener la URL del avatar de un Tupper (Webhook/APP) buscando en mensajes recientes.
 * @param {Client} client - El cliente de Discord.
 * @param {string} characterName - El nombre del personaje (Tupper).
 * @param {GuildMember} member - El miembro de Discord que ejecuta el comando.
 * @returns {Promise<string>} La URL del avatar.
 */
async function getTupperAvatar(client, characterName, member) {
    // Si la foto del usuario es el fallback
    const fallbackAvatar = member.user.displayAvatarURL({ dynamic: true });

    // Si el usuario no tiene un mensaje reciente, no podemos buscar el canal
    if (!member.lastMessage || !member.lastMessage.channelId) {
        return fallbackAvatar;
    }

    try {
        // Busca en los últimos 50 mensajes del canal donde el usuario interactuó
        const channel = member.guild.channels.cache.get(member.lastMessage.channelId);
        if (!channel) return fallbackAvatar;

        const messages = await channel.messages.fetch({ limit: 50 });

        // Buscamos un mensaje que sea de un Webhook/App (Tupper)
        const tupperMessage = messages.find(msg =>
            msg.webhookId &&
            msg.author.username.toLowerCase() === characterName.toLowerCase() // El webhook usa el nombre del tupper como username
        );

        if (tupperMessage && tupperMessage.author.avatarURL) {
            // El bot detectó la foto del webhook del tupper
            return tupperMessage.author.avatarURL({ dynamic: true });
        }
    } catch (error) {
        // console.error(`Error buscando avatar de Tupper ${characterName}:`, error.message);
    }

    // Si no lo encuentra, usa el avatar del usuario
    return fallbackAvatar;
}


// =========================================================================
// === LÓGICA DE PAGINACIÓN / EMBEDS ===
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
        .setFooter({ text: `Página ${pageIndex + 1} de ${totalPages} | Consultado vía Zelda BOT | Usa los botones para navegar.` });

    enemiesToShow.forEach(e => {
        embed.addFields({
            name: `**${e.nombre}**`,
            value: `**HP Base:** ${e.hp}`,
            inline: false
        });
    });

    return { embed, totalPages };
}


// =========================================================================
// === EVENTOS DEL BOT (Manejo de Interacciones/Mensajes) ===
// =========================================================================

client.on('ready', () => {
    console.log(`¡Zelda BOT iniciado como ${client.user.tag}!`);
    client.user.setActivity('Gestionando el Compendio (DB Externa)');
});

client.on('interactionCreate', async interaction => {
    // 1. Lógica de Paginación (Objetos y Enemigos unificados)
    if (interaction.isButton() && ['first', 'prev', 'next', 'last'].includes(interaction.customId)) {

        const footerText = interaction.message.embeds[0].footer.text;
        const embedTitle = interaction.message.embeds[0].title;
        const match = footerText.match(/Página (\d+) de (\d+)/);

        if (!match) return;
        const currentPage = parseInt(match[1]) - 1;

        let dataArray = [];
        let createEmbedFunc;
        let ITEMS_PER_PAGE = 5;

        if (embedTitle.includes('Objetos')) {
            dataArray = await obtenerTodosItems();
            createEmbedFunc = createItemEmbedPage;
            if (dataArray.length === 0) return interaction.update({ content: 'El compendio de objetos está vacío.' });
        } else if (embedTitle.includes('Monstruos')) {
            dataArray = await obtenerTodosEnemigos();
            createEmbedFunc = createEnemyEmbedPage;
            if (dataArray.length === 0) return interaction.update({ content: 'El compendio de monstruos está vacío.' });
        } else {
            return;
        }

        const totalPages = Math.ceil(dataArray.length / ITEMS_PER_PAGE);
        let newPage = currentPage;

        switch (interaction.customId) {
            case 'first': newPage = 0; break;
            case 'prev': newPage = Math.max(0, currentPage - 1); break;
            case 'next': newPage = Math.min(totalPages - 1, currentPage + 1); break;
            case 'last': newPage = totalPages - 1; break;
        }

        const { embed: newEmbed } = createEmbedFunc(dataArray, newPage);
        const newRow = createPaginationRow(newPage, totalPages);
        await interaction.update({ embeds: [newEmbed], components: [newRow] });
        return;
    }

    // 2. Lógica de Apertura de Cofre - MODIFICADO MENSAJE DE SELECCIÓN
    if (interaction.isButton() && interaction.customId.startsWith('open_chest_')) {
        const fullId = interaction.customId.replace('open_chest_', '');
        const [itemId, chestType] = fullId.split('-'); // Ahora el ID es itemID-tipoCofre

        // El cofre fue creado con el ID del item, vamos a buscar el objeto original
        const item = await compendioDB.get(itemId);
        const cofreInfo = CHEST_TYPES[chestType || 'pequeño']; // Usamos el tipo para el mensaje

        if (interaction.message.components.length === 0 || interaction.message.components[0].components[0].disabled) {
            return interaction.reply({ content: 'Este cofre ya ha sido abierto.', ephemeral: true });
        }

        if (!item) {
            return interaction.reply({ content: 'El tesoro no se encontró en el compendio. Notifica al Staff.', ephemeral: true });
        }

        const characterKeyPrefix = `${interaction.user.id}:`;
        const allCharacterKeys = [];

        for await (const [key] of personajesDB.iterator()) {
            if (key.startsWith(characterKeyPrefix)) {
                allCharacterKeys.push(key.split(':')[1].replace(/_/g, ' '));
            }
        }

        if (allCharacterKeys.length === 0) {
            return interaction.reply({ content: 'No tienes personajes (tuppers) registrados para recibir este objeto. Usa `!Zcrearpersonaje "Nombre"` primero.', ephemeral: true });
        }

        const disabledRow = new ActionRowBuilder().addComponents(
            ButtonBuilder.from(interaction.message.components[0].components[0]).setDisabled(true)
        );
        await interaction.update({ components: [disabledRow] });

        const options = allCharacterKeys.map(name => ({
            label: name,
            value: name.toLowerCase().replace(/ /g, '_')
        }));

        // El customId ahora lleva el itemID y el TIPO de cofre
        const selectRow = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`assign_item_${itemId}_${chestType}`) // Guardamos el tipo de cofre
                .setPlaceholder(`Selecciona el personaje...`)
                .addOptions(options)
        );

        // Mensaje de cofre encontrado (sin el nombre del objeto)
        await interaction.channel.send({
            content: `${interaction.user}, ¡Has encontrado un **${cofreInfo.nombre}**! ¿A qué personaje (Tupper) quieres asignarle el tesoro?`,
            components: [selectRow]
        });

        return;
    }

    // 3. Lógica de Botones de Encuentro (sin cambios)
    if (interaction.isButton() && interaction.customId.startsWith('enemy_')) {
        const action = interaction.customId.split('_')[1];

        if (action === 'accept') {
            await interaction.reply({ content: `**${interaction.user.username}** acepta el combate contra ${interaction.message.embeds[0].title.replace('⚔️ ¡ALERTA! ', '')}. ¡Que comience la batalla!`, ephemeral: false });

            const editedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setFooter(null)
                .setDescription(interaction.message.embeds[0].description + `\n\n_El combate ha sido aceptado por ${interaction.user.username}._`);

            await interaction.message.edit({
                embeds: [editedEmbed],
                components: []
            });


        } else if (action === 'deny') {
            const enemyName = interaction.message.embeds[0].title.replace('⚔️ ¡ALERTA! Enemigo(s) a la vista: ', '').replace(/!$/, '');

            await interaction.message.delete();

            await interaction.channel.send(`✨ **${interaction.user.username}** ha decidido evitar el encuentro. ¡Los ${enemyName} se han marchado!`);
        }
        return;
    }

    // 4. Lógica de Asignación por Select (cuando se pulsa el dropdown) - CORRECCIÓN DEFINITIVA DE EXTRACCIÓN
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('assign_item_')) {
        // Deferir para evitar "Interacción Fallida"
        await interaction.deferUpdate({ ephemeral: false });

        const parts = interaction.customId.split('_');
        // parts[2] contiene "itemId-tipoCofre" o simplemente "itemId"
        const fullItemIdAndChest = parts[2];

        // **CORRECCIÓN CLAVE:** El ID del objeto es siempre la parte ANTES del primer guion.
        const itemId = fullItemIdAndChest.split('-')[0]; // Esto DEBE dar 'rupia_azul' o 'poción_roja'

        const characterId = interaction.values[0];

        const characterKey = generarPersonajeKey(interaction.user.id, characterId);

        // Obtener el objeto base (compendioDB busca por el ID limpio: 'rupia_azul')
        const item = await compendioDB.get(itemId);

        if (!item) {
            // Mensaje de error más descriptivo
            return interaction.followUp({ content: `Error: El objeto con ID **${itemId}** ya no existe en el compendio.`, ephemeral: true });
        }

        // Bloquear si no es el usuario original (usando la mención original)
        if (interaction.message.content.includes(interaction.user.id) === false) {
            return interaction.followUp({ content: 'Esta asignación es solo para el usuario que abrió el cofre.', ephemeral: true });
        }

        // --- LÓGICA CRÍTICA: AÑADIR ITEM AL INVENTARIO ---
        // Esta función maneja automáticamente si es 'moneda' (suma rupias) o 'objeto' (añade a lista).
        const success = await agregarItemAInventario(characterKey, item);

        if (success) {
            // El mensaje original del menú desplegable ya no es necesario
            await interaction.message.delete().catch(console.error);

            const characterName = characterId.replace(/_/g, ' ');

            // Determinar si es un artículo o una moneda para el mensaje de UX
            const isMoneda = item.tipo === 'moneda';
            const articulo = isMoneda ? 'una' : 'un';

            const rewardEmbed = new EmbedBuilder()
                .setColor(REWARD_EMBED_COLOR)
                // Título: ¡Has encontrado un/una [Nombre del Objeto]!
                .setTitle(`✨ ¡Has encontrado ${articulo} ${item.nombre}! ✨`)
                .setThumbnail(item.imagen)
                // Descripción: Descripción del objeto ANTES de la confirmación
                .setDescription(`*${item.descripcion}*`);

            // Añadir campo de confirmación (Diferenciación de Rupias/Objeto)
            if (isMoneda) {
                // Moneda (Suma)
                rewardEmbed.addFields({
                    name: 'Asignación de Rupias',
                    value: `Se han añadido **${item.valorRupia}** rupias a la cuenta de **${characterName}**.`,
                    inline: false
                });
            } else {
                // Objeto Normal (Añade a lista)
                rewardEmbed.addFields({
                    name: 'Asignación de Objeto',
                    value: `**${item.nombre}** ha sido añadido al inventario de **${characterName}** (Tupper de ${interaction.user.username}).`,
                    inline: false
                });
            }

            // Usamos followUp después de deferUpdate
            return interaction.followUp({ embeds: [rewardEmbed], ephemeral: false });
        } else {
            return interaction.followUp({ content: `Error: No se encontró el inventario para el personaje ${characterId}.`, ephemeral: true });
        }
    }
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    const hasAdminPerms = message.member.roles.cache.has(ADMIN_ROLE_ID) || message.member.permissions.has(PermissionsBitField.Flags.Administrator);

    if (!message.content.startsWith(PREFIX)) return;

    const fullCommand = message.content.slice(PREFIX.length).trim();
    const args = fullCommand.split(/ +/);
    const command = args.shift().toLowerCase();


    // --- COMANDO: HELP ---
    if (command === '-help') {
        const helpEmbed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('📖 Guía de Comandos del Zelda BOT')
            .setDescription('Aquí puedes consultar todos los comandos disponibles, diferenciando por el nivel de acceso.')
            .addFields(
                {
                    name: '🛠️ Comandos de Administración (Solo Staff)',
                    value: [
                        `\`!Zcrearitem "Nombre" "Desc" "Tipo" "URL" ["ValorRupia"]\`: Registra un nuevo objeto.`,
                        `\`!Zeliminaritem "Nombre"\`: Borra un objeto.`,
                        `\`!Zdaritem @Usuario "Personaje" "ItemNombre"\`: Asigna un item del compendio al inventario de un personaje.`,
                        `\`!Zeliminarrupias @Usuario "Personaje" <cantidad|all>\`: Elimina rupias del inventario.`,
                        `\n**— Gestión de Encuentros —**`,
                        `\`!Zcrearenemigo "Nombre" "HP" "URL" ["Mensaje"] [pluralizar_nombre]\`: Registra un enemigo base.`,
                        `\`!Zeliminarenemigo "Nombre"\`: Borra un enemigo base.`,
                        `\`!Zspawn <CanalID> "EnemigoNombre" [Cantidad] [sinbotones]\`: Hace aparecer enemigos.`,
                        `\`!Zcrearcofre <CanalID> "Tipo" "ItemNombre"\`: Crea un cofre.`,
                    ].join('\n'),
                    inline: false
                },
                {
                    name: '🌎 Comandos de Consulta (Público)',
                    value: [
                        `\`!Zcrearpersonaje "Nombre del Tupper"\`: Crea un inventario vinculado a un Tupper.`,
                        `\`!Zpersonajes\`: Muestra la lista de personajes que has creado.`,
                        `\`!Zinventario "Nombre del Tupper"\`: Muestra los objetos y rupias de tu personaje.`,
                        `\`!Zeliminariteminv "Personaje" "Item"\`: Elimina un objeto de tu inventario.`,
                        `\`!Zlistaritems\`: Muestra el compendio de objetos (ordenado por fecha de creación).`,
                        `\`!Zlistarenemigos\`: Muestra el compendio de monstruos (con paginación).`,
                        `\`!Zveritem "Nombre"\`: Muestra la ficha detallada de un objeto.`,
                        `\`!Z-help\`: Muestra esta guía de comandos.`
                    ].join('\n'),
                    inline: false
                }
            )
            .setFooter({ text: 'Desarrollado para el Rol de Nuevo Hyrule | Prefijo: !Z' });

        return message.channel.send({ embeds: [helpEmbed] });
    }

    // --- COMANDO: CREAR ITEM (Staff) ---
    if (command === 'crearitem') {
        if (!hasAdminPerms) {
            return message.reply('¡Alto ahí! Solo los **Administradores Canon** pueden registrar objetos mágicos.');
        }

        const regex = /"([^"]+)"/g;
        const matches = [...message.content.matchAll(regex)];
        const numExpected = 4;

        if (matches.length < numExpected) {
            return message.reply('Sintaxis incorrecta. Uso: `!Zcrearitem "Nombre" "Descripción" "Tipo (moneda/objeto/keyitem)" "URL de Imagen" ["ValorRupia (solo para monedas)"]`');
        }

        const nombre = matches[0][1];
        const descripcion = matches[1][1];
        const tipo = matches[2][1].toLowerCase();
        const imagenUrl = matches[3][1];

        let valorRupia = 0;

        if (!TIPOS_VALIDOS.includes(tipo)) {
            return message.reply(`El tipo de objeto debe ser uno de estos: ${TIPOS_VALIDOS.join(', ')}.`);
        }

        if (tipo === 'moneda') {
            if (matches.length < 5) {
                return message.reply('Para items tipo **moneda**, debes especificar el valor en Rupias: `!Zcrearitem "Nombre" "Desc" "moneda" "URL" "ValorRupia"`');
            }
            valorRupia = parseInt(matches[4][1]);
            if (isNaN(valorRupia) || valorRupia <= 0) {
                return message.reply('El ValorRupia para las monedas debe ser un número entero positivo.');
            }
        }

        const id = nombre.toLowerCase().replace(/ /g, '_');

        const existingItem = await compendioDB.get(id);
        if (existingItem) {
            return message.reply(`¡El objeto **${nombre}** ya está registrado!`);
        }

        const now = new Date();
        const newItem = {
            nombre: nombre,
            descripcion: descripcion,
            tipo: tipo,
            valorRupia: valorRupia,
            disponible: true,
            imagen: imagenUrl,
            registradoPor: message.author.tag,
            fecha: now.toLocaleDateString('es-ES'),
            fechaCreacionMs: now.getTime()
        };

        await compendioDB.set(id, newItem);

        const embed = new EmbedBuilder()
            .setColor(LIST_EMBED_COLOR)
            .setTitle(`✅ Objeto Registrado: ${nombre}`)
            .setDescription(`Un nuevo artefacto ha sido añadido al Compendio de Hyrule.`)
            .addFields(
                { name: 'Descripción', value: descripcion, inline: false },
                { name: 'Tipo', value: tipo.toUpperCase(), inline: true },
                { name: 'Valor (Rupias)', value: tipo === 'moneda' ? valorRupia.toString() : 'N/A', inline: true },
                { name: 'Estado', value: 'Disponible', inline: true }
            )
            .setImage(imagenUrl)
            .setFooter({ text: `Registrado por: ${message.author.tag}` });

        message.channel.send({ embeds: [embed] });
    }

    // --- COMANDO: ELIMINAR ITEM (Staff) ---
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

        const itemEliminado = await compendioDB.get(id);
        if (!itemEliminado) {
            return message.reply(`No se encontró ningún objeto llamado **${nombreItem}** en el Compendio.`);
        }

        await compendioDB.delete(id);

        const embed = new EmbedBuilder()
            .setColor('#cc0000')
            .setTitle(`🗑️ Objeto Eliminado: ${itemEliminado.nombre}`)
            .setDescription(`El objeto **${itemEliminado.nombre}** ha sido borrado permanentemente del Compendio de Nuevo Hyrule.`);

        message.channel.send({ embeds: [embed] });
    }

    // --- COMANDO: VER ITEM (Público) ---
    if (command === 'veritem') {
        const regex = /"([^"]+)"/;
        const match = fullCommand.match(regex);

        if (!match) {
            return message.reply('Uso: `!Zveritem "Nombre Completo del Objeto"`');
        }

        const nombreItem = match[1];
        const id = nombreItem.toLowerCase().replace(/ /g, '_');
        const item = await compendioDB.get(id);

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

    // --- COMANDO: LISTAR ITEMS (Público) ---
    if (command === 'listaritems') {
        const items = await obtenerTodosItems();

        if (items.length === 0) {
            return message.channel.send('***El Compendio de Objetos está vacío. ¡Que se registre el primer tesoro!***');
        }

        const currentPage = 0;
        const { embed, totalPages } = createItemEmbedPage(items, currentPage);
        const row = createPaginationRow(currentPage, totalPages);

        message.channel.send({ embeds: [embed], components: [row] });
    }

    // --- COMANDO: CREAR PERSONAJE/TUPPER (Público) ---
    if (command === 'crearpersonaje') {
        const regex = /"([^"]+)"/;
        const match = fullCommand.match(regex);

        if (!match) {
            return message.reply('Uso: `!Zcrearpersonaje "Nombre del Tupper"` (Debe ser el nombre exacto de tu tupper).');
        }

        const nombrePersonaje = match[1];
        const personajeKey = generarPersonajeKey(message.author.id, nombrePersonaje);

        const existingPersonaje = await personajesDB.get(personajeKey);

        if (existingPersonaje) {
            return message.reply(`¡Ya tienes un inventario registrado para el personaje **${nombrePersonaje}**!`);
        }

        const nuevoInventario = {
            nombre: nombrePersonaje,
            propietarioId: message.author.id,
            propietarioTag: message.author.tag,
            objetos: [],
            rupias: 0,
            fechaRegistro: new Date().toLocaleDateString('es-ES')
        };

        await personajesDB.set(personajeKey, nuevoInventario);

        const embed = new EmbedBuilder()
            .setColor(LIST_EMBED_COLOR)
            .setTitle(`👤 Personaje Registrado: ${nombrePersonaje}`)
            .setDescription(`Se ha creado un inventario y ha sido vinculado a tu ID de Discord.`)
            .addFields(
                { name: 'Propietario', value: message.author.tag, inline: true },
                { name: 'Inventario Inicial', value: 'Vacío (0 Objetos, 0 Rupias)', inline: true }
            )
            .setFooter({ text: 'Ahora puedes recibir objetos en este personaje.' });

        message.channel.send({ embeds: [embed] });
    }

    // --- COMANDO: VER INVENTARIO DEL PERSONAJE (Público) ---
    if (command === 'inventario' || command === 'inv') {
        const regex = /"([^"]+)"/;
        const match = fullCommand.match(regex);

        if (!match) {
            return message.reply('Uso: `!Zinventario "Nombre del Tupper"` (Debes especificar el personaje a consultar).');
        }

        const nombrePersonaje = match[1];
        const personajeKey = generarPersonajeKey(message.author.id, nombrePersonaje);

        let personaje = await personajesDB.get(personajeKey);

        if (!personaje) {
            return message.reply(`No se encontró el personaje **${nombrePersonaje}** vinculado a tu cuenta. ¿Seguro que lo creaste con \`!Zcrearpersonaje\`?`);
        }

        // LÓGICA DE MIGRACIÓN DE RUPÍAS (asegura que está actualizada)
        await migrarRupias(personaje);
        personaje = await personajesDB.get(personajeKey);

        const items = personaje.objetos || [];

        // Obtener Avatar (Tupper o Usuario) 
        const avatarUrl = await getTupperAvatar(client, nombrePersonaje, message.member);

        // PAGINACIÓN Y MOSTRAR ITEMS
        const ITEMS_PER_PAGE = 10;
        const totalPages = Math.max(1, Math.ceil(items.length / ITEMS_PER_PAGE));
        const currentPage = 0;

        const start = currentPage * ITEMS_PER_PAGE;
        const end = start + ITEMS_PER_PAGE;
        const itemsToShow = items.slice(start, end);

        let itemsList = itemsToShow.length > 0
            ? itemsToShow.map(item => `• **${item.nombre}**`).join('\n')
            : '¡Este personaje no tiene objetos!'; // Mensaje de inventario vacío

        const embed = new EmbedBuilder()
            .setColor(LIST_EMBED_COLOR)
            .setTitle(`🎒 Inventario de ${personaje.nombre}`)
            .setDescription(`**Propietario:** ${personaje.propietarioTag}\n**Rupias:** ${personaje.rupias}`)
            .setThumbnail(avatarUrl)
            .addFields({
                name: 'Objetos en Posesión',
                value: itemsList,
                inline: false
            })
            .setFooter({ text: `Página ${currentPage + 1} de ${totalPages} | Total de objetos: ${items.length}` });

        if (totalPages > 1) {
            const row = createPaginationRow(currentPage, totalPages);
            message.channel.send({ embeds: [embed], components: [row] });
        } else {
            message.channel.send({ embeds: [embed] });
        }
    }

    // --- COMANDO: VER LISTA DE PERSONAJES DEL USUARIO (Público) ---
    if (command === 'personajes') {
        const characterKeyPrefix = `${message.author.id}:`;
        const allCharacters = [];

        for await (const [key, value] of personajesDB.iterator()) {
            if (key.startsWith(characterKeyPrefix)) {
                allCharacters.push(value);
            }
        }

        if (allCharacters.length === 0) {
            return message.reply('No tienes ningún personaje (tupper) registrado. Usa `!Zcrearpersonaje "Nombre"` para crear uno.');
        }

        const characterList = allCharacters.map(char => `• **${char.nombre}** - ${char.objetos.length} objetos, ${char.rupias} rupias.`).join('\n');

        const embed = new EmbedBuilder()
            .setColor(LIST_EMBED_COLOR)
            .setTitle(`👤 Personajes de ${message.author.tag}`)
            .setDescription(characterList)
            .setFooter({ text: `Total de personajes: ${allCharacters.length}` });

        message.channel.send({ embeds: [embed] });
    }

    // --- NUEVO COMANDO: ELIMINAR ITEM DEL INVENTARIO (Público) ---
    if (command === 'eliminariteminv') {
        const regex = /"([^"]+)"/g;
        const matches = [...message.content.matchAll(regex)];

        if (matches.length < 2) {
            return message.reply('Uso: `!Zeliminariteminv "NombrePersonaje" "NombreItem"`');
        }

        const nombrePersonaje = matches[0][1];
        const nombreItem = matches[1][1];

        const personajeKey = generarPersonajeKey(message.author.id, nombrePersonaje);
        const personaje = await personajesDB.get(personajeKey);

        if (!personaje) {
            return message.reply(`No se encontró el personaje **${nombrePersonaje}** vinculado a tu cuenta.`);
        }

        const itemIndex = personaje.objetos.findIndex(item => item.nombre.toLowerCase() === nombreItem.toLowerCase());

        if (itemIndex === -1) {
            return message.reply(`El objeto **${nombreItem}** no se encontró en el inventario de **${nombrePersonaje}**.`);
        }

        const itemEliminado = personaje.objetos.splice(itemIndex, 1)[0];
        await personajesDB.set(personajeKey, personaje);

        const embed = new EmbedBuilder()
            .setColor('#cc0000')
            .setTitle(`🗑️ Objeto Eliminado del Inventario`)
            .setDescription(`El objeto **${itemEliminado.nombre}** ha sido eliminado del inventario de **${nombrePersonaje}**.`)
            .setFooter({ text: 'No se puede deshacer esta acción.' });

        message.channel.send({ embeds: [embed] });
    }

    // --- NUEVO COMANDO: ELIMINAR RUPIAS DE PERSONAJE (Staff) ---
    if (command === 'eliminarrupias') {
        if (!hasAdminPerms) {
            return message.reply('¡Solo los Administradores Canon pueden modificar las rupias!');
        }

        const regex = /"([^"]+)"/g;
        const matches = [...message.content.matchAll(regex)];

        const targetUser = message.mentions.users.first();
        if (!targetUser) {
            return message.reply('Sintaxis incorrecta. Uso: `!Zeliminarrupias @Usuario "NombrePersonaje" <cantidad|all>`');
        }

        // El nombre del personaje es el primer match. Si no hay, error.
        if (matches.length < 1) {
            return message.reply('Debes especificar el nombre del personaje entre comillas y una cantidad.');
        }

        const nombrePersonaje = matches[0][1];
        // La cantidad es el último argumento que no es una mención ni comilla
        const allArgs = fullCommand.split(/\s+/).filter(a => a.length > 0 && !a.startsWith('<@'));
        let cantidad = allArgs[allArgs.length - 1];

        // Si la cantidad es el nombre del personaje (lo cual ocurre si no hay un 3er arg), asignamos undefined
        if (cantidad === nombrePersonaje.replace(/ /g, '_').toLowerCase()) {
            cantidad = undefined;
        }

        if (cantidad === undefined) {
            return message.reply('Debes especificar una cantidad numérica o la palabra `all`.');
        }

        const personajeKey = generarPersonajeKey(targetUser.id, nombrePersonaje);
        let personaje = await personajesDB.get(personajeKey);

        if (!personaje) {
            return message.reply(`No se encontró el personaje **${nombrePersonaje}** vinculado a ${targetUser}.`);
        }

        let oldRupias = personaje.rupias;
        let rupiasRestadas = 0;

        if (cantidad.toLowerCase() === 'all') {
            rupiasRestadas = oldRupias;
            personaje.rupias = 0;
        } else {
            const cantidadNum = parseInt(cantidad);
            if (isNaN(cantidadNum) || cantidadNum <= 0) {
                return message.reply('La cantidad debe ser un número positivo o la palabra `all`.');
            }
            rupiasRestadas = Math.min(cantidadNum, oldRupias);
            personaje.rupias = Math.max(0, oldRupias - cantidadNum);
        }

        await personajesDB.set(personajeKey, personaje);

        const embed = new EmbedBuilder()
            .setColor('#E82A2A')
            .setTitle(`💸 Rupias Borradas`)
            .setDescription(`Se han retirado **${rupiasRestadas}** rupias del inventario de **${personaje.nombre}**.`)
            .addFields(
                { name: 'Propietario', value: targetUser.tag, inline: true },
                { name: 'Rupias Anteriores', value: oldRupias.toString(), inline: true },
                { name: 'Rupias Actuales', value: personaje.rupias.toString(), inline: true }
            );

        message.channel.send({ embeds: [embed] });
    }

    // --- COMANDO: DAR ITEM A PERSONAJE (Staff) - MODIFICADO ---
    if (command === 'daritem') {
        if (!hasAdminPerms) {
            return message.reply('¡Solo los Administradores Canon pueden dar objetos directamente!');
        }

        const regex = /"([^"]+)"/g;
        const matches = [...message.content.matchAll(regex)];

        if (matches.length < 2 || !message.mentions.users.first()) {
            return message.reply('Sintaxis incorrecta. Uso: `!Zdaritem @Usuario "NombrePersonaje" "NombreItem"`');
        }

        const targetUser = message.mentions.users.first();
        const nombrePersonaje = matches[0][1];
        const nombreItem = matches[1][1];

        const itemId = nombreItem.toLowerCase().replace(/ /g, '_');
        const item = await compendioDB.get(itemId);

        if (!item) {
            return message.reply(`El objeto **${nombreItem}** no se encontró en el compendio.`);
        }

        const personajeKey = generarPersonajeKey(targetUser.id, nombrePersonaje);

        const success = await agregarItemAInventario(personajeKey, item);

        if (!success) {
            return message.reply(`No se encontró un inventario para el personaje **${nombrePersonaje}** vinculado a ${targetUser}. ¿Ha usado \`!Zcrearpersonaje\`?`);
        }

        const embed = new EmbedBuilder()
            .setColor(REWARD_EMBED_COLOR)
            .setTitle(`✨ Objeto Transferido a Inventario ✨`)
            .setDescription(`**${item.nombre}** ha sido dado a **${nombrePersonaje}** (Tupper de ${targetUser.tag}).`) // Mensaje sin Staff
            .addFields(
                { name: 'Descripción del Objeto', value: item.descripcion, inline: false },
                { name: 'Inventario Actual', value: '*(Usa \`!Zinventario\` para verificarlo)*', inline: false }
            )
            .setThumbnail(item.imagen);

        message.channel.send({ content: `${targetUser}`, embeds: [embed] });
    }

    // --- COMANDO: CREAR ENEMIGO (Staff) ---
    if (command === 'crearenemigo') {
        if (!hasAdminPerms) {
            return message.reply('¡Solo los Administradores Canon pueden registrar enemigos!');
        }

        const regex = /"([^"]+)"/g;
        const matches = [...message.content.matchAll(regex)];

        if (matches.length < 3) {
            return message.reply('Sintaxis incorrecta. Uso: `!Zcrearenemigo "Nombre" "HP" "URL de Imagen" ["Mensaje de Aparición Opcional"] [pluralizar_nombre]`');
        }

        const nombre = matches[0][1];
        const hp = parseInt(matches[1][1]);
        const imagenUrl = matches[2][1];
        const mensajeAparicion = matches.length > 3 ? matches[3][1] : `¡Un **${nombre}** ha aparecido de repente!`;

        const allArgs = fullCommand.split(/\s+/);
        let pluralizarNombre = true;
        if (allArgs.length > 3) {
            const lastArg = allArgs[allArgs.length - 1].toLowerCase();
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

        const existingEnemy = await enemigosDB.get(id);
        if (existingEnemy) {
            return message.reply(`¡El enemigo **${nombre}** ya está registrado!`);
        }

        const newEnemy = {
            nombre: nombre,
            hp: hp,
            imagen: imagenUrl,
            mensajeAparicion: mensajeAparicion,
            pluralizar_nombre: pluralizarNombre,
            registradoPor: message.author.tag
        };

        await enemigosDB.set(id, newEnemy);

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

        const enemigoEliminado = await enemigosDB.get(id);
        if (!enemigoEliminado) {
            return message.reply(`No se encontró ningún enemigo llamado **${nombreEnemigo}** en la base de datos.`);
        }

        await enemigosDB.delete(id);

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

        const fullCommandContent = message.content.slice(PREFIX.length + command.length).trim();
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
            remainingArgs = fullCommandContent.slice(fullCommandContent.indexOf(nameMatch[0]) + nameMatch[0].length).trim();
            const partsAfterQuote = remainingArgs.split(/\s+/).filter(p => p.length > 0);

            if (partsAfterQuote.length > 0) {
                const firstPart = partsAfterQuote[0].toLowerCase();
                const lastPart = partsAfterQuote[partsAfterQuote.length - 1].toLowerCase();

                if (!isNaN(parseInt(firstPart))) {
                    cantidad = parseInt(firstPart);
                }

                if (firstPart === 'sinbotones' || lastPart === 'sinbotones' || partsAfterQuote.includes('sinbotones')) {
                    sinBotones = true;
                }
            }
        } else if (argsList.length >= 2) {
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
        const enemigoBase = await enemigosDB.get(enemigoId);

        if (!enemigoBase) {
            return message.reply(`El enemigo **${nombreEnemigo}** no está registrado. Usa \`!Zcrearenemigo\`.`);
        }

        cantidad = Math.max(1, Math.min(10, cantidad));

        const targetChannel = client.channels.cache.get(canalId);
        if (!targetChannel) {
            return message.reply('No se pudo encontrar ese Canal ID. Asegúrate de que el bot tenga acceso.');
        }

        const isPlural = cantidad > 1;

        let nombreEnemigoPlural = enemigoBase.nombre;
        if (isPlural) {
            if (enemigoBase.pluralizar_nombre !== false) {
                nombreEnemigoPlural += 's';
            }
        }

        const spawnMessage = isPlural
            ? `¡Varios **${nombreEnemigoPlural}** han aparecido de repente!`
            : enemigoBase.mensajeAparicion;

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

    // --- COMANDO: CREAR COFRE (Staff) - MODIFICADO BOTÓN CUSTOM ID
    if (command === 'crearcofre') {
        if (!hasAdminPerms) {
            return message.reply('¡Solo los Administradores Canon pueden crear cofres!');
        }

        const fullCommandContent = message.content.slice(PREFIX.length + command.length).trim();

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
        const item = await compendioDB.get(itemId);

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

        const treasureEmbed = new EmbedBuilder()
            .setColor(TREASURE_EMBED_COLOR)
            .setTitle(`🔑 ¡Tesoro Encontrado! 🎁`)
            .setDescription(`¡Un cofre ha aparecido de la nada! ¡Ábrelo para revelar el tesoro!`)
            .setThumbnail(cofre.img)
            .setFooter({ text: `Pulsa el botón para interactuar. Contiene: ${item.nombre}` }); // Pequeño spoiler para staff

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                // El custom ID ahora lleva el item ID y el tipo de cofre
                .setCustomId(`open_chest_${itemId}-${tipoCofre}`)
                .setLabel(`Abrir ${cofre.nombre}`)
                .setStyle(ButtonStyle.Success)
        );

        targetChannel.send({ embeds: [treasureEmbed], components: [row] });
        message.reply(`✅ **${cofre.nombre}** creado en ${targetChannel} con el item **${item.nombre}** dentro.`);
    }

    // --- COMANDO: LISTAR ENEMIGOS (Público) ---
    if (command === 'listarenemigos') {
        const enemies = await obtenerTodosEnemigos();

        if (enemies.length === 0) {
            return message.channel.send('***El Compendio de Monstruos está vacío. ¡Que se registre la primera criatura!***');
        }

        const currentPage = 0;
        const { embed, totalPages } = createEnemyEmbedPage(enemies, currentPage);
        const row = createPaginationRow(currentPage, totalPages);

        message.channel.send({ embeds: [embed], components: [row] });
    }
});

client.login(process.env.DISCORD_TOKEN);