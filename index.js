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
const TREASURE_EMBED_COLOR = '#634024';   // Cofres (Marrón)
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

// GIF DE LINK LEVANTANDO EL TESORO (Para la recompensa final del cofre)
// ¡NUEVO ENLACE PROPORCIONADO POR EL USUARIO!
const DEFAULT_TREASURE_GIF = "https://cdn.discordapp.com/attachments/1271207734817329192/1421231688335228968/8bit-link.gif?ex=68d848a7&is=68d6f727&hm=cf8a4e8635b95941165407aae911d8bd1a07c58e2f6aca27a7db466943daf8c9&";

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
 * Genera la clave limpia para cualquier entrada de la DB (Item o Personaje).
 * @param {string} nombre - El nombre con espacios, apóstrofes, etc.
 * @returns {string} La clave limpia, sin espacios ni guiones bajos, solo letras y números. (ej: 'palodeku').
 */
function generarKeyLimpia(nombre) {
    // Convierte a minúsculas, elimina espacios y reemplaza cualquier cosa que no sea letra/número.
    return nombre.toLowerCase()
        .replace(/ /g, '')
        .replace(/[^a-z0-9]/g, '');
}

/**
 * Genera la clave única para un personaje/tupper.
 * @param {string} userId - La ID de Discord del usuario propietario.
 * @param {string} nombrePersonaje - El nombre del tupper (personaje).
 * @returns {string} La clave única compuesta.
 */
function generarPersonajeKey(userId, nombrePersonaje) {
    // La clave del personaje MANTIENE el guion bajo como separador de palabras, para legibilidad en la DB,
    // pero se basa en el nombre limpio.
    const nombreLimpio = nombrePersonaje.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '_');
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
        personaje.rupias = personaje.rupia || 0; 
    }

    // Usamos el ID compacto para buscar en la base de datos de items
    const itemIdCompacto = generarKeyLimpia(item.nombre);

    if (item.tipo === 'moneda') {
        // LÓGICA DE MONEDA: Suma el valor al contador de rupias
        personaje.rupias += (item.valorRupia || 1);
    } else {
        // LÓGICA DE OBJETO NORMAL: Añade el item a la lista
        const itemEnInventario = {
            nombre: item.nombre,
            id: itemIdCompacto, // Usar el ID compacto para el inventario
            tipo: item.tipo,
        };
        personaje.objetos.push(itemEnInventario);
    }

    await personajesDB.set(key, personaje);
    return true;
}

/**
 * Realiza la migración de rupias de un inventario existente.
 * @param {object} personaje - El objeto del personaje a migrar.
 * @returns {Promise<boolean>} True si se realizó alguna migración.
 */
async function migrarRupias(personaje) {
    if (!personaje || !personaje.objetos || !personaje.propietarioId || !personaje.nombre) {
        return false;
    }

    let itemsNoMoneda = [];
    let cambiosRealizados = false;

    const compendioItems = {};
    for await (const [key, value] of compendioDB.iterator()) {
        compendioItems[key] = value;
    }

    for (const item of personaje.objetos) {
        // Usa el ID compacto para la migración
        const itemIdCompacto = generarKeyLimpia(item.nombre);
        const itemBase = compendioItems[itemIdCompacto];

        if (itemBase && itemBase.tipo === 'moneda') {
            personaje.rupias = (personaje.rupias || 0) + (itemBase.valorRupia || 1);
            cambiosRealizados = true;
        } else {
            itemsNoMoneda.push(item);
        }
    }

    if (cambiosRealizados) {
        personaje.objetos = itemsNoMoneda; 
        const personajeKey = generarPersonajeKey(personaje.propietarioId, personaje.nombre);
        await personajesDB.set(personajeKey, personaje);
    }

    return cambiosRealizados;
}

/**
 * Obtiene la URL del avatar de un Tupper. (Lógica omitida por brevedad, se mantiene el stub).
 */
async function getTupperAvatar(client, characterName, member) {
    const fallbackAvatar = member.user.displayAvatarURL({ dynamic: true });
    // ... lógica de búsqueda de Tupper ...
    return fallbackAvatar;
}

/**
 * ELIMINA TODOS los personajes (inventarios) de un usuario. (Lógica omitida por brevedad, se mantiene el stub).
 */
async function deleteAllPersonajes(userId) {
    // ... lógica de borrado ...
    return 0; // Sustituir con el conteo real
}


// =========================================================================
// === LÓGICA DE PAGINACIÓN / EMBEDS (Sin cambios funcionales aquí) ===
// =========================================================================

