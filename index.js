// Carga la librería 'dotenv' para leer el archivo .env (donde está el Token secreto)
require('dotenv').config();

// Importa las clases necesarias de discord.js
const { 
    Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder, 
    ActionRowBuilder, ButtonBuilder, ButtonStyle 
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

// === MODIFICACIÓN: ORDENAR POR FECHA DE CREACIÓN ===
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

// === MODIFICACIÓN: FUNCIÓN DE PAGINACIÓN PARA ENEMIGOS ===
function createEnemyEmbedPage(enemies, pageIndex) {
    const ENEMIES_PER_PAGE = 5;
    const start = pageIndex * ENEMIES_PER_PAGE;
    const end = start + ENEMIES_PER_PAGE;
    const enemiesToShow = enemies.slice(start, end);
    const totalPages = Math.ceil(enemies.length / ENEMIES_PER_PAGE);

    const embed = new EmbedBuilder()
        .setColor(ENEMY_EMBED_COLOR) 
        .setTitle('👹 Compendio de Monstruos de Nuevo Hyrule ⚔️')
        .setDescription(`*Página ${pageIndex + 1} de ${totalPages}. Solo se muestran ${ENEMIES_PER_PAGE} enemigos por página.*`) // Nuevo: Mostrar info de paginación
        .setFooter({ text: `Página ${pageIndex + 1} de ${totalPages} | Consultado vía Zelda BOT | Usa los botones para navegar.` }); // Nuevo: Footer con formato para interacción

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
    
    // 2. Lógica de Apertura de Cofre
    if (interaction.isButton() && interaction.customId.startsWith('open_chest_')) {
        const itemId = interaction.customId.replace('open_chest_', '');
        const item = await compendioDB.get(itemId); 
        
        if (interaction.message.components.length === 0 || interaction.message.components[0].components[0].disabled) {
            return interaction.reply({ content: 'Este cofre ya ha sido abierto.', ephemeral: true });
        }

        if (!item) {
            return interaction.reply({ content: 'El tesoro no se encontró en el compendio. Notifica al Staff.', ephemeral: true });
        }
        
        // Deshabilitar el botón original 
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
            .setThumbnail(item.imagen) 
            .addFields(
                { name: 'Descripción del Objeto', value: item.descripcion, inline: false }
            );
        
        // Enviar el mensaje de recompensa
        await interaction.channel.send({ 
            content: `${interaction.user} ha abierto el cofre.`,
            embeds: [rewardEmbed] 
        });
    }

    // 3. Lógica de Botones de Encuentro
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
});

client.on('messageCreate', async message => {
    if (message.author.bot) return; 

    const hasAdminPerms = message.member.roles.cache.has(ADMIN_ROLE_ID) || message.member.permissions.has(PermissionsBitField.Flags.Administrator);

    // --- ELIMINADA LÓGICA DE RESPUESTA DE EDICIÓN ---
    
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
                        `\`!Zcrearitem "Nombre" "Desc" "Tipo" "URL"\`: Registra un nuevo objeto.`,
                        `\`!Zeliminaritem "Nombre"\`: Borra un objeto.`,
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

        const existingItem = await compendioDB.get(id);
        if (existingItem) {
            return message.reply(`¡El objeto **${nombre}** ya está registrado!`);
        }

        const now = new Date();
        const newItem = {
            nombre: nombre,
            descripcion: descripcion,
            tipo: tipo,
            disponible: true, 
            imagen: imagenUrl, 
            registradoPor: message.author.tag,
            fecha: now.toLocaleDateString('es-ES'),
            // === ADICIÓN PARA ORDENAMIENTO ===
            fechaCreacionMs: now.getTime() 
            // =================================
        };
        
        await compendioDB.set(id, newItem); // GUARDADO A LA DB
        
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
        
        await compendioDB.delete(id); // ELIMINADO DE LA DB

        const embed = new EmbedBuilder()
            .setColor('#cc0000') 
            .setTitle(`🗑️ Objeto Eliminado: ${itemEliminado.nombre}`)
            .setDescription(`El objeto **${itemEliminado.nombre}** ha sido borrado permanentemente del Compendio de Nuevo Hyrule.`);
        
        message.channel.send({ embeds: [embed] });
    }

    // --- ELIMINADO COMANDO: EDITAR ITEM ---

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
        // OBTENER DE LA DB Y ORDENAR
        const items = await obtenerTodosItems(); 
        
        if (items.length === 0) {
            return message.channel.send('***El Compendio de Objetos está vacío. ¡Que se registre el primer tesoro!***');
        }

        const currentPage = 0;
        const { embed, totalPages } = createItemEmbedPage(items, currentPage);
        const row = createPaginationRow(currentPage, totalPages);
        
        message.channel.send({ embeds: [embed], components: [row] });
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
        
        await enemigosDB.delete(id); // ELIMINADO DE LA DB

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
                .setCustomId(`open_chest_${itemId}`)
                .setLabel('Abrir Cofre')
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
        const { embed, totalPages } = createEnemyEmbedPage(enemies, currentPage); // <--- Nuevo: Obtener embed y totalPages
        const row = createPaginationRow(currentPage, totalPages); // <--- Nuevo: Crear botones
        
        message.channel.send({ embeds: [embed], components: [row] }); // <--- Nuevo: Enviar con botones
    }
});

client.login(process.env.DISCORD_TOKEN);