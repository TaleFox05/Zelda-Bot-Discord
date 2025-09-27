// Carga la librería 'dotenv' para leer el archivo .env
require('dotenv').config();
const { Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Keyv = require('keyv');

// Configuración
const PREFIX = '!Z';
const ADMIN_ROLE_ID = "1420026299090731050";
const LIST_EMBED_COLOR = '#427522';
const TIPOS_VALIDOS = ['moneda', 'objeto', 'keyitem'];

// Base de datos
const compendioDB = new Keyv(process.env.REDIS_URL, { namespace: 'items' });

// Manejo de errores en la conexión a Redis
compendioDB.on('error', err => console.error('Error en Redis:', err));

// Cliente de Discord
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
    ]
});

// Función para generar claves limpias (usada para otros casos, no para ítems)
function generarKeyLimpia(nombre) {
    return nombre.toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .trim('_');
}

// Función para obtener todos los ítems (ordenados por ID numérico)
async function obtenerTodosItems() {
    try {
        const items = {};
        for await (const [key, value] of compendioDB.iterator()) {
            items[key] = value;
        }
        const itemsArray = Object.values(items);
        // Ordenar por ID numérico (extrayendo el número de "item_<número>")
        itemsArray.sort((a, b) => {
            const idA = parseInt(a.id.replace('item_', ''));
            const idB = parseInt(b.id.replace('item_', ''));
            return idA - idB;
        });
        return itemsArray;
    } catch (error) {
        console.error('Error en obtenerTodosItems:', error);
        throw new Error('No se pudo acceder al Compendio de Hyrule. Contacta a un administrador.');
    }
}

// Función para crear la paginación de embeds
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

// Función para crear el embed de la lista de ítems
function createItemEmbedPage(items, pageIndex) {
    const ITEMS_PER_PAGE = 5;
    const start = pageIndex * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const itemsToShow = items.slice(start, end);
    const totalPages = Math.ceil(items.length / ITEMS_PER_PAGE);

    const embed = new EmbedBuilder()
        .setColor(LIST_EMBED_COLOR)
        .setTitle('🏰 Compendio de Objetos de Nuevo Hyrule 🏰')
        .setDescription(`*Página ${pageIndex + 1} de ${totalPages}. Explora los tesoros registrados en Hyrule.*`)
        .setFooter({ text: `Página ${pageIndex + 1} de ${totalPages} | Usa los botones para navegar.` });

    itemsToShow.forEach(p => {
        embed.addFields({
            name: `**${p.nombre}**`,
            value: `**ID:** ${p.id} | **Tipo:** ${p.tipo.toUpperCase()} | **Estado:** ${p.disponible ? 'Disponible' : 'En Posesión'}`,
            inline: false
        });
    });

    return { embed, totalPages };
}

// Evento: Bot listo
client.on('ready', async () => {
    console.log(`¡Zelda BOT iniciado como ${client.user.tag}!`);
    client.user.setActivity('Gestionando el Compendio de Hyrule');
    // Verificar conexión a Redis
    try {
        await compendioDB.set('test', 'test');
        await compendioDB.delete('test');
        console.log('Conexión a Redis verificada correctamente.');
    } catch (error) {
        console.error('Error al conectar con Redis:', error);
    }
});

// Evento: Manejo de interacciones (para paginación)
client.on('interactionCreate', async interaction => {
    if (!interaction.isButton() || !['first', 'prev', 'next', 'last'].includes(interaction.customId)) return;

    try {
        const footerText = interaction.message.embeds[0]?.footer?.text;
        if (!footerText) {
            console.error('Error: No se encontró footer en el embed de paginación.');
            return interaction.update({ content: 'Error al cargar la página. Intenta de nuevo.' });
        }

        const match = footerText.match(/Página (\d+) de (\d+)/);
        if (!match) {
            console.error('Error: No se pudo parsear el footer de paginación.');
            return interaction.update({ content: 'Error al cargar la página. Intenta de nuevo.' });
        }

        const currentPage = parseInt(match[1]) - 1;
        const items = await obtenerTodosItems();
        if (items.length === 0) {
            console.log('No hay ítems en el compendio para paginación.');
            return interaction.update({ content: 'El compendio de objetos está vacío.', components: [] });
        }

        const totalPages = Math.ceil(items.length / 5);
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
    } catch (error) {
        console.error('Error en interactionCreate:', error);
        await interaction.update({ content: '¡Error al navegar por el Compendio de Hyrule! Contacta a un administrador.' });
    }
});