function createPaginationRow(currentPage, totalPages) {
    // ... Lógica de botones ...
    return new ActionRowBuilder().addComponents(/* ... botones ... */);
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
        // NOTA: Se añade el ID compacto al campo 'value' para depuración
        embed.addFields({
            name: `**${p.nombre}** (ID: ${p.id})`,
            value: `**Descripción:** *${p.descripcion}*\n**Tipo:** ${p.tipo.toUpperCase()} | **Estado:** ${p.disponible ? 'Disponible' : 'En Posesión'}`,
            inline: false
        });
    });

    return { embed, totalPages };
}

function createEnemyEmbedPage(enemies, pageIndex) {
    // ... Lógica de paginación de enemigos ...
    // Se mantiene sin cambios para el ejemplo
    return { embed: new EmbedBuilder(), totalPages: 1 };
}

/**
 * Maneja la lógica de obtener el objeto del compendio, asignarlo al personaje
 * y enviar el mensaje de confirmación (tanto para objetos como para monedas).
 * @param {string} userId - ID del usuario.
 * @param {string} itemIdCompacto - ID compacto del item (ej: 'rupiaazul').
 * @param {string} characterId - ID limpio del personaje (ej: 'mikato_tale_tsubashaki').
 * @param {object} interaction - El objeto de la interacción.
 * @param {string} treasureGif - URL del GIF a usar para el tesoro.
 */
async function manejarAsignacionCofre(userId, itemIdCompacto, characterId, interaction, treasureGif) {
    const characterKey = generarPersonajeKey(userId, characterId.replace(/_/g, ' ')); // Recalculamos la key limpia
    
    // El item se busca directamente con el ID COMPACTO
    const item = await compendioDB.get(itemIdCompacto);

    if (!item) {
        return interaction.followUp({ content: `Error: El objeto con ID compacto **${itemIdCompacto}** ya no existe en el compendio. Notifica al staff.`, ephemeral: true });
    }

    // --- LÓGICA CRÍTICA: AÑADIR ITEM AL INVENTARIO (incluye Rupias) ---
    const success = await agregarItemAInventario(characterKey, item);

    if (success) {
        if (interaction.message && interaction.message.delete) {
            await interaction.message.delete().catch(console.error);
        }

        // El nombre del personaje se recupera del characterId limpio
        const characterName = characterId.replace(/_/g, ' ');

        const isMoneda = item.tipo === 'moneda';
        const articulo = isMoneda ? 'una' : 'un';

        const rewardEmbed = new EmbedBuilder()
            .setColor(REWARD_EMBED_COLOR)
            .setTitle(`✨ ¡Has encontrado ${articulo} ${item.nombre}! ✨`)
            .setThumbnail(item.imagen)
            // AHORA USA EL GIF PASADO COMO ARGUMENTO
            .setImage(treasureGif) 
            .setDescription(`*${item.descripcion}*`);

        if (isMoneda) {
            rewardEmbed.addFields({
                name: 'Asignación de Rupias',
                value: `Se han añadido **${item.valorRupia}** rupias a la cuenta de **${characterName}**.`,
                inline: false
            });
        } else {
            rewardEmbed.addFields({
                name: 'Asignación de Objeto',
                value: `**${item.nombre}** (ID: ${item.id}) ha sido añadido al inventario de **${characterName}** (Tupper de ${interaction.user.username}).`,
                inline: false
            });
        }

        return interaction.followUp({ embeds: [rewardEmbed], ephemeral: false });
    } else {
        return interaction.followUp({ content: `Error: No se encontró el inventario para el personaje **${characterName}** vinculado a tu cuenta.`, ephemeral: true });
    }
}

// =========================================================================
// === EVENTOS DEL BOT (Manejo de Interacciones/Mensajes) ===
// =========================================================================

client.on('ready', () => {
    console.log(`¡Zelda BOT iniciado como ${client.user.tag}!`);
    client.user.setActivity('Gestionando el Compendio (DB Externa)');
});

