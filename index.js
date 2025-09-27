import { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } from 'discord.js';
import { Level } from 'level';
import 'dotenv/config';

// --- CONFIGURACIÓN ---
const PREFIX = '!Z';
const ADMIN_ROLE_ID = process.env.ADMIN_ROLE_ID || '1420026299090731050'; // ¡IMPORTANTE! Reemplazar con el ID real del rol de Staff/Admin
const REWARD_EMBED_COLOR = '#00ff00'; // Verde
const ENEMY_EMBED_COLOR = '#ff0000'; // Rojo
const LIST_EMBED_COLOR = '#0099ff'; // Azul
const TREASURE_EMBED_COLOR = '#ffcc00'; // Dorado/Amarillo
const PAGE_SIZE = 10;

// Tipos de Cofre (para la invocación y el embed visual)
const CHEST_TYPES = {
    'pequeño': {
        nombre: 'Cofre Pequeño',
        img: 'https://placehold.co/100x100/ffcc00/000000?text=Cofre+P' // Placeholder
    },
    'grande': {
        nombre: 'Cofre Grande',
        img: 'https://placehold.co/100x100/ffcc00/000000?text=Cofre+G' // Placeholder
    },
    'jefe': {
        nombre: 'Cofre de Jefe',
        img: 'https://placehold.co/100x100/ffcc00/000000?text=Cofre+J' // Placeholder
    },
};


// --- BASE DE DATOS ---
const personajesDB = new Level('./db/personajes', { valueEncoding: 'json' });
const compendioDB = new Level('./db/compendio', { valueEncoding: 'json' });
const enemigosDB = new Level('./db/enemigos', { valueEncoding: 'json' });


// --- CLIENTE DISCORD ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// --- FUNCIONES DE UTILIDAD ---

/**
 * Genera una clave limpia, minúscula y sin espacios a partir de un string.
 * @param {string} str El string a limpiar.
 * @returns {string} La clave limpia.
 */
function generarKeyLimpia(str) {
    return str.toLowerCase().replace(/\s/g, '_');
}

/**
 * Genera la clave única para un personaje (userId:nombreLimpio).
 * @param {string} userId ID del usuario propietario.
 * @param {string} nombre Nombre del personaje.
 * @returns {string} La clave única.
 */
function generarPersonajeKey(userId, nombre) {
    return `${userId}:${generarKeyLimpia(nombre)}`;
}

/**
 * Añade un item al inventario de un personaje y actualiza la DB.
 * @param {string} personajeKey La clave única del personaje.
 * @param {object} item El objeto item a añadir.
 * @returns {Promise<boolean>} True si se añadió, False si el personaje no existe.
 */
async function agregarItemAInventario(personajeKey, item) {
    try {
        let personaje = await personajesDB.get(personajeKey);

        // Clonar el item para asegurar que si se modifica, no afecte la versión del compendio.
        const itemCopy = JSON.parse(JSON.stringify(item));
        
        // Asignar un ID único (basado en timestamp) si no lo tiene (para diferenciar stacks)
        itemCopy.itemId = Date.now(); 

        if (!personaje.objetos) {
            personaje.objetos = [];
        }
        personaje.objetos.push(itemCopy);
        await personajesDB.set(personajeKey, personaje);
        return true;
    } catch (error) {
        if (error.code === 'NotFoundError') {
            return false;
        }
        console.error('Error al agregar item al inventario:', error);
        return false;
    }
}

/**
 * Obtiene todos los items del compendio de la DB.
 * @returns {Promise<Array<object>>} Lista de todos los items.
 */
async function obtenerTodosItems() {
    const items = [];
    for await (const [, value] of compendioDB.iterator()) {
        items.push(value);
    }
    return items;
}

/**
 * Obtiene todos los enemigos de la DB.
 * @returns {Promise<Array<object>>} Lista de todos los enemigos.
 */
async function obtenerTodosEnemigos() {
    const enemigos = [];
    for await (const [, value] of enemigosDB.iterator()) {
        enemigos.push(value);
    }
    return enemigos;
}

/**
 * Crea un embed paginado para la lista de items.
 * @param {Array<object>} items Lista de items.
 * @param {number} pageNumber Número de página actual.
 * @returns {{embed: EmbedBuilder, totalPages: number}}
 */
