// Carga la librería 'dotenv' para leer el archivo .env (donde está el Token secreto)
require('dotenv').config();

// Importa las clases necesarias de discord.js
const {
    Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder
} = require('discord.js');

// --- LIBRERÍAS DE PERSISTENCIA (KEYV/REDIS) ---
// Keyv es una librería de base de datos Key-Value.
// Usaremos la URL de REDIS para una base de datos externa rápida.
const Keyv = require('keyv');

// =========================================================================
// === CONFIGURACIÓN Y DEFINICIONES ===
// =========================================================================

// COLORES DE EMBEDS
const LIST_EMBED_COLOR = '#427522';       // Compendio y General (Verde)
const ENEMY_EMBED_COLOR = '#E82A2A';      // Enemigos (Rojo)
const TREASURE_EMBED_COLOR = '#634024';   // Cofres (Marrón)
const REWARD_EMBED_COLOR = '#F7BD28';     // Recompensa de Cofre (Amarillo)
const DELETE_EMBED_COLOR = '#cc0000';     // Borrado (Rojo Oscuro)
const PREFIX = '!Z';

// ID del rol de Administrador que puede usar los comandos de Staff (Ajustar al ID de tu servidor)
const ADMIN_ROLE_ID = "1420026299090731050"; 

// Palabras clave para la gestión de ítems
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

// GIF DE LINK LEVANTANDO EL TESORO (URL proporcionada por el usuario)
const DEFAULT_TREASURE_GIF = "https://cdn.discordapp.com/attachments/1271207734817329192/1421231688335228968/8bit-link.gif?ex=68d848a7&is=68d6f727&hm=cf8a4e8635b95951165407aae911d8bd1a07c58e2f6aca27a7db466943daf8c9&";

// RUPÍAS INICIALES PARA NUEVOS PERSONAJES (NUEVO)
const RUPPIAS_INICIALES = 100;

// --- ESTRUCTURA DE DATOS: KEYV (REDIS) ---
// Configuración de las bases de datos externas
const compendioDB = new Keyv(process.env.REDIS_URL, { namespace: 'items' });
const enemigosDB = new Keyv(process.env.REDIS_URL, { namespace: 'enemies' });
const personajesDB = new Keyv(process.env.REDIS_URL, { namespace: 'personajes' }); 

// Manejo de errores de conexión de DB
compendioDB.on('error', err => console.error('Error de conexión a CompendioDB:', err));
enemigosDB.on('error', err => console.error('Error de conexión a EnemigosDB:', err));
personajesDB.on('error', err => console.error('Error de conexión a PersonajesDB:', err));

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

/**
 * Obtiene todos los enemigos registrados en la base de datos.
 * @returns {Promise<Array>} Lista de objetos enemigos.
 */
async function obtenerTodosEnemigos() {
    const enemies = {};
    for await (const [key, value] of enemigosDB.iterator()) {
        enemies[key] = value;
    }
    const enemiesArray = Object.values(enemies);
    enemiesArray.sort((a, b) => (a.fechaCreacionMs || 0) - (b.fechaCreacionMs || 0));
    return enemiesArray;
}

/**
 * Obtiene todos los ítems registrados en la base de datos.
 * @returns {Promise<Array>} Lista de objetos ítems.
 */
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
 * Obtiene todos los personajes (inventarios) de un usuario.
 * @param {string} userId - La ID de Discord del usuario propietario.
 * @returns {Promise<Array<Object>>} Lista de objetos de personajes.
 */
async function obtenerPersonajesDeUsuario(userId) {
    const personajes = [];
    const prefix = `${userId}:`;
    for await (const [key, value] of personajesDB.iterator(prefix)) {
        // Aseguramos la estructura mínima si faltan campos
        if (!value.objetos) value.objetos = [];
        if (value.rupia && !value.rupias) value.rupias = value.rupia; // Migración simple si se usa la key antigua
        if (!value.rupias) value.rupias = 0;
        
        personajes.push(value);
    }
    return personajes;
}

