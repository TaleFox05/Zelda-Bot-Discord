// Carga la librería 'dotenv' para leer el archivo .env (donde está el Token secreto)
require('dotenv').config();

const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, PermissionsBitField } = require('discord.js');
const Keyv = require('keyv');

// --- CONSTANTES Y CONFIGURACIÓN (Ajustar según tu entorno) ---
const PREFIX = '!Z';
const ADMIN_ROLE_ID = 'TU_ID_DE_ROL_ADMIN'; // Reemplaza con el ID de tu rol de Staff/Admin
const TIPOS_VALIDOS = ['moneda', 'objeto', 'keyitem']; // Tipos de items permitidos

// Colores de los Embeds
const LIST_EMBED_COLOR = '#0099ff';
const ENEMY_EMBED_COLOR = '#FF0000';
const REWARD_EMBED_COLOR = '#44FF00';

// Simulación de Bases de Datos Keyv (Asegúrate de conectarlas correctamente)
const compendioDB = new Keyv('sqlite://db/compendio.sqlite');
const personajesDB = new Keyv('sqlite://db/personajes.sqlite');
const enemigosDB = new Keyv('sqlite://db/enemigos.sqlite');

// Inicializar el cliente de Discord
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// --- FUNCIONES AUXILIARES (DEBES DEFINIRLAS O IMPORTARLAS) ---

// Función de ejemplo para limpiar nombres y usarlos como claves de DB
function generarKeyLimpia(nombre) {
    return nombre.toLowerCase().replace(/ /g, '_');
}

// Función para generar la clave de un personaje (UserID:PersonajeNombreLimpio)
function generarPersonajeKey(userId, nombrePersonaje) {
    return `${userId}:${generarKeyLimpia(nombrePersonaje)}`;
}

// Función de ejemplo para manejar la paginación (simulada)
function createPaginationRow(currentPage, totalPages, type = 'item') {
    const prevButton = new ButtonBuilder()
        .setCustomId(`paginate_${type}_prev_${currentPage - 1}`)
        .setLabel('⬅️ Anterior')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(currentPage === 0);

    const nextButton = new ButtonBuilder()
        .setCustomId(`paginate_${type}_next_${currentPage + 1}`)
        .setLabel('Siguiente ➡️')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(currentPage >= totalPages - 1);

    return new ActionRowBuilder().addComponents(prevButton, nextButton);
}

// Función de ejemplo para obtener todos los items (simulada)
async function obtenerTodosItems() {
    const items = [];
    // Aquí iría la lógica real de iterar sobre compendioDB
    // Simulación:
    for await (const [key, value] of compendioDB.iterator()) {
        items.push(value);
    }
    // Ordenar por fecha de creación (más reciente primero)
    items.sort((a, b) => (b.fechaCreacionMs || 0) - (a.fechaCreacionMs || 0));
    return items;
}

// Función de ejemplo para crear la página del embed de items (simulada)
function createItemEmbedPage(items, currentPage) {
    const ITEMS_PER_PAGE = 10;
    const totalPages = Math.max(1, Math.ceil(items.length / ITEMS_PER_PAGE));
    const start = currentPage * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const itemsToShow = items.slice(start, end);

    let list = itemsToShow.length > 0
        ? itemsToShow.map(item => `• **${item.nombre}** (${item.tipo.toUpperCase()})`).join('\n')
        : 'No hay objetos registrados.';

    const embed = new EmbedBuilder()
        .setColor(LIST_EMBED_COLOR)
        .setTitle('📦 Compendio de Objetos de Hyrule')
        .setDescription(list)
        .setFooter({ text: `Página ${currentPage + 1} de ${totalPages} | Total de objetos: ${items.length}` });

    return { embed, totalPages };
}

// Función de ejemplo para obtener todos los enemigos (simulada)
async function obtenerTodosEnemigos() {
    const enemies = [];
    // Aquí iría la lógica real de iterar sobre enemigosDB
    for await (const [key, value] of enemigosDB.iterator()) {
        enemies.push(value);
    }
    enemies.sort((a, b) => a.nombre.localeCompare(b.nombre));
    return enemies;
}

