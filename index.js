// Carga la librería 'dotenv' para leer el archivo .env
require('dotenv').config();
const { Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder } = require('discord.js');
const Keyv = require('keyv');

// Configuración
const PREFIX = '!Z';
const ADMIN_ROLE_ID = "1420026299090731050";
const LIST_EMBED_COLOR = '#427522';
const TIPOS_VALIDOS = ['moneda', 'objeto', 'keyitem'];

// Base de datos
const compendioDB = new Keyv(process.env.REDIS_URL, { namespace: 'items' });

// Manejo de errores en Redis
compendioDB.on('error', err => console.error('Error en Redis:', err));

// Cliente de Discord
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Evitar eventos duplicados
client.removeAllListeners('messageCreate');
client.removeAllListeners('ready');

// Función para verificar conexión a Redis
async function verificarRedis() {
    try {
        await compendioDB.set('test', 'test');
        await compendioDB.delete('test');
        console.log('Conexión a Redis verificada.');
        return true;
    } catch (error) {
        console.error('Error al verificar Redis:', error);
        return false;
    }
}

// Función para obtener todos los ítems (ordenados por ID numérico)
async function obtenerTodosItems() {
    try {
        if (!(await verificarRedis())) {
            throw new Error('No se pudo conectar con Redis.');
        }
        const items = {};
        for await (const [key, value] of compendioDB.iterator()) {
            if (value && value.id && value.nombre) { // Validar datos
                items[key] = value;
            }
        }
        const itemsArray = Object.values(items);
        itemsArray.sort((a, b) => {
            const idA = parseInt(a.id.replace('item_', '')) || 0;
            const idB = parseInt(b.id.replace('item_', '')) || 0;
            return idA - idB;
        });
        console.log(`Ítems obtenidos en obtenerTodosItems: ${itemsArray.length}`);
        return itemsArray;
    } catch (error) {
        console.error('Error en obtenerTodosItems:', error);
        throw new Error('No se pudo acceder al Compendio de Hyrule.');
    }
}

// Evento: Bot listo
client.on('ready', async () => {
    console.log(`¡Zelda BOT iniciado como ${client.user.tag}!`);
    client.user.setActivity('Gestionando el Compendio de Hyrule');
    await verificarRedis();
});