/**
 * Genera la clave limpia para cualquier entrada de la DB (Item o Personaje).
 * [NUEVO: ID COMPACTO]
 * @param {string} nombre - El nombre con espacios, apóstrofes, etc.
 * @returns {string} La clave limpia, sin espacios, solo letras y números. (ej: 'palodeku').
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
    // La clave del personaje MANTIENE el guion bajo como separador de palabras, para legibilidad en la DB.
    // Usamos el nombre limpio, pero manteniendo el separador de palabras.
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
    // Aseguramos que la key sea 'rupias' y no 'rupia' (migración)
    if (typeof personaje.rupia === 'number' && !personaje.rupias) {
        personaje.rupias = personaje.rupia;
        delete personaje.rupia;
    }
    if (!personaje.rupias) {
        personaje.rupias = 0;
    }

    // Usamos el ID compacto para el inventario
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
 * Realiza la migración de rupias de un inventario existente (Antigua lógica de rupia como item a rupia como contador).
 * @param {object} personaje - El objeto del personaje a migrar.
 * @returns {Promise<boolean>} True si se realizó alguna migración.
 */
async function migrarRupias(personaje) {
    if (!personaje || !personaje.objetos || !personaje.propietarioId || !personaje.nombre) {
        return false;
    }

    let itemsNoMoneda = [];
    let cambiosRealizados = false;
    
    // Si ya tiene el campo 'rupias', solo necesitamos migrar los objetos de tipo 'moneda' que queden.
    if (!personaje.rupias) personaje.rupias = 0;

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
 * ELIMINA TODOS los personajes (inventarios) de un usuario. [NUEVO]
 * @param {string} userId - ID del usuario.
 * @returns {Promise<number>} El número de personajes eliminados.
 */
async function deleteAllPersonajes(userId) {
    let deletedCount = 0;
    const prefix = `${userId}:`;

    // Keyv no tiene un método de borrado por prefijo directo, así que iteramos y borramos.
    for await (const [key, value] of personajesDB.iterator(prefix)) {
        if (key.startsWith(prefix)) {
            await personajesDB.delete(key);
            deletedCount++;
        }
    }
    return deletedCount;
}

/**
 * Simula la obtención del avatar del tupper. (Función de ayuda)
 * @param {object} client - El cliente de Discord.
 * @param {string} characterName - Nombre del personaje.
 * @param {object} member - El miembro de Discord.
 * @returns {string} URL del avatar.
 */
async function getTupperAvatar(client, characterName, member) {
    // Si usas Tupperbox o Similar, esta función se conectaría a esa API o DB.
    // Por ahora, solo devolveremos el avatar del usuario como fallback.
    return member.user.displayAvatarURL({ dynamic: true });
}

/**
 * Maneja la lógica de obtener el objeto del compendio, asignarlo al personaje
 * y enviar el mensaje de confirmación (tanto para objetos como para monedas).
 * @param {string} userId - ID del usuario.
 * @param {string} itemIdCompacto - ID compacto del item (ej: 'rupiaazul').
 * @param {string} characterId - ID limpio del personaje (ej: 'mikato_tale_tsubashaki').
 * @param {object} interaction - El objeto de la interacción.
 * @param {string} treasureGif - URL del GIF a usar para el tesoro. [NUEVO/MODIFICADO]
 */
async function manejarAsignacionCofre(userId, itemIdCompacto, characterId, interaction, treasureGif) {
    // characterId viene con guiones bajos (ej: 'link_heroe'). Lo convertimos a nombre real para generar la key.
    const characterName = characterId.replace(/_/g, ' '); 
    const characterKey = generarPersonajeKey(userId, characterName); 
    
    // El item se busca directamente con el ID COMPACTO
    const item = await compendioDB.get(itemIdCompacto);

    if (!item) {
        return interaction.followUp({ content: `Error: El objeto con ID compacto **${itemIdCompacto}** ya no existe en el compendio. Notifica al staff.`, ephemeral: true });
    }

    // --- LÓGICA CRÍTICA: AÑADIR ITEM AL INVENTARIO (incluye Rupias) ---
    const success = await agregarItemAInventario(characterKey, item);

    if (success) {
        // Borramos el mensaje de selección para limpiar el canal
        if (interaction.message && interaction.message.delete) {
            await interaction.message.delete().catch(console.error);
        }

        const isMoneda = item.tipo === 'moneda';
        const articulo = isMoneda ? 'una' : 'un';
        
        // Recuperamos el personaje para el conteo de rupias actualizado
        const personajeActualizado = await personajesDB.get(characterKey);

        const rewardEmbed = new EmbedBuilder()
            .setColor(REWARD_EMBED_COLOR)
            .setTitle(`✨ ¡${characterName} ha encontrado ${articulo} ${item.nombre}! ✨`)
            .setThumbnail(item.imagen)
            .setImage(treasureGif) // USA EL GIF PASADO COMO ARGUMENTO
            .setDescription(`*${item.descripcion}*`);

        if (isMoneda) {
            rewardEmbed.addFields({
                name: 'Asignación de Rupias',
                value: `Se han añadido **${item.valorRupia}** rupias. **Total de Rupias de ${characterName}:** ${personajeActualizado.rupias || 0}.`,
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
// === LÓGICA DE PAGINACIÓN / EMBEDS ===
// =========================================================================

/**
 * Crea la fila de botones de navegación.
 * [LÓGICA COMPLETA DEVUELTA]
 */
function createPaginationRow(currentPage, totalPages) {
    const isFirst = currentPage === 0;
    const isLast = currentPage === totalPages - 1;

    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('first')
            .setLabel('«')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(isFirst),
        new ButtonBuilder()
            .setCustomId('prev')
            .setLabel('‹')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(isFirst),
        new ButtonBuilder()
            .setCustomId('next')
            .setLabel('›')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(isLast || totalPages === 0),
        new ButtonBuilder()
            .setCustomId('last')
            .setLabel('»')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(isLast || totalPages === 0)
    );
}

/**
 * Crea el embed para una página del listado de ítems.
 * [LÓGICA COMPLETA DEVUELTA - Incluye el ID Compacto]
 */
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
        .setFooter({ text: `Página ${pageIndex + 1} de ${totalPages} | Usa los botones para navegar.` });

    if (itemsToShow.length === 0) {
        embed.setDescription('No hay objetos registrados en esta página.');
    }

    itemsToShow.forEach(p => {
        // Se añade el ID compacto al campo 'name'
        embed.addFields({
            name: `**${p.nombre}** (ID: ${p.id})`,
            value: `**Descripción:** *${p.descripcion}*\n**Tipo:** ${p.tipo.toUpperCase()} | **Valor (Rupias):** ${p.tipo === 'moneda' ? p.valorRupia : 0}`,
            inline: false
        });
    });

    return { embed, totalPages };
}

/**
 * Crea el embed para una página del listado de enemigos.
 * [LÓGICA COMPLETA DEVUELTA]
 */
function createEnemyEmbedPage(enemies, pageIndex) {
    const ENEMIES_PER_PAGE = 5;
    const start = pageIndex * ENEMIES_PER_PAGE;
    const end = start + ENEMIES_PER_PAGE;
    const enemiesToShow = enemies.slice(start, end);
    const totalPages = Math.ceil(enemies.length / ENEMIES_PER_PAGE);

    const embed = new EmbedBuilder()
        .setColor(ENEMY_EMBED_COLOR)
        .setTitle('👹 Compendio de Enemigos de Hyrule 👹')
        .setDescription(`*Página ${pageIndex + 1} de ${totalPages}. Solo se muestran ${ENEMIES_PER_PAGE} enemigos por página.*`)
        .setFooter({ text: `Página ${pageIndex + 1} de ${totalPages} | Usa los botones para navegar.` });

    if (enemiesToShow.length === 0) {
        embed.setDescription('No hay enemigos registrados en esta página.');
    }

    enemiesToShow.forEach(e => {
        embed.addFields({
            name: `**${e.nombre}**`,
            value: `**Descripción:** *${e.descripcion}*\n**Debilidad:** ${e.debilidad.toUpperCase()} | **HP Base:** ${e.hpBase}`,
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
    // 1. Lógica de Paginación para Compendio de Ítems y Enemigos
    if (interaction.isButton()) {
        const [action] = interaction.customId.split('_');

        if (['first', 'prev', 'next', 'last'].includes(action)) {
            await interaction.deferUpdate();

            const embed = interaction.message.embeds[0];
            const footerText = embed.footer.text;
            const isItem = footerText.includes('Compendio de Objetos');
            const isEnemy = footerText.includes('Compendio de Enemigos');

            if (!isItem && !isEnemy) return;

            // Extraer la página actual y el total de páginas del footer
            const match = footerText.match(/Página (\d+) de (\d+)/);
            if (!match) return;
            
            const currentPage = parseInt(match[1]) - 1; // 0-indexed
            const totalPages = parseInt(match[2]);

            let newPage = currentPage;

            switch (action) {
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

            if (newPage === currentPage) return;

            let newEmbed, newTotalPages, itemsOrEnemies;

            if (isItem) {
                itemsOrEnemies = await obtenerTodosItems();
                ({ embed: newEmbed, totalPages: newTotalPages } = createItemEmbedPage(itemsOrEnemies, newPage));
            } else { // isEnemy
                itemsOrEnemies = await obtenerTodosEnemigos();
                ({ embed: newEmbed, totalPages: newTotalPages } = createEnemyEmbedPage(itemsOrEnemies, newPage));
            }

            const newRow = createPaginationRow(newPage, newTotalPages);

            await interaction.editReply({ embeds: [newEmbed], components: [newRow] });
            return;
        }
    }

    // 2. Lógica de Apertura de Cofre - MODIFICADO para ID COMPACTO y GIF
    if (interaction.isButton() && interaction.customId.startsWith('open_chest_')) {
        await interaction.deferReply({ ephemeral: false });

        const fullId = interaction.customId.replace('open_chest_', '');
        // El ID completo ahora es: itemIdCompacto-tipoCofre-urlGifCodificada
        const parts = fullId.split('-'); 
        
        const itemIdCompacto = parts[0];
        const chestType = parts[1];
        // Si existe el tercer elemento, es el GIF personalizado. Si no, usa el por defecto.
        const customGif = parts.length > 2 ? decodeURIComponent(parts[2]) : DEFAULT_TREASURE_GIF; 

        // Buscar el item por el ID COMPACTO
        const item = await compendioDB.get(itemIdCompacto);
        const cofreInfo = CHEST_TYPES[chestType || 'pequeño']; 

        if (interaction.message.components.length === 0 || interaction.message.components[0].components[0].disabled) {
            return interaction.followUp({ content: 'Este cofre ya ha sido abierto.', ephemeral: true });
        }

        if (!item) {
            return interaction.followUp({ content: `El tesoro con ID **${itemIdCompacto}** no se encontró. Notifica al Staff.`, ephemeral: true });
        }

        const allCharacters = await obtenerPersonajesDeUsuario(interaction.user.id);
        
        if (allCharacters.length === 0) {
            await interaction.message.edit({components: []}).catch(console.error); // Deshabilitar botón
            return interaction.followUp({ content: 'No tienes personajes (tuppers) registrados para recibir este objeto. Usa `!Zcrearpersonaje "Nombre"` primero.', ephemeral: true });
        }

        // Deshabilitar botón del cofre original
        const disabledRow = new ActionRowBuilder().addComponents(
            interaction.message.components[0].components[0].setDisabled(true)
        );
        await interaction.message.edit({ components: [disabledRow] }).catch(console.error);
        
        const options = allCharacters.map(char => ({
            // Label es el nombre real con espacios
            label: char.nombre,
            // Value es el nombre limpio con guiones bajos para el customId
            value: char.nombre.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '_')
        }));

        // El customId ahora lleva: itemIdCompacto, tipoCofre, y el GIF codificado
        const selectRow = new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId(`assign_item_${itemIdCompacto}_${chestType}_${encodeURIComponent(customGif)}`) 
                .setPlaceholder(`Selecciona el personaje...`)
                .addOptions(options)
        );

        // Mensaje de cofre encontrado
        return interaction.followUp({
            content: `${interaction.user}, ¡Has encontrado un **${cofreInfo.nombre}**! ¿A qué personaje (Tupper) quieres asignarle el tesoro?`,
            components: [selectRow],
            ephemeral: false // Esto debe ser público para que todos vean el anuncio
        });
    }

    // 3. Lógica de Asignación por Select (cuando se pulsa el dropdown) - MODIFICADO
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('assign_item_')) {
        // Deferir para que la respuesta pueda ser pública y tomar tiempo
        await interaction.deferUpdate({ ephemeral: false });

        const parts = interaction.customId.split('_');
        // parts[2] = itemIdCompacto
        // parts[3] = chestType
        // parts[4] = urlGif (codificada)

        const itemIdCompacto = parts[2];
        const treasureGif = parts[4] ? decodeURIComponent(parts[4]) : DEFAULT_TREASURE_GIF;

        const characterId = interaction.values[0];

        // Verificación de propiedad: solo el usuario que inició la interacción puede completar el proceso
        if (interaction.message.content.includes(interaction.user.id) === false) {
             // Revertir el estado del cofre para que el dueño pueda reabrirlo (lógica opcional, aquí solo se ignora)
            return interaction.followUp({ content: 'Esta asignación es solo para el usuario que abrió el cofre.', ephemeral: true });
        }

        // Llamar a la función centralizada para manejar la asignación, ahora pasando el GIF
        return manejarAsignacionCofre(interaction.user.id, itemIdCompacto, characterId, interaction, treasureGif);
    }
    
    // 4. Lógica de Confirmación de Borrado de Personajes (Botón) - NUEVO
    if (interaction.isButton() && interaction.customId === 'confirm_delete_all_characters') {
        await interaction.deferUpdate();

        // Verificar que el usuario que pulsa el botón es el mismo que ejecutó el comando
        const originalUserId = interaction.message.embeds[0].footer.text.match(/Usuario: (\d+)/)[1];
        
        if (interaction.user.id !== originalUserId) {
            return interaction.followUp({ content: 'Solo el usuario que inició la solicitud puede confirmar el borrado.', ephemeral: true });
        }

        const count = await deleteAllPersonajes(interaction.user.id);

        const deleteEmbed = new EmbedBuilder()
            .setColor(DELETE_EMBED_COLOR)
            .setTitle('🚨 ¡BORRADO TOTAL CONFIRMADO! 🚨')
            .setDescription(`Se han eliminado permanentemente **${count}** personajes (inventarios) vinculados a tu cuenta.`);

        await interaction.editReply({ embeds: [deleteEmbed], components: [] });
    }

    if (interaction.isButton() && interaction.customId === 'cancel_delete_all_characters') {
        await interaction.deferUpdate();
        
        const originalUserId = interaction.message.embeds[0].footer.text.match(/Usuario: (\d+)/)[1];
        
        if (interaction.user.id !== originalUserId) {
            return interaction.followUp({ content: 'Solo el usuario que inició la solicitud puede cancelar.', ephemeral: true });
        }
        
        const cancelEmbed = new EmbedBuilder()
            .setColor(LIST_EMBED_COLOR)
            .setTitle('✅ Borrado Cancelado')
            .setDescription('La operación de borrado masivo de personajes ha sido cancelada.');

        await interaction.editReply({ embeds: [cancelEmbed], components: [] });
    }
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;

    const content = message.content.trim();
    if (!content.startsWith(PREFIX)) return;

    const fullCommand = content.slice(PREFIX.length).trim();
    const args = fullCommand.split(/\s+/);
    const command = args[0].toLowerCase();

    const member = message.member;
    // Permisos de Admin (Staff)
    const hasAdminPerms = member && member.roles.cache.has(ADMIN_ROLE_ID);
    
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
            const valorIndex = message.content.indexOf('"', matches[3].index) + matches[3][1].length + 1;
            const remainingString = message.content.substring(valorIndex).trim();
            const rupiaMatch = remainingString.match(/"(\d+)"/);
            
            if (rupiaMatch) {
                valorRupia = parseInt(rupiaMatch[1]);
            } else {
                return message.reply('Para objetos de tipo "moneda", debes especificar el valor de la Rupia entre comillas (ej: `"20"`).');
            }
        }

        // USAMOS LA CLAVE COMPACTA (sin espacios ni guiones bajos)
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
            .setColor(DELETE_EMBED_COLOR)
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
                { name: 'Valor (Rupias)', value: item.tipo === 'moneda' ? item.valorRupia.toString() : 'N/A', inline: true },
                { name: 'Fecha de Registro', value: item.fecha, inline: true }
            )
            .setImage(item.imagen)
            .setFooter({ text: `Registrado por: ${item.registradoPor}` });

        message.channel.send({ embeds: [embed] });
    }

    // --- COMANDO: LISTAR ITEMS (Público) - LÓGICA COMPLETA ---
    if (command === 'listaritems') {
        const allItems = await obtenerTodosItems();
        if (allItems.length === 0) {
            return message.reply('El Compendio de objetos está vacío. ¡El Staff debe registrar algo primero!');
        }

        const { embed, totalPages } = createItemEmbedPage(allItems, 0);
        const row = createPaginationRow(0, totalPages);
        
        message.channel.send({ embeds: [embed], components: [row] });
    }

    // --- COMANDO: CREAR ENEMIGO (Staff) - LÓGICA COMPLETA ---
    if (command === 'crearenemigo') {
        if (!hasAdminPerms) {
            return message.reply('Solo los Administradores Canon pueden registrar enemigos.');
        }

        const regex = /"([^"]+)"/g;
        const matches = [...message.content.matchAll(regex)];
        const numExpected = 4;

        if (matches.length < numExpected) {
            return message.reply('Sintaxis incorrecta. Uso: `!Zcrearenemigo "Nombre" "Descripción" "Debilidad" "HP Base" ["URL de Imagen"]`');
        }

        const nombre = matches[0][1];
        const descripcion = matches[1][1];
        const debilidad = matches[2][1];
        const hpBase = parseInt(matches[3][1]);
        const imagenUrl = matches.length > 4 ? matches[4][1] : '';

        if (isNaN(hpBase) || hpBase <= 0) {
            return message.reply('El HP Base debe ser un número positivo.');
        }

        const idCompacto = generarKeyLimpia(nombre);
        const existingEnemy = await enemigosDB.get(idCompacto);
        if (existingEnemy) {
            return message.reply(`¡El enemigo **${nombre}** ya está registrado!`);
        }

        const now = new Date();
        const newEnemy = {
            nombre: nombre,
            descripcion: descripcion,
            debilidad: debilidad,
            hpBase: hpBase,
            imagen: imagenUrl,
            registradoPor: message.author.tag,
            fecha: now.toLocaleDateString('es-ES'),
            fechaCreacionMs: now.getTime(),
            id: idCompacto
        };

        await enemigosDB.set(idCompacto, newEnemy);

        const embed = new EmbedBuilder()
            .setColor(ENEMY_EMBED_COLOR)
            .setTitle(`👹 Enemigo Registrado: ${nombre}`)
            .setDescription(`Un nuevo peligro acecha en Hyrule.`)
            .addFields(
                { name: 'Descripción', value: descripcion, inline: false },
                { name: 'Debilidad', value: debilidad.toUpperCase(), inline: true },
                { name: 'HP Base', value: hpBase.toString(), inline: true }
            )
            .setImage(imagenUrl)
            .setFooter({ text: `Registrado por: ${message.author.tag}` });

        message.channel.send({ embeds: [embed] });
    }

    // --- COMANDO: LISTAR ENEMIGOS (Público) - LÓGICA COMPLETA ---
    if (command === 'listarenemigos') {
        const allEnemies = await obtenerTodosEnemigos();
        if (allEnemies.length === 0) {
            return message.reply('No hay enemigos registrados en el Compendio.');
        }

        const { embed, totalPages } = createEnemyEmbedPage(allEnemies, 0);
        const row = createPaginationRow(0, totalPages);
        
        message.channel.send({ embeds: [embed], components: [row] });
    }

    // --- COMANDO: CREAR PERSONAJE/TUPPER (Público) - MODIFICADO (100 Rupias) ---
    if (command === 'crearpersonaje') {
        const regex = /"([^"]+)"/;
        const match = fullCommand.match(regex);

        if (!match) {
            return message.reply('Uso: `!Zcrearpersonaje "Nombre del Personaje/Tupper"`');
        }

        const nombre = match[1];
        const personajeKey = generarPersonajeKey(message.author.id, nombre);

        const existingPersonaje = await personajesDB.get(personajeKey);
        if (existingPersonaje) {
            return message.reply(`¡Ya tienes un personaje llamado **${nombre}** registrado!`);
        }
        
        // --- INICIALIZACIÓN CON 100 RUPIAS (NUEVO) ---
        const newPersonaje = {
            nombre: nombre,
            propietarioId: message.author.id,
            objetos: [],
            rupias: RUPPIAS_INICIALES, // 100 Rupias iniciales
            fechaCreacion: new Date().toLocaleDateString('es-ES'),
        };

        await personajesDB.set(personajeKey, newPersonaje);

        const embed = new EmbedBuilder()
            .setColor(LIST_EMBED_COLOR)
            .setTitle(`👤 Personaje Creado: ${nombre}`)
            .setDescription(`¡Bienvenido a Hyrule, **${nombre}**!`)
            .setThumbnail(await getTupperAvatar(client, nombre, member))
            .addFields(
                { name: 'Propietario', value: message.author.tag, inline: true },
                { name: 'Inventario Inicial', value: `**${RUPPIAS_INICIALES} Rupias** y 0 Objetos`, inline: true }
            )
            .setFooter({ text: `Usa !Zinventario "${nombre}" para ver tu botín.` });

        message.channel.send({ embeds: [embed] });
    }
    
    // --- COMANDO: VER INVENTARIO (Público) - LÓGICA COMPLETA ---
    if (command === 'inventario' || command === 'verinventario') {
        const regex = /"([^"]+)"/;
        const match = fullCommand.match(regex);

        if (!match) {
            return message.reply('Uso: `!Zinventario "Nombre del Personaje/Tupper"`');
        }

        const nombre = match[1];
        const personajeKey = generarPersonajeKey(message.author.id, nombre);
        let personaje = await personajesDB.get(personajeKey);

        if (!personaje) {
            return message.reply(`No se encontró ningún personaje llamado **${nombre}** vinculado a tu cuenta.`);
        }
        
        // Asegurar la migración de rupias si es necesario
        await migrarRupias(personaje);
        personaje = await personajesDB.get(personajeKey); // Recargar datos

        const objetosList = personaje.objetos.map(item => `• ${item.nombre} (ID: ${item.id})`).join('\n') || '*(Inventario vacío)*';
        const rupiasTotal = personaje.rupias || 0;

        const embed = new EmbedBuilder()
            .setColor(LIST_EMBED_COLOR)
            .setTitle(`🎒 Inventario de ${nombre}`)
            .setThumbnail(await getTupperAvatar(client, nombre, member))
            .addFields(
                { name: '💰 Rupias', value: `**${rupiasTotal}**`, inline: true },
                { name: '✨ Objetos Especiales', value: objetosList, inline: false }
            )
            .setFooter({ text: `Propietario: ${message.author.tag} | Creado el ${personaje.fechaCreacion}` });

        message.channel.send({ embeds: [embed] });
    }
    
    // --- COMANDO: BORRAR PERSONAJES (Público/Confirmación) - NUEVO ---
    if (command === 'borrarpersonajes') {
        const allCharacters = await obtenerPersonajesDeUsuario(message.author.id);
        
        if (allCharacters.length === 0) {
            return message.reply('No tienes personajes registrados para borrar.');
        }

        const characterNames = allCharacters.map(c => `• ${c.nombre}`).join('\n');
        
        const warningEmbed = new EmbedBuilder()
            .setColor(DELETE_EMBED_COLOR)
            .setTitle('⚠️ ¡ADVERTENCIA DE BORRADO MASIVO! ⚠️')
            .setDescription('Estás a punto de **eliminar permanentemente** los siguientes personajes y **TODO SU INVENTARIO**:')
            .addFields({ name: `Personajes a Eliminar (${allCharacters.length})`, value: characterNames, inline: false })
            .setFooter({ text: `Esta acción es IRREVERSIBLE. Pulsa CONFIRMAR. | Usuario: ${message.author.id}` });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('confirm_delete_all_characters')
                .setLabel('CONFIRMAR ELIMINACIÓN TOTAL')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('cancel_delete_all_characters')
                .setLabel('Cancelar')
                .setStyle(ButtonStyle.Secondary)
        );

        message.channel.send({ content: `${message.author}, por favor, confirma la eliminación.`, embeds: [warningEmbed], components: [row] });
    }


    // --- COMANDO: CREAR COFRE (Staff) - MODIFICADO para ID y GIF OPCIONAL ---
    if (command === 'crearcofre') {
        if (!hasAdminPerms) {
            return message.reply('¡Solo los Administradores Canon pueden crear cofres!');
        }

        const fullCommandContent = message.content.slice(PREFIX.length + command.length).trim();

        // Regex para capturar hasta 3 strings entre comillas
        const quotedRegex = /"([^"]+)"/g;
        const matches = [...fullCommandContent.matchAll(quotedRegex)];
        
        // El primer argumento sin comillas debe ser el Canal ID
        const argsList = fullCommandContent.split(/\s+/);
        const canalId = argsList[0].replace(/<#|>/g, '');

        if (!canalId || matches.length < 2) {
            return message.reply('Sintaxis incorrecta. Uso: `!Zcrearcofre <CanalID> "Tipo (pequeño/grande/jefe)" "ID Compacto del Item" ["URL de GIF opcional"]`');
        }

        const tipoCofre = matches[0][1].toLowerCase();
        const itemIdInput = matches[1][1];
        // El tercer match, si existe, es el GIF personalizado. Si no, usamos el por defecto.
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
            return message.reply(`El item con ID **${itemIdCompacto}** no está registrado en el compendio. Usa \`!Zcrearitem\` o revisa \`!Zveritem\``);
        }

        const targetChannel = client.channels.cache.get(canalId);
        if (!targetChannel) {
            return message.reply('No se pudo encontrar ese Canal ID. Asegúrate de que el bot tenga acceso.');
        }

        const treasureEmbed = new EmbedBuilder()
            .setColor(TREASURE_EMBED_COLOR)
            .setTitle(`🔑 ¡Tesoro Encontrado! 🎁`)
            .setDescription(`¡Un **${cofre.nombre}** ha aparecido de la nada! ¡Ábrelo para revelar el tesoro!`)
            .setThumbnail(cofre.img)
            // Se muestra el item name y su ID para que el staff lo valide
            .setFooter({ text: `Pulsa el botón para interactuar. Contiene: ${item.nombre} (ID: ${item.id})` }); 

        // Codificamos el GIF por si la URL tiene caracteres especiales
        const encodedGif = encodeURIComponent(customGifUrl);

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                // El custom ID lleva: ID Compacto - Tipo de Cofre - GIF Codificado
                .setCustomId(`open_chest_${itemIdCompacto}-${tipoCofre}-${encodedGif}`)
                .setLabel(`Abrir ${cofre.nombre}`)
                .setStyle(ButtonStyle.Success)
        );

        targetChannel.send({ embeds: [treasureEmbed], components: [row] });
        message.reply(`✅ **${cofre.nombre}** creado en ${targetChannel} con el item **${item.nombre}** (ID: \`${item.id}\`) dentro.${customGifUrl !== DEFAULT_TREASURE_GIF ? ' **(Usando GIF Personalizado)**' : ''}`);
    }

    // --- COMANDO: AYUDA (Público) - LÓGICA COMPLETA ---
    if (command === '-help') {
        const helpEmbed = new EmbedBuilder()
            .setColor(LIST_EMBED_COLOR)
            .setTitle('📖 Guía de Comandos del Bot de Hyrule')
            .setDescription(`Prefijo: \`${PREFIX}\``)
            .addFields(
                {
                    name: '👤 Comandos de Personaje (Públicos)',
                    value: '`!Zcrearpersonaje "Nombre"`: Registra tu Tupper como personaje (inicia con 100 rupias).\n`!Zinventario "Nombre"`: Muestra tu inventario y rupias.\n`!Zborrarpersonajes`: Inicia el proceso de borrado de TODOS tus personajes (requiere confirmación).'
                },
                {
                    name: '📚 Comandos de Compendio (Públicos)',
                    value: '`!Zlistaritems`: Lista todos los objetos del compendio.\n`!Zlistarenemigos`: Lista todos los enemigos.\n`!Zveritem "ID"`: Muestra los detalles de un objeto por su ID Compacto.'
                },
                {
                    name: '🛠️ Comandos de Staff (Admin Canon)',
                    value: '`!Zcrearitem "Nombre" "Desc" "Tipo" "URL"`: Registra un nuevo objeto.\n`!Zeliminaritem "ID"`: Elimina un objeto por ID Compacto.\n`!Zcrearenemigo "Nombre" "Desc" "Debilidad" "HP"`: Registra un enemigo.\n`!Zcrearcofre <#Canal> "Tipo" "ID Item" ["URL GIF"]`: Genera un cofre interactivo con el item especificado.'
                }
            )
            .setFooter({ text: 'Los IDs Compactos son los nombres de objetos sin espacios ni caracteres especiales (ej. "Palo Deku" es "palodeku").' });
        
        message.channel.send({ embeds: [helpEmbed] });
    }
});

client.login(process.env.DISCORD_TOKEN);