function createItemEmbedPage(items, pageNumber) {
    const totalPages = Math.ceil(items.length / PAGE_SIZE);
    const startIndex = pageNumber * PAGE_SIZE;
    const currentItems = items.slice(startIndex, startIndex + PAGE_SIZE);

    const itemList = currentItems.map((item, index) =>
        `**${startIndex + index + 1}. ${item.nombre}**\n *${item.descripcion.slice(0, 70)}${item.descripcion.length > 70 ? '...' : ''}*`
    ).join('\n\n') || '*(El compendio está vacío)*';

    const embed = new EmbedBuilder()
        .setColor(LIST_EMBED_COLOR)
        .setTitle(`📜 Compendio de Items (${items.length} en total)`)
        .setDescription(itemList)
        .setFooter({ text: `Página ${pageNumber + 1} de ${totalPages}` });

    return { embed, totalPages };
}

/**
 * Crea un embed paginado para la lista de enemigos.
 * @param {Array<object>} enemies Lista de enemigos.
 * @param {number} pageNumber Número de página actual.
 * @returns {{embed: EmbedBuilder, totalPages: number}}
 */
function createEnemyEmbedPage(enemies, pageNumber) {
    const totalPages = Math.ceil(enemies.length / PAGE_SIZE);
    const startIndex = pageNumber * PAGE_SIZE;
    const currentEnemies = enemies.slice(startIndex, startIndex + PAGE_SIZE);

    const enemyList = currentEnemies.map((enemy, index) =>
        `**${startIndex + index + 1}. ${enemy.nombre}** | HP Base: ${enemy.hp}`
    ).join('\n') || '*(El compendio está vacío)*';

    const embed = new EmbedBuilder()
        .setColor(LIST_EMBED_COLOR)
        .setTitle(`👹 Compendio de Monstruos (${enemies.length} en total)`)
        .setDescription(enemyList)
        .setFooter({ text: `Página ${pageNumber + 1} de ${totalPages}` });

    return { embed, totalPages };
}


/**
 * Crea la fila de botones de paginación.
 * @param {number} currentPage Página actual (0-indexed).
 * @param {number} totalPages Total de páginas.
 * @returns {ActionRowBuilder} La fila de botones.
 */
function createPaginationRow(currentPage, totalPages) {
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('prev_page')
            .setLabel('Anterior')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentPage === 0),
        new ButtonBuilder()
            .setCustomId('next_page')
            .setLabel('Siguiente')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(currentPage >= totalPages - 1)
    );
    return row;
}

// --- MANEJADOR DE EVENTOS READY ---
client.on('ready', () => {
    console.log(`Bot iniciado como ${client.user.tag}`);
    client.user.setActivity('¡Zelda RPG Activo!');
});