client.on('interactionCreate', async interaction => {
    // 1. Lógica de Paginación (Se mantiene, pero llama a la nueva createItemEmbedPage)
    if (interaction.isButton() && ['first', 'prev', 'next', 'last'].includes(interaction.customId)) {
        // ... (Lógica de Paginación, se mantiene la estructura que llama a createItemEmbedPage) ...
        return;
    }

    // 2. Lógica de Apertura de Cofre - MODIFICADO para CUSTOM ID
    if (interaction.isButton() && interaction.customId.startsWith('open_chest_')) {
        const fullId = interaction.customId.replace('open_chest_', '');
        // El ID completo ahora puede ser: itemIdCompacto-tipoCofre-urlGif
        const parts = fullId.split('-'); 
        
        const itemIdCompacto = parts[0];
        const chestType = parts[1];
        // Si existe el tercer elemento, es el GIF personalizado. Si no, usa el por defecto.
        const customGif = parts[2] ? decodeURIComponent(parts[2]) : DEFAULT_TREASURE_GIF; 

        // El item se busca con el ID COMPACTO
        const item = await compendioDB.get(itemIdCompacto);
        const cofreInfo = CHEST_TYPES[chestType || 'pequeño']; 

        if (interaction.message.components.length === 0 || interaction.message.components[0].components[0].disabled) {
            return interaction.reply({ content: 'Este cofre ya ha sido abierto.', ephemeral: true });
        }

        if (!item) {
            return interaction.reply({ content: `El tesoro con ID **${itemIdCompacto}** no se encontró. Notifica al Staff.`, ephemeral: true });
        }

        const characterKeyPrefix = `${interaction.user.id}:`;
        const allCharacterKeys = [];

        // Lógica para obtener personajes... (se mantiene)

        if (allCharacterKeys.length === 0) {
            return interaction.reply({ content: 'No tienes personajes (tuppers) registrados para recibir este objeto. Usa `!Zcrearpersonaje "Nombre"` primero.', ephemeral: true });
        }

        // Deshabilitar botón de cofre (se mantiene)

        const options = allCharacterKeys.map(name => ({
            label: name,
            value: name.toLowerCase().replace(/ /g, '_')
        }));

        // El customId ahora lleva: itemIdCompacto, tipoCofre, y el GIF codificado (por si es personalizado)
        const selectRow = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`assign_item_${itemIdCompacto}_${chestType}_${encodeURIComponent(customGif)}`) 
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

    // 4. Lógica de Asignación por Select (cuando se pulsa el dropdown)
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('assign_item_')) {
        await interaction.deferUpdate({ ephemeral: false });

        const parts = interaction.customId.split('_');
        // parts[2] = itemIdCompacto
        // parts[3] = chestType
        // parts[4] = urlGif (codificada)

        const itemIdCompacto = parts[2];
        const treasureGif = parts[4] ? decodeURIComponent(parts[4]) : DEFAULT_TREASURE_GIF;

        const characterId = interaction.values[0];

        if (interaction.message.content.includes(interaction.user.id) === false) {
            return interaction.followUp({ content: 'Esta asignación es solo para el usuario que abrió el cofre.', ephemeral: true });
        }

        // Llamar a la función centralizada para manejar la asignación, ahora pasando el GIF
        return manejarAsignacionCofre(interaction.user.id, itemIdCompacto, characterId, interaction, treasureGif);
    }
    
    // 5. Lógica de Confirmación de Borrado de Personajes (sin cambios)
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    // ... (Definición de hasAdminPerms y parsing del comando) ...
    // ... (Comandos de ayuda - Help) ...

    // --- COMANDO: CREAR ITEM (Staff) - MODIFICADO ID COMPACTO ---
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
            // Lógica de valor rupia (se mantiene)
        }

        // AHORA USAMOS LA CLAVE COMPACTA (sin espacios ni guiones bajos)
        const idCompacto = generarKeyLimpia(nombre);

        const existingItem = await compendioDB.get(idCompacto);
        if (existingItem) {
            return message.reply(`¡El objeto con ID **${idCompacto}** ya está registrado! (Nombre: ${existingItem.nombre})`);
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
            fechaCreacionMs: now.getTime(),
            id: idCompacto // Se guarda el ID compacto dentro del objeto
        };

        await compendioDB.set(idCompacto, newItem);

        const embed = new EmbedBuilder()
            .setColor(LIST_EMBED_COLOR)
            .setTitle(`✅ Objeto Registrado: ${nombre}`)
            .setDescription(`Un nuevo artefacto ha sido añadido al Compendio de Hyrule. **ID Compacto:** \`${idCompacto}\``)
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

    // --- COMANDO: ELIMINAR ITEM (Staff) - MODIFICADO ID COMPACTO ---
    if (command === 'eliminaritem') {
        if (!hasAdminPerms) {
            return message.reply('¡Alto ahí! Solo los **Administradores Canon** pueden eliminar objetos.');
        }

        const regex = /"([^"]+)"/;
        const match = fullCommand.match(regex);

        if (!match) {
            return message.reply('Uso: `!Zeliminaritem "ID Compacto del Objeto"`');
        }

        // Espera el ID compacto (o el nombre, y lo compacta si es necesario)
        const idInput = match[1];
        const idCompacto = generarKeyLimpia(idInput);

        const itemEliminado = await compendioDB.get(idCompacto);
        if (!itemEliminado) {
            return message.reply(`No se encontró ningún objeto con el ID **${idCompacto}** en el Compendio.`);
        }

        await compendioDB.delete(idCompacto);

        const embed = new EmbedBuilder()
            .setColor('#cc0000')
            .setTitle(`🗑️ Objeto Eliminado: ${itemEliminado.nombre}`)
            .setDescription(`El objeto **${itemEliminado.nombre}** (ID: \`${idCompacto}\`) ha sido borrado permanentemente del Compendio.`);

        message.channel.send({ embeds: [embed] });
    }

    // --- COMANDO: VER ITEM (Público) - MODIFICADO ID COMPACTO ---
    if (command === 'veritem') {
        const regex = /"([^"]+)"/;
        const match = fullCommand.match(regex);

        if (!match) {
            return message.reply('Uso: `!Zveritem "ID Compacto del Objeto"`');
        }

        const idInput = match[1];
        const idCompacto = generarKeyLimpia(idInput);
        const item = await compendioDB.get(idCompacto);

        if (!item) {
            return message.reply(`No se encontró ningún objeto con el ID **${idCompacto}** en el Compendio.`);
        }

        const embed = new EmbedBuilder()
            .setColor(LIST_EMBED_COLOR)
            .setTitle(item.nombre)
            .setDescription(`**ID Compacto:** \`${item.id}\``)
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

    // --- COMANDO: LISTAR ITEMS (Público) - (Se mantiene, usa la nueva función con IDs) ---
    if (command === 'listaritems') {
        // ... (Lógica de listar, usa createItemEmbedPage) ...
    }

    // --- COMANDO: CREAR PERSONAJE/TUPPER (Público) - (Se mantiene) ---
    if (command === 'crearpersonaje') {
        // ... (Lógica de creación, se mantiene) ...
    }

    // ... (Otros comandos de personaje, staff y enemigos se mantienen) ...

    // --- COMANDO: CREAR COFRE (Staff) - MODIFICADO para ID y GIF OPCIONAL ---
    if (command === 'crearcofre') {
        if (!hasAdminPerms) {
            return message.reply('¡Solo los Administradores Canon pueden crear cofres!');
        }

        const fullCommandContent = message.content.slice(PREFIX.length + command.length).trim();

        // Regex mejorada para capturar hasta 3 strings entre comillas
        const quotedRegex = /"([^"]+)"/g;
        const matches = [...fullCommandContent.matchAll(quotedRegex)];
        
        const argsList = fullCommandContent.split(/\s+/);
        const canalId = argsList[0].replace(/<#|>/g, '');

        if (!canalId || matches.length < 2) {
            return message.reply('Sintaxis incorrecta. Uso: `!Zcrearcofre <CanalID> "Tipo (pequeño/grande/jefe)" "ID Compacto del Item" ["URL de GIF opcional"]`');
        }

        const tipoCofre = matches[0][1].toLowerCase();
        const itemIdInput = matches[1][1];
        const customGifUrl = matches.length > 2 ? matches[2][1] : DEFAULT_TREASURE_GIF;

        // Se usa el ID compacto, sin importar cómo lo haya escrito el staff
        const itemIdCompacto = generarKeyLimpia(itemIdInput); 

        const cofre = CHEST_TYPES[tipoCofre];
        // Buscamos con el ID compacto
        const item = await compendioDB.get(itemIdCompacto); 

        if (!cofre) {
            return message.reply(`Tipo de cofre inválido. Tipos permitidos: \`${Object.keys(CHEST_TYPES).join(', ')}\`.`);
        }
        if (!item) {
            return message.reply(`El item con ID **${itemIdCompacto}** no está registrado en el compendio.`);
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
            // Se muestra el item name y su ID para que el staff lo valide
            .setFooter({ text: `Pulsa el botón para interactuar. Contiene: ${item.nombre} (ID: ${item.id})` }); 

        // Codificamos el GIF por si la URL tiene caracteres especiales (como la URL que enviaste)
        const encodedGif = encodeURIComponent(customGifUrl);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                // El custom ID ahora lleva: ID Compacto - Tipo de Cofre - GIF Codificado
                .setCustomId(`open_chest_${itemIdCompacto}-${tipoCofre}-${encodedGif}`)
                .setLabel(`Abrir ${cofre.nombre}`)
                .setStyle(ButtonStyle.Success)
        );

        targetChannel.send({ embeds: [treasureEmbed], components: [row] });
        message.reply(`✅ **${cofre.nombre}** creado en ${targetChannel} con el item **${item.nombre}** (ID: \`${item.id}\`) dentro.${customGifUrl !== DEFAULT_TREASURE_GIF ? ' **(Usando GIF Personalizado)**' : ''}`);
    }

    // --- COMANDO: LISTAR ENEMIGOS (Público) - (Se mantiene) ---
});

client.login(process.env.DISCORD_TOKEN);