// Evento: Manejo de comandos
client.on('messageCreate', async message => {
    if (message.author.bot) return;

    console.log(`Mensaje recibido: ${message.content} (Canal: ${message.channel.id}, Autor: ${message.author.tag})`);

    if (!message.content.startsWith(PREFIX)) {
        console.log('Mensaje ignorado: No empieza con el prefijo !Z');
        return;
    }

    const hasAdminPerms = message.member && (
        message.member.roles.cache.has(ADMIN_ROLE_ID) ||
        message.member.permissions.has(PermissionsBitField.Flags.Administrator)
    );

    const fullCommand = message.content.slice(PREFIX.length).trim();
    const args = fullCommand.split(/ +/);
    const command = args.shift().toLowerCase();
    console.log(`Comando detectado: ${command} (Autor: ${message.author.tag})`);

    // --- COMANDO: CREAR ITEM (Staff) ---
    if (command === 'crearitem') {
        if (!hasAdminPerms) {
            console.log('Usuario sin permisos intentó usar !Zcrearitem:', message.author.tag);
            return message.reply('¡Alto ahí! Solo los **Administradores Canon** pueden registrar objetos mágicos.');
        }

        try {
            const regex = /"([^"]+)"/g;
            const matches = [...message.content.matchAll(regex)];
            const idMatch = fullCommand.match(/\b(\d+)\b/);

            if (matches.length < 3 || !idMatch) {
                return message.reply('Sintaxis incorrecta. Uso: `!Zcrearitem "Nombre" <ID> "Descripción" "Tipo (moneda/objeto/keyitem)" "URL de Imagen" ["ValorRupia (solo para monedas)"]`');
            }

            const nombre = matches[0][1];
            const idNumber = parseInt(idMatch[1]);
            const descripcion = matches[1][1];
            const tipo = matches[2][1].toLowerCase();
            const imagenUrl = matches[3] ? matches[3][1] : '';

            let valorRupia = 0;
            if (tipo === 'moneda') {
                if (matches.length < 4) {
                    return message.reply('Para items tipo **moneda**, debes especificar el valor en Rupias: `!Zcrearitem "Nombre" <ID> "Desc" "moneda" "URL" "ValorRupia"`');
                }
                valorRupia = parseInt(matches[4][1]);
                if (isNaN(valorRupia) || valorRupia <= 0) {
                    return message.reply('El ValorRupia para las monedas debe ser un número entero positivo.');
                }
            }

            if (!TIPOS_VALIDOS.includes(tipo)) {
                return message.reply(`El tipo de objeto debe ser uno de estos: ${TIPOS_VALIDOS.join(', ')}.`);
            }

            const id = `item_${idNumber}`;
            const existingItem = await compendioDB.get(id);
            if (existingItem) {
                return message.reply(`¡El objeto con ID **${id}** ya está registrado! Por favor, usa un ID diferente.`);
            }

            const now = new Date();
            const newItem = {
                id: id,
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
            console.log(`Ítem creado: ${id} - ${nombre}`);

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

            await message.channel.send({ embeds: [embed] });
        } catch (error) {
            console.error('Error en !Zcrearitem:', error);
            await message.reply('¡Error al registrar el objeto en el Compendio de Hyrule! Contacta a un administrador.');
        }
    }

    // --- COMANDO: VER ITEM (Público) ---
    if (command === 'veritem') {
        try {
            const regex = /"([^"]+)"/;
            const match = fullCommand.match(regex);

            if (!match) {
                return message.reply('Uso: `!Zveritem "ID del Objeto"` (Ejemplo: `!Zveritem "item_22"`)');
            }

            const id = match[1];
            console.log(`Buscando ítem con ID: ${id}`);
            const item = await compendioDB.get(id);

            if (!item) {
                console.log(`Ítem no encontrado: ${id}`);
                return message.reply(`No se encontró ningún objeto con ID **${id}** en el Compendio de Hyrule.`);
            }

            console.log(`Ítem encontrado: ${id} - ${item.nombre}`);
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

            await message.channel.send({ embeds: [embed] });
        } catch (error) {
            console.error('Error en !Zveritem:', error);
            await message.reply('¡Error al consultar el objeto en el Compendio de Hyrule! Contacta a un administrador.');
        }
    }

    // --- COMANDO: LISTAR ITEMS (Público) ---
    if (command === 'itemslista') {
        console.log('Ejecutando !Zitemslista');
        try {
            const items = await obtenerTodosItems();

            if (items.length === 0) {
                console.log('Compendio vacío');
                return message.channel.send('***El Compendio de Hyrule está vacío. ¡Que las Diosas traigan el primer tesoro!***');
            }

            const embed = new EmbedBuilder()
                .setColor(LIST_EMBED_COLOR)
                .setTitle('🏰 Compendio de Objetos de Nuevo Hyrule 🏰')
                .setDescription(`*Explora los tesoros registrados en Hyrule.*`);

            items.slice(0, 25).forEach(item => {
                embed.addFields({
                    name: `**${item.nombre}** (ID: ${item.id})`,
                    value: `**Imagen:** [Ver](${item.imagen || 'https://example.com/placeholder.png'})\n**Fecha de Creación:** ${item.fecha}`,
                    inline: false
                });
            });

            if (items.length > 25) {
                embed.setFooter({ text: `Mostrando ${items.length > 25 ? 25 : items.length} de ${items.length} ítems. Algunos ítems no se muestran debido a limitaciones.` });
            } else {
                embed.setFooter({ text: `Total de ítems: ${items.length}` });
            }

            console.log('Enviando embed de !Zitemslista');
            await message.channel.send({ embeds: [embed] });
        } catch (error) {
            console.error('Error en !Zitemslista:', error);
            await message.reply('¡Error al listar el Compendio de Hyrule! Contacta a un administrador.');
        }
    }

    // --- COMANDO: ELIMINAR ITEM (Staff) ---
    if (command === 'eliminaritem') {
        if (!hasAdminPerms) {
            console.log('Usuario sin permisos intentó usar !Zeliminaritem:', message.author.tag);
            return message.reply('¡Alto ahí! Solo los **Administradores Canon** pueden eliminar objetos del Compendio.');
        }

        try {
            const regex = /"([^"]+)"/;
            const match = fullCommand.match(regex);

            if (!match) {
                return message.reply('Uso: `!Zeliminaritem "Nombre o ID del Objeto"` (Ejemplo: `!Zeliminaritem "Rupia Verde"` o `!Zeliminaritem "item_22"`)');
            }

            const input = match[1];
            let item = await compendioDB.get(input); // Buscar por ID
            let itemId = input;

            // Si no se encuentra por ID, buscar por nombre
            if (!item) {
                const items = await obtenerTodosItems();
                item = items.find(i => i.nombre.toLowerCase() === input.toLowerCase());
                if (item) {
                    itemId = item.id;
                }
            }

            if (!item) {
                console.log(`Ítem no encontrado para eliminar: ${input}`);
                return message.reply(`No se encontró ningún objeto con nombre o ID **${input}** en el Compendio de Hyrule.`);
            }

            await compendioDB.delete(itemId);
            console.log(`Ítem eliminado: ${itemId} - ${item.nombre}`);

            const embed = new EmbedBuilder()
                .setColor(LIST_EMBED_COLOR)
                .setTitle(`🗑️ Objeto Eliminado: ${item.nombre}`)
                .setDescription(`¡El objeto ha sido retirado del Compendio de Hyrule!`)
                .addFields(
                    { name: 'ID', value: itemId, inline: true },
                    { name: 'Nombre', value: item.nombre, inline: true }
                )
                .setFooter({ text: `Eliminado por: ${message.author.tag} | Las Diosas han hablado.` });

            await message.channel.send({ embeds: [embed] });
        } catch (error) {
            console.error('Error en !Zeliminaritem:', error);
            await message.reply('¡Error al eliminar el objeto del Compendio de Hyrule! Contacta a un administrador.');
        }
    }
});

client.login(process.env.DISCORD_TOKEN);