// --- MANEJADOR DE INTERACCIONES (BOTONES) ---
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    // --- MANEJO DE PAGINACIÓN DE LISTAS ---
    if (interaction.customId === 'prev_page' || interaction.customId === 'next_page') {
        // Asumimos que la paginación viene de un embed
        const embed = interaction.message.embeds[0];
        const footerText = embed.footer.text;

        const match = footerText.match(/Página (\d+) de (\d+)/);
        if (!match) return interaction.reply({ content: 'Error de paginación.', ephemeral: true });

        let currentPage = parseInt(match[1]) - 1; // 0-indexed
        const totalPages = parseInt(match[2]);

        if (interaction.customId === 'next_page') {
            currentPage++;
        } else if (interaction.customId === 'prev_page') {
            currentPage--;
        }

        // Determinar qué lista estamos paginando (Items o Enemigos)
        let listType;
        if (embed.title.includes('Compendio de Items')) {
            listType = 'items';
        } else if (embed.title.includes('Compendio de Monstruos')) {
            listType = 'enemies';
        } else {
            return interaction.reply({ content: 'No se pudo identificar el tipo de lista.', ephemeral: true });
        }

        let newEmbed, newTotalPages, row;
        if (listType === 'items') {
            const items = await obtenerTodosItems();
            ({ embed: newEmbed, totalPages: newTotalPages } = createItemEmbedPage(items, currentPage));
        } else { // enemies
            const enemies = await obtenerTodosEnemigos();
            ({ embed: newEmbed, totalPages: newTotalPages } = createEnemyEmbedPage(enemies, currentPage));
        }

        row = createPaginationRow(currentPage, newTotalPages);

        await interaction.update({ embeds: [newEmbed], components: [row] });
    }

    // --- MANEJO DE APERTURA DE COFRES ---
    if (interaction.customId.startsWith('open_chest_')) {
        const [itemId, tipoCofre] = interaction.customId.replace('open_chest_', '').split('-');

        // Desactivar el botón para que solo una persona pueda abrirlo
        await interaction.update({ components: [] });

        const item = await compendioDB.get(itemId);
        if (!item) {
            return interaction.followUp({ content: 'Error: El item de este cofre no se encontró en el compendio.', ephemeral: true });
        }
        
        // 1. Obtener personajes del usuario
        const userPersonajes = [];
        const characterKeyPrefix = `${interaction.user.id}:`;
        for await (const [key, value] of personajesDB.iterator()) {
            if (key.startsWith(characterKeyPrefix)) {
                userPersonajes.push({ key, ...value });
            }
        }

        if (userPersonajes.length === 0) {
            return interaction.followUp({ content: 'No tienes ningún personaje (tupper) registrado para recibir este objeto. Usa `!Zcrearpersonaje "Nombre"`', ephemeral: true });
        }

        // Si solo tiene uno, lo asignamos directamente
        if (userPersonajes.length === 1) {
            const personaje = userPersonajes[0];
            const success = await agregarItemAInventario(personaje.key, item);
            
            if (success) {
                const rewardEmbed = new EmbedBuilder()
                    .setColor(REWARD_EMBED_COLOR)
                    .setTitle(`✅ ¡Obtuviste un Tesoro!`)
                    .setDescription(`${interaction.user} ha abierto el **${CHEST_TYPES[tipoCofre].nombre}** y ha encontrado un(a) **${item.nombre}**!`)
                    .addFields(
                        { name: 'Descripción', value: item.descripcion, inline: false },
                        { name: 'Asignado a', value: personaje.nombre, inline: true }
                    )
                    .setThumbnail(item.imagen);

                // Enviar el mensaje de recompensa al canal
                return interaction.channel.send({ embeds: [rewardEmbed] });
            } else {
                 // Esto no debería pasar si se ha comprobado antes, pero es una seguridad
                return interaction.followUp({ content: 'Error interno al asignar el item al inventario.', ephemeral: true });
            }

        } else {
            // Si tiene múltiples, se debería usar un SelectMenu.
            // Para simplificar, se indica que necesita transferirlo manualmente.
             return interaction.followUp({ 
                content: `Tienes múltiples personajes. El item **${item.nombre}** ha sido guardado en tu ***bóveda personal***.\n\n***Instrucciones:*** *Crea un nuevo comando para transferir items a personajes.*`,
                ephemeral: true 
            });
        }
    }
});

