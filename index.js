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
// NUEVO: Base de datos para los inventarios de personajes/tuppers
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
// === FUNCIONES ASÍNCRONAS DE DATOS ===
// =========================================================================

async function obtenerTodosEnemigos() {
    const enemies = {};
    for await (const [key, value] of enemigosDB.iterator()) {
        enemies[key] = value;
    }
    return Object.values(enemies);
}

// Devuelve el array de items ordenados por fecha
async function obtenerTodosItems() {
    const items = {};
    for await (const [key, value] of compendioDB.iterator()) {
        items[key] = value;
    }
    const itemsArray = Object.values(items);

    // Si la propiedad existe, ordena por ella (ascendente = más antiguo primero)
    itemsArray.sort((a, b) => (a.fechaCreacionMs || 0) - (b.fechaCreacionMs || 0));

    return itemsArray;
}

// =========================================================================
// === FUNCIONES DE GESTIÓN DE PERSONAJES ===
// =========================================================================

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

    // Inicializar el array de objetos y rupias si no existe
    if (!personaje.objetos) {
        personaje.objetos = [];
    }
    if (!personaje.rupias) {
        personaje.rupias = 0;
    }

    if (item.tipo === 'moneda') {
        // LÓGICA DE MONEDA: Suma el valor al contador de rupias
        personaje.rupias += (item.valorRupia || 1); // Suma el valor, por defecto 1 si no está definido
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
    const hasAdminPerms = interaction.member.roles.cache.has(ADMIN_ROLE_ID) || interaction.member.permissions.has(PermissionsBitField.Flags.Administrator);

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

        // Determinar si es paginación de Items o Enemigos
        if (embedTitle.includes('Objetos')) {
            // Paginación de Items
            dataArray = await obtenerTodosItems();
            createEmbedFunc = createItemEmbedPage;
            if (dataArray.length === 0) return interaction.update({ content: 'El compendio de objetos está vacío.' });
        } else if (embedTitle.includes('Monstruos')) {
            // Paginación de Enemigos
            dataArray = await obtenerTodosEnemigos();
            createEmbedFunc = createEnemyEmbedPage;
            if (dataArray.length === 0) return interaction.update({ content: 'El compendio de monstruos está vacío.' });
        } else {
            return; // No es una interacción de paginación conocida.
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

    // 2. Lógica de Apertura de Cofre (sin cambios)
    if (interaction.isButton() && interaction.customId.startsWith('open_chest_')) {
        const itemId = interaction.customId.replace('open_chest_', '');
        const item = await compendioDB.get(itemId);

        if (interaction.message.components.length === 0 || interaction.message.components[0].components[0].disabled) {
            return interaction.reply({ content: 'Este cofre ya ha sido abierto.', ephemeral: true });
        }

        if (!item) {
            return interaction.reply({ content: 'El tesoro no se encontró en el compendio. Notifica al Staff.', ephemeral: true });
        }

        // --- COMIENZA LA LÓGICA DE ASIGNACIÓN INTERACTIVA ---

        const characterKeyPrefix = `${interaction.user.id}:`;
        const allCharacterKeys = [];

        // Obtener solo los personajes del usuario actual
        for await (const [key] of personajesDB.iterator()) {
            if (key.startsWith(characterKeyPrefix)) {
                allCharacterKeys.push(key.split(':')[1].replace(/_/g, ' ')); // Extraer el nombre del personaje
            }
        }

        if (allCharacterKeys.length === 0) {
            // Si no hay personajes, lo asigna al usuario por defecto (o simplemente desactiva el botón)
            return interaction.reply({ content: 'No tienes personajes (tuppers) registrados para recibir este objeto. Usa `!Zcrearpersonaje "Nombre"` primero.', ephemeral: true });
        }

        // 1. Deshabilitar el botón original 
        const disabledRow = new ActionRowBuilder().addComponents(
            ButtonBuilder.from(interaction.message.components[0].components[0]).setDisabled(true)
        );
        await interaction.update({ components: [disabledRow] });

        // 2. Crear un selector (dropdown) para elegir el personaje
        const options = allCharacterKeys.map(name => ({
            label: name,
            value: name.toLowerCase().replace(/ /g, '_')
        }));

        const selectRow = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`assign_item_${itemId}_to_char`)
                .setPlaceholder(`Selecciona el personaje para ${item.nombre}...`)
                .addOptions(options)
        );

        // 3. Preguntar al usuario a quién asignarlo
        const assignmentMessage = await interaction.channel.send({
            content: `${interaction.user}, ¡Has encontrado **${item.nombre}**! ¿A qué personaje (Tupper) quieres asignarlo?`,
            components: [selectRow]
        });

        // Este es el flujo ideal. Por ahora, nos centraremos en el comando de staff para la prueba
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

    // 4. Lógica de Asignación por Select (cuando se pulsa el dropdown)
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('assign_item_')) {
        const parts = interaction.customId.split('_');
        const itemId = parts[2];
        const characterId = interaction.values[0]; // ID limpia del personaje

        const characterKey = generarPersonajeKey(interaction.user.id, characterId);
        const item = await compendioDB.get(itemId);

        // Bloquear si no es el usuario original
        if (interaction.message.mentions.users.first().id !== interaction.user.id) {
            return interaction.reply({ content: 'Esta asignación es solo para el usuario que abrió el cofre.', ephemeral: true });
        }

        // 1. Asignar el ítem
        const success = await agregarItemAInventario(characterKey, item);

        if (success) {
            // 2. Eliminar el mensaje de selección o deshabilitar
            await interaction.message.delete();

            const characterName = characterId.replace(/_/g, ' ');

            const rewardEmbed = new EmbedBuilder()
                .setColor(REWARD_EMBED_COLOR)
                .setTitle(`✨ Objeto Asignado! ✨`)
                .setDescription(`**${item.nombre}** ha sido añadido al inventario de **${characterName}** (Tupper de ${interaction.user.username}).`)
                .setThumbnail(item.imagen);

            return interaction.reply({ embeds: [rewardEmbed], ephemeral: false });
        } else {
            return interaction.reply({ content: `Error: No se encontró el inventario para el personaje ${characterId}.`, ephemeral: true });
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


    // --- COMANDO: HELP --- (Añadir comando de personaje)
    if (command === '-help') {
        const helpEmbed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('📖 Guía de Comandos del Zelda BOT')
            .setDescription('Aquí puedes consultar todos los comandos disponibles, diferenciando por el nivel de acceso.')
            .addFields(
                {
                    name: '🛠️ Comandos de Administración (Solo Staff)',
                    value: [
                        `\`!Zcrearitem "Nombre" "Desc" "Tipo" "URL"\`: Registra un nuevo objeto.`,
                        `\`!Zeliminaritem "Nombre"\`: Borra un objeto.`,
                        `\`!Zdaritem "Personaje" "ItemNombre"\`: **(NUEVO)** Asigna un item del compendio al inventario de un personaje.`,
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
                        `\`!Zcrearpersonaje "Nombre del Tupper"\`: **(NUEVO)** Crea un inventario vinculado a un Tupper.`,
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

        // La expresión regular ahora busca hasta 5 argumentos entre comillas
        const regex = /"([^"]+)"/g;
        const matches = [...message.content.matchAll(regex)];
        const numExpected = 4; // Nombre, Descripción, Tipo, URL

        if (matches.length < numExpected) {
            return message.reply('Sintaxis incorrecta. Uso: `!Zcrearitem "Nombre" "Descripción" "Tipo (moneda/objeto/keyitem)" "URL de Imagen" ["ValorRupia (solo para monedas)"]`');
        }

        const nombre = matches[0][1];
        const descripcion = matches[1][1];
        const tipo = matches[2][1].toLowerCase();
        const imagenUrl = matches[3][1];

        let valorRupia = 0; // Por defecto es 0

        if (!TIPOS_VALIDOS.includes(tipo)) {
            return message.reply(`El tipo de objeto debe ser uno de estos: ${TIPOS_VALIDOS.join(', ')}.`);
        }

        // Si es tipo moneda, buscamos el quinto argumento para el valor
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
            valorRupia: valorRupia, // AÑADIDO: Guardamos el valor
            disponible: true,
            imagen: imagenUrl,
            registradoPor: message.author.tag,
            fecha: now.toLocaleDateString('es-ES'),
            fechaCreacionMs: now.getTime()
        };

        await compendioDB.set(id, newItem); // GUARDADO A LA DB

        const embed = new EmbedBuilder()
            .setColor(LIST_EMBED_COLOR)
            .setTitle(`✅ Objeto Registrado: ${nombre}`)
            .setDescription(`Un nuevo artefacto ha sido añadido al Compendio de Hyrule.`)
            .addFields(
                { name: 'Descripción', value: descripcion, inline: false },
                { name: 'Tipo', value: tipo.toUpperCase(), inline: true },
                { name: 'Valor (Rupias)', value: tipo === 'moneda' ? valorRupia.toString() : 'N/A', inline: true }, // Muestra el valor
                { name: 'Estado', value: 'Disponible', inline: true }
            )
            .setImage(imagenUrl)
            .setFooter({ text: `Registrado por: ${message.author.tag}` });

        message.channel.send({ embeds: [embed] });
    }

    // --- COMANDO: ELIMINAR ITEM (Staff) --- (Sin cambios)
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

        await compendioDB.delete(id); // ELIMINADO DE LA DB

        const embed = new EmbedBuilder()
            .setColor('#cc0000')
            .setTitle(`🗑️ Objeto Eliminado: ${itemEliminado.nombre}`)
            .setDescription(`El objeto **${itemEliminado.nombre}** ha sido borrado permanentemente del Compendio de Nuevo Hyrule.`);

        message.channel.send({ embeds: [embed] });
    }

    // --- COMANDO: VER ITEM (Público) --- (Sin cambios)
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

    // --- COMANDO: LISTAR ITEMS (Público) --- (Sin cambios)
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

    // --- NUEVO COMANDO: CREAR PERSONAJE/TUPPER (Público) ---
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

        // Estructura inicial del inventario
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

    // --- NUEVO COMANDO: DAR ITEM A PERSONAJE (Staff) ---
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

        // 1. Obtener datos del Item
        const itemId = nombreItem.toLowerCase().replace(/ /g, '_');
        const item = await compendioDB.get(itemId);

        if (!item) {
            return message.reply(`El objeto **${nombreItem}** no se encontró en el compendio.`);
        }

        // 2. Generar clave y obtener el inventario del personaje
        const personajeKey = generarPersonajeKey(targetUser.id, nombrePersonaje);

        const success = await agregarItemAInventario(personajeKey, item);

        if (!success) {
            return message.reply(`No se encontró un inventario para el personaje **${nombrePersonaje}** vinculado a ${targetUser}. ¿Ha usado \`!Zcrearpersonaje\`?`);
        }

        // 3. Notificación
        const embed = new EmbedBuilder()
            .setColor(REWARD_EMBED_COLOR)
            .setTitle(`📦 Objeto Transferido a Inventario`)
            .setDescription(`El Staff le ha dado **${item.nombre}** a **${nombrePersonaje}** (Tupper de ${targetUser.tag}).`)
            .addFields(
                { name: 'Descripción del Objeto', value: item.descripcion, inline: false },
                { name: 'Inventario Actual', value: '*(Usa un futuro comando para verificarlo)*', inline: false }
            )
            .setThumbnail(item.imagen);

        message.channel.send({ content: `${targetUser}`, embeds: [embed] });
    }

    // --- NUEVO COMANDO: VER INVENTARIO DEL PERSONAJE (Público) ---
    if (command === 'inventario' || command === 'inv') {
        const regex = /"([^"]+)"/;
        const match = fullCommand.match(regex);

        if (!match) {
            return message.reply('Uso: `!Zinventario "Nombre del Tupper"` (Debes especificar el personaje a consultar).');
        }

        const nombrePersonaje = match[1];
        const personajeKey = generarPersonajeKey(message.author.id, nombrePersonaje);

        const personaje = await personajesDB.get(personajeKey);

        if (!personaje) {
            return message.reply(`No se encontró el personaje **${nombrePersonaje}** vinculado a tu cuenta. ¿Seguro que lo creaste con \`!Zcrearpersonaje\`?`);
        }

        const items = personaje.objetos || [];

        if (items.length === 0 && personaje.rupias === 0) {
            return message.channel.send(`📭 El inventario de **${personaje.nombre}** está vacío. ¡Tiene **0 Rupias**!`);
        }

        const ITEMS_PER_PAGE = 10; // Usaremos 10 items por página para el inventario
        const totalPages = Math.max(1, Math.ceil(items.length / ITEMS_PER_PAGE));
        const currentPage = 0;

        const start = currentPage * ITEMS_PER_PAGE;
        const end = start + ITEMS_PER_PAGE;
        const itemsToShow = items.slice(start, end);

        // Generar el contenido del embed
        let itemsList = itemsToShow.length > 0
            ? itemsToShow.map(item => `• **${item.nombre}** [${item.tipo.toUpperCase()}]`).join('\n')
            : '*¡Este personaje no tiene objetos normales!*';

        const embed = new EmbedBuilder()
            .setColor(LIST_EMBED_COLOR)
            .setTitle(`🎒 Inventario de ${personaje.nombre}`)
            .setDescription(`**Propietario:** ${personaje.propietarioTag}\n**Rupias Actuales:** 💎 **${personaje.rupias}**`)
            .addFields({
                name: 'Objetos en Posesión',
                value: itemsList,
                inline: false
            })
            .setFooter({ text: `Página ${currentPage + 1} de ${totalPages} | Total de objetos: ${items.length}` });

        // Si hay más de una página, añadimos paginación (aunque de momento solo mostramos la primera)
        if (totalPages > 1) {
            const row = createPaginationRow(currentPage, totalPages);
            message.channel.send({ embeds: [embed], components: [row] });
        } else {
            message.channel.send({ embeds: [embed] });
        }
    }

    // --- COMANDO: CREAR ENEMIGO (Staff) --- (Sin cambios)
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

        await enemigosDB.set(id, newEnemy); // GUARDADO A LA DB

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

    // --- COMANDO: ELIMINAR ENEMIGO (Staff) --- (Sin cambios)
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

        await enemigosDB.delete(id); // ELIMINADO DE LA DB

        const embed = new EmbedBuilder()
            .setColor('#cc0000')
            .setTitle(`🗑️ Enemigo Eliminado: ${enemigoEliminado.nombre}`)
            .setDescription(`El enemigo **${enemigoEliminado.nombre}** ha sido borrado permanentemente de la base de datos.`);

        message.channel.send({ embeds: [embed] });
    }

    // --- COMANDO: SPAWN ENEMIGO (Staff) --- (Sin cambios)
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

                if (firstPart === 'sinbotones' || lastPart === 'sinbotones') {
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

    // --- COMANDO: CREAR COFRE (Staff) --- (Inicia la nueva lógica interactiva)
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
            .setFooter({ text: 'Pulsa el botón para interactuar.' });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`open_chest_${itemId}`) // Usamos el ID del ítem en el customId
                .setLabel('Abrir Cofre')
                .setStyle(ButtonStyle.Success)
        );

        targetChannel.send({ embeds: [treasureEmbed], components: [row] });
        message.reply(`✅ **${cofre.nombre}** creado en ${targetChannel} con el item **${item.nombre}** dentro.`);
    }

    // --- COMANDO: LISTAR ENEMIGOS (Público) --- (Sin cambios)
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