// Función de ejemplo para crear la página del embed de enemigos (simulada)
function createEnemyEmbedPage(enemies, currentPage) {
    const ITEMS_PER_PAGE = 10;
    const totalPages = Math.max(1, Math.ceil(enemies.length / ITEMS_PER_PAGE));
    const start = currentPage * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const enemiesToShow = enemies.slice(start, end);

    let list = enemiesToShow.length > 0
        ? enemiesToShow.map(enemy => `• **${enemy.nombre}** (HP: ${enemy.hp})`).join('\n')
        : 'No hay enemigos registrados.';

    const embed = new EmbedBuilder()
        .setColor(ENEMY_EMBED_COLOR)
        .setTitle('👹 Compendio de Monstruos')
        .setDescription(list)
        .setFooter({ text: `Página ${currentPage + 1} de ${totalPages} | Total de monstruos: ${enemies.length}` });

    return { embed, totalPages };
}

// Función para asegurar la estructura de rupias (simulada/simplificada)
async function migrarRupias(personaje) {
    // Aquí iría la lógica para asegurar que el personaje tiene la propiedad 'rupias'
    if (typeof personaje.rupias !== 'number' || personaje.rupias < 0) {
        personaje.rupias = 0;
        // await personajesDB.set(personajeKey, personaje); // Guardar si se hiciera un cambio
    }
}

// Función para intentar obtener el avatar del tupper (simulada)
async function getTupperAvatar(client, nombrePersonaje, member) {
    // En un bot real con Tupperbox, esta lógica es compleja y depende de Tupperbox.
    // Aquí devolvemos el avatar del usuario como fallback.
    return member ? member.user.displayAvatarURL({ dynamic: true }) : null;
}

// Función para agregar un item al inventario (simulada/simplificada)
async function agregarItemAInventario(personajeKey, item) {
    let personaje = await personajesDB.get(personajeKey);

    if (!personaje) {
        return false; // Personaje no encontrado
    }

    // Clonar el item para evitar referencias y añadir al inventario
    const itemCopy = { ...item, timestamp: Date.now() };

    if (!personaje.objetos) {
        personaje.objetos = [];
    }

    personaje.objetos.push(itemCopy);
    await personajesDB.set(personajeKey, personaje);
    return true;
}

// --- EVENTO READY ---
client.on('ready', () => {
    console.log(`Zelda BOT está en línea como ${client.user.tag}`);
    // Asegúrate de que las DB se conecten aquí si usas un proveedor asíncrono.
});

// --- MANEJO DE INTERACCIONES (PAGINACIÓN Y CONFIRMACIONES) ---
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton()) return;

    const [action, type, ...params] = interaction.customId.split('_');
    const senderId = interaction.user.id;
    const fullCustomId = interaction.customId;

    // --- LÓGICA DE PAGINACIÓN DE COMPENDIOS ---
    if (action === 'paginate') {
        const targetType = type; // 'item' o 'enemy'
        const currentPage = parseInt(params[0]);
        let itemsOrEnemies;
        let createEmbedPage;
        let typeLabel;

        if (targetType === 'item') {
            itemsOrEnemies = await obtenerTodosItems();
            createEmbedPage = createItemEmbedPage;
            typeLabel = 'item';
        } else if (targetType === 'enemy') {
            itemsOrEnemies = await obtenerTodosEnemigos();
            createEmbedPage = createEnemyEmbedPage;
            typeLabel = 'enemy';
        } else {
            return interaction.reply({ content: 'Error de paginación: Tipo no reconocido.', ephemeral: true });
        }

        if (itemsOrEnemies.length === 0) {
            return interaction.update({ content: 'El compendio está vacío.', embeds: [], components: [] });
        }

        const { embed, totalPages } = createEmbedPage(itemsOrEnemies, currentPage);
        const row = createPaginationRow(currentPage, totalPages, typeLabel);

        return interaction.update({ embeds: [embed], components: [row] });
    }

    // --- LÓGICA DE CONFIRMACIÓN: BORRADO MASIVO DE PERSONAJES ---
    if (action === 'confirm' && type === 'delete' && params[0] === 'all') {
        const targetUserId = params[1]; // El ID después de 'all_'

        if (senderId !== targetUserId) {
            return interaction.reply({ content: 'Solo el usuario que inició la eliminación puede confirmarla.', ephemeral: true });
        }

        const characterKeyPrefix = `${targetUserId}:`;
        let deletedCount = 0;

        // Eliminar todos los personajes del usuario
        for await (const [key, value] of personajesDB.iterator()) {
            if (key.startsWith(characterKeyPrefix)) {
                await personajesDB.delete(key);
                deletedCount++;
            }
        }

        const embed = new EmbedBuilder()
            .setColor('#2ECC71')
            .setTitle('✅ Eliminación Masiva Completada')
            .setDescription(`Se han **eliminado** permanentemente los inventarios de tus **${deletedCount}** personajes.`);

        // Desactivar botones después de la acción
        const newComponents = interaction.message.components.map(row => {
            return new ActionRowBuilder().addComponents(
                row.components.map(button => ButtonBuilder.from(button).setDisabled(true))
            );
        });

        await interaction.update({ embeds: [embed], components: newComponents });

    } else if (action === 'cancel' && type === 'delete' && params[0] === 'all') {
        if (senderId !== fullCustomId.split('_')[3]) {
             return interaction.reply({ content: 'Solo el usuario que inició la eliminación puede cancelarla.', ephemeral: true });
        }
        
        const newComponents = interaction.message.components.map(row => {
            return new ActionRowBuilder().addComponents(
                row.components.map(button => ButtonBuilder.from(button).setDisabled(true).setLabel('Cancelado'))
            );
        });
        await interaction.update({ content: 'Operación de borrado masivo cancelada.', embeds: [], components: newComponents });
    }
});