// Evento: Manejo de comandos
client.on('messageCreate', async message => {
    if (message.author.bot) return;

    console.log(`Mensaje recibido: ${message.content}`); // Log para depuración

    const hasAdminPerms = message.member && (
        message.member.roles.cache.has(ADMIN_ROLE_ID) ||
        message.member.permissions.has(PermissionsBitField.Flags.Administrator)
    );

    if (!message.content.startsWith(PREFIX)) {
        console.log('Mensaje ignorado: No empieza con el prefijo !Z');
        return;
    }

    const fullCommand = message.content.slice(PREFIX.length).trim();
    const args = fullCommand.split(/ +/);
    const command = args.shift().toLowerCase();
    console.log(`Comando detectado: ${command}`); // Log para depuración

    // --- COMANDO: CREAR ITEM (Staff) ---
    if (command === 'crearitem') {
        if (!hasAdminPerms) {
            console.log('Usuario sin permisos intentó usar !Zcrearitem:', message.author.tag);
            return message.reply('¡Alto ahí! Solo los **Administradores Canon** pueden registrar objetos mágicos.');
        }

        try {
            const regex = /"([^"]+)"/g;
            const matches = [...message.content.matchAll(regex)];
            const idMatch = fullCommand.match(/\b(\d+)\b/); // Buscar un número en la entrada

            if (matches.length < 3 || !idMatch) {
                return message.reply('Sintaxis incorrecta. Uso: `!Zcrearitem "Nombre" <ID> "Descripción" "Tipo (moneda/objeto/keyitem)" "URL de Imagen" ["ValorRupia (solo para monedas)"]`');
            }

            const nombre = matches[0][1];
            const idNumber = parseInt(idMatch[1]);
            const descripcion = matches[1][1];
            const tipo = matches[2][1].toLowerCase();
            const imagenUrl = matches[3][1];

            let valorRupia = 0;

            if (!TIPOS_VALIDOS.includes(tipo)) {
                return message.reply(`El tipo de objeto debe ser uno de estos: ${TIPOS_VALIDOS.join(', ')}.`);
            }

            if (tipo === 'moneda') {
                if (matches.length < 4) {
                    return message.reply('Para items tipo **moneda**, debes especificar el valor en Rupias: `!Zcrearitem "Nombre" <ID> "Desc" "moneda" "URL" "ValorRupia"`');
                }
                valorRupia = parseInt(matches[4][1]);
                if (isNaN(valorRupia) || valorRupia <= 0) {
                    return message.reply('El ValorRupia para las monedas debe ser un número entero positivo.');
                }
            }

            const id = `item_${idNumber}`;

            const existingItem = await compendioDB.get(id);
            if (existingItem) {
                return message.reply(`¡El objeto con ID **${id}** ya está registrado! Por favor, usa un ID diferente.`);
            }

            const now = new Date();
            const newItem = {
                id: id, // Guardar el ID completo (item_<número>)
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
            console.log(`Ítem creado: ${id} - ${nombre}`); // Log para depuración

            const embed = new EmbedBuilder()
                .setColor(LIST_EMBED_COLOR)
                .setTitle(`✅ Objeto Registrado: ${nombre}`)
                .setDescription(`¡Un nuevo item ha sido añadido al Compendio de Nuevo Hyrule!`)
                .addFields(
                    { name: 'ID', value: id, inline: true },
                    { name: 'Descripción', value: descripcion, inline: false },
                    { name: 'Tipo', value: tipo.toUpperCase(), inline: true },
                    { name: 'Valor (Rupias)', value: tipo === 'moneda' ? valorRupia.toString() : 'N/A', inline: true },
                    { name: 'Estado', value: 'Disponible', inline: true }
                )
                .setImage(imagenUrl)
                .setFooter({ text: `Registrado por: ${message.author.tag} | Hyrule custodia este tesoro.` });

            message.channel.send({ embeds: [embed] });
        } catch (error) {
            console.error('Error en !Zcrearitem:', error);
            message.reply('¡Error al registrar el objeto en el Compendio de Hyrule! Contacta a un administrador.');
        }
    }

    // --- COMANDO: VER ITEM (Público) ---
    if (command === 'veritem') {
        try {
            const regex = /"([^"]+)"/;
            const match = fullCommand.match(regex);

            if (!match) {
                return message.reply('Uso: `!Zveritem "ID del Objeto"` (Ejemplo: "item_22")');
            }

            const id = match[1];
            const item = await compendioDB.get(id);

            if (!item) {
                return message.reply(`No se encontró ningún objeto con ID **${id}** en el Compendio de Hyrule.`);
            }

            const embed = new EmbedBuilder()
                .setColor(LIST_EMBED_COLOR)
                .setTitle(`✨ ${item.nombre} (ID: ${item.id})`)
                .setDescription(`*Un tesoro registrado en el Compendio de Hyrule.*`)
                .addFields(
                    { name: 'ID', value: item.id, inline: true },
                    { name: 'Descripción', value: item.descripcion, inline: false },
                    { name: 'Tipo', value: item.tipo.toUpperCase(), inline: true },
                    { name: 'Estado', value: item.disponible ? 'Disponible' : 'En Posesión', inline: true },
                    { name: 'Fecha de Registro', value: item.fecha, inline: true }
                )
                .setImage(item.imagen)
                .setFooter({ text: `Registrado por: ${item.registradoPor} | Protegido por las Diosas.` });

            message.channel.send({ embeds: [embed] });
        } catch (error) {
            console.error('Error en !Zveritem:', error);
            message.reply('¡Error al consultar el objeto en el Compendio de Hyrule! Contacta a un administrador.');
        }
    }

    // --- COMANDO: LISTAR ITEMS (Público) ---
    if (command === 'listaritems') {
        console.log('Ejecutando !Zlistaritems'); // Log para depuración
        try {
            const items = await obtenerTodosItems();
            console.log(`Ítems obtenidos: ${items.length}`); // Log para depuración

            if (items.length === 0) {
                console.log('Compendio vacío');
                return message.channel.send('***El Compendio de Hyrule está vacío. ¡Que las Diosas traigan el primer tesoro!***');
            }

            const currentPage = 0;
            const { embed, totalPages } = createItemEmbedPage(items, currentPage);
            const row = createPaginationRow(currentPage, totalPages);
            console.log('Enviando embed de !Zlistaritems'); // Log para depuración

            await message.channel.send({ embeds: [embed], components: [row] });
        } catch (error) {
            console.error('Error en !Zlistaritems:', error);
            message.reply('¡Error al listar el Compendio de Hyrule! Contacta a un administrador.');
        }
    }
});

client.login(process.env.DISCORD_TOKEN);