// --- MANEJADOR DE MENSAJES (COMANDOS) ---
client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (!message.content.startsWith(PREFIX)) return;

    const fullCommand = message.content.slice(PREFIX.length).trim();
    const command = fullCommand.split(/\s+/)[0].toLowerCase();
    const args = fullCommand.slice(command.length).trim().split(/\s+/);

    // Comprobar si es Staff (Asumimos que el Staff tiene el rol ADMIN_ROLE_ID)
    const hasAdminPerms = message.member && message.member.roles.cache.has(ADMIN_ROLE_ID);

    // --- COMANDO: CREAR ITEM (Staff) ---
    if (command === 'crearitem') {
        if (!hasAdminPerms) {
            return message.reply('¡Solo los Administradores Canon pueden registrar items!');
        }

        const regex = /"([^"]+)"/g;
        const matches = [...message.content.matchAll(regex)];

        if (matches.length < 3) {
            return message.reply('Sintaxis incorrecta. Uso: `!Zcrearitem "Nombre" "Descripción" "URL de Imagen"`');
        }

        const nombre = matches[0][1];
        const descripcion = matches[1][1];
        const imagenUrl = matches[2][1];

        const id = generarKeyLimpia(nombre);

        try {
            const existingItem = await compendioDB.get(id);
            if (existingItem) {
                return message.reply(`¡El item **${nombre}** ya está registrado!`);
            }
        } catch (error) {
            // No existe, continuar
        }

        const newItem = {
            nombre: nombre,
            descripcion: descripcion,
            imagen: imagenUrl,
            registradoPor: message.author.tag
        };

        await compendioDB.set(id, newItem);

        const embed = new EmbedBuilder()
            .setColor(REWARD_EMBED_COLOR)
            .setTitle(`✅ Item Registrado: ${nombre}`)
            .setDescription(descripcion)
            .setImage(imagenUrl);

        message.channel.send({ embeds: [embed] });
    }

    // --- COMANDO: VER ITEM (Público) ---
    if (command === 'veritem') {
        const regex = /"([^"]+)"/;
        const match = fullCommand.match(regex);

        if (!match) {
            return message.reply('Uso: `!Zveritem "Nombre Completo del Item"`');
        }

        const nombreItem = match[1];
        const id = generarKeyLimpia(nombreItem);
        
        try {
            const item = await compendioDB.get(id);
            const embed = new EmbedBuilder()
                .setColor(LIST_EMBED_COLOR)
                .setTitle(`🔎 Ficha de Item: ${item.nombre}`)
                .setDescription(item.descripcion)
                .setImage(item.imagen)
                .setFooter({ text: `Registrado por: ${item.registradoPor || 'Desconocido'}` });

            message.channel.send({ embeds: [embed] });
        } catch (error) {
            if (error.code === 'NotFoundError') {
                return message.reply(`No se encontró ningún item llamado **${nombreItem}** en el Compendio.`);
            }
            console.error(error);
            return message.reply('Ocurrió un error al buscar el item.');
        }
    }

    // --- COMANDO: ELIMINAR ITEM (Staff) ---
    if (command === 'eliminaritem') {
        if (!hasAdminPerms) {
            return message.reply('¡Solo los Administradores Canon pueden eliminar items!');
        }

        const regex = /"([^"]+)"/;
        const match = fullCommand.match(regex);

        if (!match) {
            return message.reply('Uso: `!Zeliminaritem "Nombre Completo del Item"`');
        }

        const nombreItem = match[1];
        const id = generarKeyLimpia(nombreItem);

        try {
            const itemEliminado = await compendioDB.get(id);
            await compendioDB.delete(id);

            const embed = new EmbedBuilder()
                .setColor('#cc0000')
                .setTitle(`🗑️ Item Eliminado: ${itemEliminado.nombre}`)
                .setDescription(`El item **${itemEliminado.nombre}** ha sido borrado permanentemente del compendio.`);

            message.channel.send({ embeds: [embed] });
        } catch (error) {
            if (error.code === 'NotFoundError') {
                return message.reply(`No se encontró ningún item llamado **${nombreItem}** en la base de datos.`);
            }
            console.error(error);
            return message.reply('Ocurrió un error al eliminar el item.');
        }
    }
    
    // --- COMANDO: LISTAR ITEMS (Público) ---
    if (command === 'listaritems') {
        const items = await obtenerTodosItems();

        if (items.length === 0) {
            return message.channel.send('***El Compendio de Items está vacío. ¡Que se registre la primera cosa!***');
        }

        const currentPage = 0;
        const { embed, totalPages } = createItemEmbedPage(items, currentPage);
        const row = createPaginationRow(currentPage, totalPages);

        message.channel.send({ embeds: [embed], components: [row] });
    }


    // --- COMANDO: CREAR PERSONAJE (Público) ---
    if (command === 'crearpersonaje') {
        const regex = /"([^"]+)"/;
        const match = fullCommand.match(regex);

        if (!match) {
            return message.reply('Uso: `!Zcrearpersonaje "Nombre del Personaje"`');
        }

        const nombrePersonaje = match[1].trim();

        if (nombrePersonaje.length < 3 || nombrePersonaje.length > 30) {
            return message.reply('El nombre del personaje debe tener entre 3 y 30 caracteres.');
        }

        const personajeKey = generarPersonajeKey(message.author.id, nombrePersonaje);

        try {
            const existing = await personajesDB.get(personajeKey);
            if (existing) {
                return message.reply(`Ya tienes un personaje llamado **${nombrePersonaje}** registrado. ¡Sé original!`);
            }
        } catch (error) {
            // OK, si es NotFoundError, procedemos
        }

        const newPersonaje = {
            nombre: nombrePersonaje,
            propietario: message.author.id,
            tagPropietario: message.author.tag,
            rupias: 0,
            objetos: [],
            createdAt: Date.now() // Timestamp de creación
        };

        await personajesDB.set(personajeKey, newPersonaje);

        const embed = new EmbedBuilder()
            .setColor(LIST_EMBED_COLOR)
            .setTitle(`✨ Personaje Creado: ${nombrePersonaje} ✨`)
            .setDescription(`¡Felicidades! **${nombrePersonaje}** ha sido registrado con éxito.`)
            .addFields(
                { name: 'Dueño', value: message.author.tag, inline: true },
                { name: 'Inventario Inicial', value: 'Vacío', inline: true },
                { name: 'Rupias Iniciales', value: '0', inline: true }
            );

        message.channel.send({ embeds: [embed] });
    }

    // --- COMANDO: VER INVENTARIO DE PERSONAJE (Público) ---
    if (command === 'inventario') {
        const regex = /"([^"]+)"/;
        const match = fullCommand.match(regex);

        if (!match) {
            return message.reply('Uso: `!Zinventario "Nombre del Personaje"`');
        }

        const nombrePersonaje = match[1];
        const personajeKey = generarPersonajeKey(message.author.id, nombrePersonaje);
        
        try {
            const personaje = await personajesDB.get(personajeKey);

            const rupias = personaje.rupias || 0;
            const objetos = personaje.objetos || [];

            const inventoryList = objetos.map((item, index) => 
                `**${index + 1}. ${item.nombre}** - *${item.descripcion.slice(0, 50)}${item.descripcion.length > 50 ? '...' : ''}*`
            ).join('\n') || '*(Inventario vacío)*';

            const embed = new EmbedBuilder()
                .setColor(TREASURE_EMBED_COLOR)
                .setTitle(`🎒 Inventario de ${personaje.nombre}`)
                .setDescription(`**💰 Rupias:** ${rupias}\n\n**📦 Objetos (${objetos.length}):**\n${inventoryList}`)
                .setFooter({ text: `Propietario: ${personaje.tagPropietario}` });

            message.channel.send({ embeds: [embed] });
        } catch (error) {
            if (error.code === 'NotFoundError') {
                return message.reply(`No se encontró el personaje **${nombrePersonaje}** vinculado a tu cuenta. Usa \`!Zpersonajes\` para ver tus Tuppers.`);
            }
            console.error(error);
            return message.reply('Ocurrió un error al buscar el inventario.');
        }
    }
    
    // --- COMANDO: VER LISTA DE PERSONAJES DEL USUARIO (Público) ---
    if (command === 'personajes') {
        const characterKeyPrefix = `${message.author.id}:`;
        const allCharacters = [];

        // 1. Recoger todos los personajes del usuario
        for await (const [key, value] of personajesDB.iterator()) {
            if (key.startsWith(characterKeyPrefix)) {
                allCharacters.push(value);
            }
        }

        if (allCharacters.length === 0) {
            return message.reply('No tienes ningún personaje (tupper) registrado. Usa `!Zcrearpersonaje "Nombre"` para crear uno.');
        }

        // 2. ORDENAR por el timestamp de creación (más antiguo primero)
        allCharacters.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

        // 3. Generar la lista con el nuevo orden
        const characterList = allCharacters.map((char, index) =>
            `**${index + 1}. ${char.nombre}** - ${char.objetos.length} objetos, ${char.rupias} rupias.`
        ).join('\n');


        const embed = new EmbedBuilder()
            .setColor(LIST_EMBED_COLOR)
            .setTitle(`👤 Personajes de ${message.author.tag}`)
            .setDescription(characterList)
            .setFooter({ text: `Total de personajes: ${allCharacters.length} | Ordenados por antigüedad` });

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
        
        try {
            const personaje = await personajesDB.get(personajeKey);

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
        } catch (error) {
            if (error.code === 'NotFoundError') {
                return message.reply(`No se encontró el personaje **${nombrePersonaje}** vinculado a tu cuenta.`);
            }
            console.error(error);
            return message.reply('Ocurrió un error al buscar el personaje.');
        }
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
        
        try {
            let personaje = await personajesDB.get(personajeKey);

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
        } catch (error) {
            if (error.code === 'NotFoundError') {
                return message.reply(`No se encontró el personaje **${nombrePersonaje}** vinculado a ${targetUser}.`);
            }
            console.error(error);
            return message.reply('Ocurrió un error al buscar el personaje.');
        }
    }

    // --- COMANDO: DAR ITEM A PERSONAJE (Staff) ---
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

        const itemId = generarKeyLimpia(nombreItem);
        
        try {
            const item = await compendioDB.get(itemId);

            const personajeKey = generarPersonajeKey(targetUser.id, nombrePersonaje);
            const success = await agregarItemAInventario(personajeKey, item);

            if (!success) {
                return message.reply(`No se encontró un inventario para el personaje **${nombrePersonaje}** vinculado a ${targetUser}. ¿Ha usado \`!Zcrearpersonaje\`?`);
            }

            const embed = new EmbedBuilder()
                .setColor(REWARD_EMBED_COLOR)
                .setTitle(`✨ Objeto Transferido a Inventario ✨`)
                .setDescription(`**${item.nombre}** ha sido dado a **${nombrePersonaje}** (Tupper de ${targetUser.tag}).`)
                .addFields(
                    { name: 'Descripción del Objeto', value: item.descripcion, inline: false },
                    { name: 'Inventario Actual', value: '*(Usa \`!Zinventario\` para verificarlo)*', inline: false }
                )
                .setThumbnail(item.imagen);

            message.channel.send({ content: `${targetUser}`, embeds: [embed] });
        } catch (error) {
            if (error.code === 'NotFoundError') {
                 return message.reply(`El objeto **${nombreItem}** no se encontró en el compendio.`);
            }
            console.error(error);
            return message.reply('Ocurrió un error al procesar el item.');
        }
    }

    // --- COMANDO: DAR RUPIAS A PERSONAJE (Staff) ---
    if (command === 'darrupia') {
        if (!hasAdminPerms) {
            return message.reply('¡Solo los Administradores Canon pueden dar rupias directamente!');
        }

        const regex = /"([^"]+)"/g;
        const matches = [...message.content.matchAll(regex)];
        const targetUser = message.mentions.users.first();

        // Extraer la cantidad del final de los argumentos (no está entre comillas)
        const cantidadStr = args[args.length - 1];
        const cantidad = parseInt(cantidadStr);

        if (!targetUser || matches.length < 1 || isNaN(cantidad) || cantidad <= 0) {
            return message.reply('Uso: `!Zdarrupia @Usuario "NombrePersonaje" <Cantidad>` (la cantidad debe ser positiva).');
        }

        const nombrePersonaje = matches[0][1];
        const personajeKey = generarPersonajeKey(targetUser.id, nombrePersonaje);
        
        try {
            let personaje = await personajesDB.get(personajeKey);

            personaje.rupias = (personaje.rupias || 0) + cantidad;
            await personajesDB.set(personajeKey, personaje);

            const embed = new EmbedBuilder()
                .setColor(REWARD_EMBED_COLOR)
                .setTitle(`💰 Rupias Añadidas`)
                .setDescription(`Se han añadido **${cantidad}** rupias al personaje **${personaje.nombre}**.`)
                .addFields(
                    { name: 'Propietario', value: targetUser.tag, inline: true },
                    { name: 'Rupias Totales', value: personaje.rupias.toString(), inline: true }
                );

            message.channel.send({ content: `**[Staff]** Transferencia realizada.`, embeds: [embed] });
        } catch (error) {
            if (error.code === 'NotFoundError') {
                return message.reply(`Error: No se encontró al personaje **${nombrePersonaje}** para ${targetUser}.`);
            }
            console.error(error);
            return message.reply('Ocurrió un error al procesar las rupias.');
        }
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

        const id = generarKeyLimpia(nombre);

        try {
            const existingEnemy = await enemigosDB.get(id);
            if (existingEnemy) {
                return message.reply(`¡El enemigo **${nombre}** ya está registrado!`);
            }
        } catch (error) {
            // No existe, continuar
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

    // --- COMANDO: VER ENEMIGO (Público) ---
    if (command === 'verenemigo') {
        const regex = /"([^"]+)"/;
        const match = fullCommand.match(regex);

        if (!match) {
            return message.reply('Uso: `!Zverenemigo "Nombre Completo del Enemigo"`');
        }

        const nombreEnemigo = match[1];
        const id = generarKeyLimpia(nombreEnemigo);
        
        try {
            const enemigo = await enemigosDB.get(id);

            const embed = new EmbedBuilder()
                .setColor(ENEMY_EMBED_COLOR)
                .setTitle(`👹 Ficha de Enemigo: ${enemigo.nombre}`)
                .addFields(
                    { name: 'HP Base', value: enemigo.hp.toString(), inline: true },
                    { name: 'Mensaje de Aparición', value: enemigo.mensajeAparicion, inline: false },
                    { name: 'Pluralización Automática', value: enemigo.pluralizar_nombre ? 'Sí (añade "s")' : 'No (usa nombre base)', inline: true }
                )
                .setImage(enemigo.imagen)
                .setFooter({ text: `Registrado por: ${enemigo.registradoPor || 'Desconocido'}` });

            message.channel.send({ embeds: [embed] });
        } catch (error) {
            if (error.code === 'NotFoundError') {
                 return message.reply(`No se encontró ningún enemigo llamado **${nombreEnemigo}** en el Compendio de Monstruos.`);
            }
            console.error(error);
            return message.reply('Ocurrió un error al buscar el enemigo.');
        }
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
        const id = generarKeyLimpia(nombreEnemigo);

        try {
            const enemigoEliminado = await enemigosDB.get(id);
            await enemigosDB.delete(id);

            const embed = new EmbedBuilder()
                .setColor('#cc0000')
                .setTitle(`🗑️ Enemigo Eliminado: ${enemigoEliminado.nombre}`)
                .setDescription(`El enemigo **${enemigoEliminado.nombre}** ha sido borrado permanentemente de la base de datos.`);

            message.channel.send({ embeds: [embed] });
        } catch (error) {
            if (error.code === 'NotFoundError') {
                return message.reply(`No se encontró ningún enemigo llamado **${nombreEnemigo}** en la base de datos.`);
            }
            console.error(error);
            return message.reply('Ocurrió un error al eliminar el enemigo.');
        }
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

                // Buscar cantidad
                if (!isNaN(parseInt(firstPart))) {
                    cantidad = parseInt(firstPart);
                }

                // Buscar 'sinbotones'
                if (firstPart === 'sinbotones' || lastPart === 'sinbotones' || partsAfterQuote.includes('sinbotones')) {
                    sinBotones = true;
                }
            }
        } else if (argsList.length >= 2) {
            // Caso sin comillas (asumiendo que el nombre es una sola palabra)
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

        const enemigoId = generarKeyLimpia(nombreEnemigo);
        
        try {
            const enemigoBase = await enemigosDB.get(enemigoId);

            cantidad = Math.max(1, Math.min(10, cantidad)); // Limitar a 10 enemigos

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
                ? `¡Varios **${nombreEnemigoPlural}** han aparecido de repente! (${enemigoBase.nombre} x${cantidad})`
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
        } catch (error) {
            if (error.code === 'NotFoundError') {
                return message.reply(`El enemigo **${nombreEnemigo}** no está registrado. Usa \`!Zcrearenemigo\`.`);
            }
            console.error(error);
            return message.reply('Ocurrió un error al invocar al enemigo.');
        }
    }

    // --- COMANDO: CREAR COFRE (Staff) ---
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
        const itemId = generarKeyLimpia(nombreItem);

        const cofre = CHEST_TYPES[tipoCofre];

        if (!cofre) {
            return message.reply(`Tipo de cofre inválido. Tipos permitidos: \`${Object.keys(CHEST_TYPES).join(', ')}\`.`);
        }
        
        try {
            const item = await compendioDB.get(itemId);
            
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
                    // El custom ID lleva el item ID y el tipo de cofre para el manejo de la interacción
                    .setCustomId(`open_chest_${itemId}-${tipoCofre}`)
                    .setLabel(`Abrir ${cofre.nombre}`)
                    .setStyle(ButtonStyle.Success)
            );

            targetChannel.send({ embeds: [treasureEmbed], components: [row] });
            message.reply(`✅ **${cofre.nombre}** creado en ${targetChannel} con el item **${item.nombre}** dentro.`);
        } catch (error) {
            if (error.code === 'NotFoundError') {
                 return message.reply(`El item **${nombreItem}** no está registrado en el compendio.`);
            }
            console.error(error);
            return message.reply('Ocurrió un error al crear el cofre.');
        }
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