// --- EVENTO MESSAGE CREATE (Comandos) ---
client.on('messageCreate', async message => {
    if (message.author.bot) return;

    // Nota: hasAdminPerms utiliza 'message.member.roles.cache.has' y 'message.member.permissions.has'.
    // Esta verificación solo funciona en servidores.
    const hasAdminPerms = message.member && (message.member.roles.cache.has(ADMIN_ROLE_ID) || message.member.permissions.has(PermissionsBitField.Flags.Administrator));

    if (!message.content.startsWith(PREFIX)) return;

    const fullCommand = message.content.slice(PREFIX.length).trim();
    const args = fullCommand.split(/ +/);
    const command = args.shift().toLowerCase();


    // ----------------------------------------------------------------
    // --- PARTE 1: COMANDO HELP Y LÓGICA DE ITEMS EN EL COMPENDIO ---
    // ----------------------------------------------------------------

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
                        `\`!Zdarrupia @Usuario "Personaje" <Cantidad>\`: Añade Rupias al personaje.`, // STAFF
                        `\`!Zeliminarrupias @Usuario "Personaje" <cantidad|all>\`: Elimina rupias del inventario.`,
                        `\`!Zreiniciarinv "Personaje"\`: Borra todo el inventario y rupias de un personaje.`,
                        `\n**— Gestión de Encuentros —**`,
                        `\`!Zcrearenemigo "Nombre" "HP" "URL" ["Mensaje"] [pluralizar_nombre]\`: Registra un enemigo base.`,
                        `\`!Zeliminarenemigo "Nombre"\`: Borra un enemigo base.`,
                        `\`!Zspawn <CanalID> "EnemigoNombre" [Cantidad] [sinbotones]\`: Hace aparecer enemigos.`,
                        // `\`!Zcrearcofre <CanalID> "Tipo" "ItemNombre"\`: Crea un cofre.`, // ELIMINADO
                    ].join('\n'),
                    inline: false
                },
                {
                    name: '🌎 Comandos de Consulta (Público)',
                    value: [
                        `\`!Zpersonajes\`: Muestra la lista de personajes que has creado.`,
                        `\`!Zinventario "Nombre del Tupper"\`: Muestra los objetos y rupias de tu personaje.`,
                        `\`!Zlistaritems\`: Muestra el compendio de objetos (ordenado por fecha de creación).`,
                        `\`!Zlistarenemigos\`: Muestra el compendio de monstruos (con paginación).`,
                        `\`!Zverenemigo "Nombre"\`: Muestra la ficha detallada de un enemigo.`,
                        `\`!Zveritem "Nombre"\`: Muestra la ficha detallada de un objeto.`,
                        `\`!Zmostraritemid "Nombre"\`: Muestra la ID (clave interna) de un objeto del compendio.`,
                        `\`!Z-help\`: Muestra esta guía de comandos.`
                    ].join('\n'),
                    inline: false
                },
                {
                    name: '👤 Comandos Públicos (Personajes e Interacción)',
                    value:
                        '`!Zcrearpersonaje <Nombre>`: Registra un nuevo personaje (Inicia con **100 Rupias**).\n' +
                        '`!Zeliminarpersonaje <Nombre>`: Elimina uno de tus personajes y su inventario.\n' +
                        '`!Zborrarpersonajes`: **¡PELIGRO!** Elimina *todos* tus personajes y sus inventarios.\n' +
                        '`!Zinventario <Nombre>`: Muestra las rupias y objetos de tu personaje.\n' +
                        '`!Zpersonajes`: Lista todos tus personajes (ordenados por creación).\n' +
                        '`!Zdaritem <Personaje> <Item> @Destino`: Transfiere un objeto de tu inventario.\n' + // Asumido
                        '`!Zdarrupia_p <Personaje> @Destino <Cantidad>`: Transfiere Rupias a otro personaje.', // Asumido
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

        const id = generarKeyLimpia(nombre);

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
        const id = generarKeyLimpia(nombreItem);

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
        const id = generarKeyLimpia(nombreItem);
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

    // --- NUEVO COMANDO: MOSTRAR ID INTERNA DEL ITEM (Público) ---
    if (command === 'mostraritemid') {
        const regex = /"([^"]+)"/;
        const match = fullCommand.match(regex);

        if (!match) {
            return message.reply('Uso: `!Zmostraritemid "Nombre Completo del Objeto"`');
        }

        const nombreItem = match[1];
        // 1. Generar el ID interno (clave limpia)
        const id = generarKeyLimpia(nombreItem);

        // 2. Intentar recuperar el item para confirmar que existe
        const item = await compendioDB.get(id);

        if (!item) {
            return message.reply(`El objeto **${nombreItem}** no se encontró en el Compendio. Asegúrate de que el nombre esté escrito correctamente.`);
        }

        const embed = new EmbedBuilder()
            .setColor(LIST_EMBED_COLOR)
            .setTitle(`🔍 Identificador Interno (ID) de Item`)
            .setDescription(`Esta es la clave única utilizada por el bot para identificar **${item.nombre}** en la base de datos y en los comandos de asignación.`)
            .addFields(
                { name: 'Nombre Registrado', value: item.nombre, inline: true },
                { name: 'Tipo', value: item.tipo.toUpperCase(), inline: true },
                { name: 'ID Interna (Clave)', value: `\`${id}\``, inline: false }
            )
            .setFooter({ text: 'Útil para comandos Staff' });

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

        const personajeData = {
            nombre: nombrePersonaje,
            propietarioId: message.author.id,
            propietarioTag: message.author.tag,
            rupias: 100, // Inicia con 100 Rupias
            objetos: [],
            fechaRegistro: new Date().toLocaleDateString('es-ES'),
            createdAt: Date.now() // Timestamp para ordenación
        };

        await personajesDB.set(personajeKey, personajeData); // Usando personajesDB

        const embed = new EmbedBuilder()
            .setColor(LIST_EMBED_COLOR)
            .setTitle(`👤 Personaje Registrado: ${nombrePersonaje}`)
            .setDescription(`Se ha creado un inventario y ha sido vinculado a tu ID de Discord.`)
            .addFields(
                { name: 'Propietario', value: message.author.tag, inline: true },
                { name: 'Inventario Inicial', value: `100 Rupias y 0 Objetos`, inline: true }
            )
            .setFooter({ text: 'Ahora puedes recibir objetos en este personaje.' });

        message.channel.send({ embeds: [embed] });
    }

    // --- NUEVO COMANDO: ELIMINAR PERSONAJE (Público) ---
    if (command === 'eliminarpersonaje') {
        const regex = /"([^"]+)"/;
        const match = fullCommand.match(regex);

        if (!match) {
            return message.reply('Uso: `!Zeliminarpersonaje "Nombre del Tupper"` (Debe ser el nombre exacto de tu personaje).');
        }

        const nombrePersonaje = match[1];
        const personajeKey = generarPersonajeKey(message.author.id, nombrePersonaje);

        const exists = await personajesDB.get(personajeKey);

        if (!exists) {
            return message.reply(`Error: No se encontró ningún personaje llamado **${nombrePersonaje}** vinculado a tu cuenta.`);
        }

        // ELIMINAR la entrada de la base de datos
        await personajesDB.delete(personajeKey);

        const embed = new EmbedBuilder()
            .setColor('#E82A2A')
            .setTitle(`🗑️ Personaje Eliminado`)
            .setDescription(`El personaje **${nombrePersonaje}** ha sido **ELIMINADO** permanentemente de tu inventario. Se han borrado sus objetos y rupias.`);

        return message.channel.send({ embeds: [embed] });
    }

    // --- NUEVO COMANDO: BORRAR TODOS LOS PERSONAJES (Público, con confirmación) ---
    if (command === 'borrarpersonajes') {
        const userId = message.author.id;
        const characterKeyPrefix = `${userId}:`;
        const allCharacters = [];

        // 1. Recoger todos los personajes del usuario
        for await (const [key, value] of personajesDB.iterator()) {
            if (key.startsWith(characterKeyPrefix)) {
                allCharacters.push(value.nombre);
            }
        }

        if (allCharacters.length === 0) {
            return message.reply('No tienes ningún personaje (tupper) registrado para borrar.');
        }

        // 2. Crear el mensaje de advertencia y botones
        const confirmEmbed = new EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('⚠️ ¡ADVERTENCIA: BORRADO MASIVO! ⚠️')
            .setDescription(`Estás a punto de **ELIMINAR PERMANENTEMENTE** todos tus ${allCharacters.length} personajes:\n\n` +
                `**${allCharacters.join(', ')}**\n\n` +
                'Esta acción **no se puede deshacer** y perderás todos sus objetos y rupias.\n\n' +
                '**Pulsa el botón de abajo para confirmar.**');

        const confirmRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`confirm_delete_all_${userId}`)
                .setLabel('CONFIRMAR ELIMINACIÓN TOTAL')
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId('cancel_delete_all')
                .setLabel('Cancelar')
                .setStyle(ButtonStyle.Secondary)
        );

        return message.reply({
            content: `${message.author}, ¡Cuidado! Esta es una operación irreversible.`,
            embeds: [confirmEmbed],
            components: [confirmRow]
        });
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

    // ----------------------------------------------------------------
    // --- PARTE 2: GESTIÓN DE PERSONAJES Y RUPIAS (Incompleto) ---
    // ----------------------------------------------------------------

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

        // El nombre del personaje es el primer match.
        if (matches.length < 1) {
            return message.reply('Debes especificar el nombre del personaje entre comillas y una cantidad.');
        }

        const nombrePersonaje = matches[0][1];
        // Buscar el argumento de cantidad al final
        const allArgs = fullCommand.split(/\s+/).filter(a => a.length > 0 && !a.startsWith('<@'));
        let cantidad = allArgs[allArgs.length - 1];

        // Manejar el caso donde el último argumento es el nombre limpio del personaje
        const nombreLimpio = generarKeyLimpia(nombrePersonaje);
        if (cantidad === nombreLimpio) {
             // Si el último argumento es el nombre limpio, significa que no se proporcionó cantidad.
            const indexDeNombreEnArgs = allArgs.findIndex(arg => arg.includes(nombreLimpio));
            if (indexDeNombreEnArgs !== -1 && indexDeNombreEnArgs + 1 < allArgs.length) {
                cantidad = allArgs[indexDeNombreEnArgs + 1];
            } else {
                cantidad = undefined;
            }
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
            .setDescription(`**${item.nombre}** ha sido dado a **${nombrePersonaje}** (Tupper de ${targetUser.tag}).`)
            .addFields(
                { name: 'Descripción del Objeto', value: item.descripcion, inline: false },
                { name: 'Inventario Actual', value: '*(Usa \`!Zinventario\` para verificarlo)*', inline: false }
            )
            .setThumbnail(item.imagen);

        message.channel.send({ content: `${targetUser}`, embeds: [embed] });
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
        let personaje = await personajesDB.get(personajeKey);

        if (!personaje) {
            return message.reply(`Error: No se encontró al personaje **${nombrePersonaje}** para ${targetUser}.`);
        }

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

    // --- COMANDO: VER ENEMIGO (Público) ---
    if (command === 'verenemigo') {
        const regex = /"([^"]+)"/;
        const match = fullCommand.match(regex);

        if (!match) {
            return message.reply('Uso: `!Zverenemigo "Nombre Completo del Enemigo"`');
        }

        const nombreEnemigo = match[1];
        const id = generarKeyLimpia(nombreEnemigo);
        const enemigo = await enemigosDB.get(id);

        if (!enemigo) {
            return message.reply(`No se encontró ningún enemigo llamado **${nombreEnemigo}** en el Compendio de Monstruos.`);
        }

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

                // Intenta parsear la cantidad si el primer argumento después de la cita es un número
                if (!isNaN(parseInt(firstPart))) {
                    cantidad = parseInt(firstPart);
                }

                // Buscar el marcador 'sinbotones' en todos los argumentos restantes
                if (partsAfterQuote.includes('sinbotones')) {
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

        const enemigoId = generarKeyLimpia(nombreEnemigo);
        const enemigoBase = await enemigosDB.get(enemigoId);

        if (!enemigoBase) {
            return message.reply(`El enemigo **${nombreEnemigo}** no está registrado. Usa \`!Zcrearenemigo\`.`);
        }

        cantidad = Math.max(1, Math.min(10, cantidad)); // Limitar cantidad

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

    // --- COMANDO: CREAR COFRE (ELIMINADO) ---
    /*
    if (command === 'crearcofre') {
        // Código de cofres eliminado.
        return message.reply('El comando `!Zcrearcofre` está temporalmente deshabilitado.');
    }
    */

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

    // --- COMANDO ASUMIDO: REINICIAR INVENTARIO (Staff) ---
    if (command === 'reiniciarinv') {
        if (!hasAdminPerms) {
            return message.reply('¡Solo los Administradores Canon pueden reiniciar inventarios!');
        }

        const regex = /"([^"]+)"/;
        const match = fullCommand.match(regex);

        if (!match) {
            return message.reply('Uso: `!Zreiniciarinv "NombrePersonaje"`');
        }

        const nombrePersonaje = match[1];
        // Asumimos que esta es una operación Staff que podría no ser sobre su propio personaje
        // El código original no especifica el @Usuario, asumiremos que solo se necesita el nombre
        // y buscará al personaje, lo cual es inseguro. Por seguridad, requerimos la mención.
        // Si el usuario no está, buscaremos solo por nombre (lo cual puede generar colisiones)

        const targetUser = message.mentions.users.first() || message.author;
        const personajeKey = generarPersonajeKey(targetUser.id, nombrePersonaje);
        let personaje = await personajesDB.get(personajeKey);

        if (!personaje) {
             // Intento de búsqueda si es solo Staff y el nombre es único (poco probable)
             return message.reply(`No se encontró un personaje llamado **${nombrePersonaje}** vinculado al usuario mencionado/a ti.`);
        }

        // Reiniciar datos
        personaje.rupias = 0;
        personaje.objetos = [];
        await personajesDB.set(personajeKey, personaje);

        const embed = new EmbedBuilder()
            .setColor('#FFA500')
            .setTitle(`♻️ Inventario Reiniciado`)
            .setDescription(`El inventario del personaje **${personaje.nombre}** ha sido vaciado. Rupias: 0, Objetos: 0.`);

        message.channel.send({ embeds: [embed] });
    }

    // --- COMANDO ASUMIDO: DAR ITEM ENTRE JUGADORES (Público) ---
    if (command === 'daritem_p') {
        return message.reply('El comando para dar items entre jugadores no está implementado en este script, utiliza el comando Staff `!Zdaritem` por ahora.');
    }

    // --- COMANDO ASUMIDO: DAR RUPIAS ENTRE JUGADORES (Público) ---
    if (command === 'darrupia_p') {
        return message.reply('El comando para dar rupias entre jugadores no está implementado en este script, utiliza el comando Staff `!Zdarrupia` por ahora.');
    }
});

client.login(process.env.DISCORD_TOKEN);