const fs = require('fs');
const https = require('https');
const { exec } = require('child_process');
const ffmpeg = require('ffmpeg-static'); // Подключаем обрезчик звука

// === НАСТРОЙКИ ===
const GITHUB_URL = 'https://whytokey.github.io/guess-song-music/music/';
const TARGET_COUNT = 1200; 
const DURATION = 7;      // Длина трека (7 секунд хватит с запасом для игры)
const BITRATE = '48k';   // Сильное сжатие для экономии веса (на телефоне звучит норм)

const searchTerms = [
    'русский хит', 'попса', 'рэп', 'кальянный', 'tiktok', 
    'русский рок', 'радио', 'vk', 'dance', 'love', 
    'top', '2023', '2024', 'новинки', 'музыка', 
    'шансон', 'инди', 'хиты 90', 'хиты 2000', 'дискотека'
];

if (!fs.existsSync('./music')) fs.mkdirSync('./music');

function searchiTunes(term) {
    return new Promise((resolve) => {
        const url = `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&country=ru&entity=song&limit=200`;
        https.get(url, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(body).results || []); } 
                catch(e) { resolve([]); }
            });
        }).on('error', () => resolve([]));
    });
}

// Новая функция: Качает оригинал -> Обрезает и сжимает -> Удаляет оригинал
function processTrack(url, tempDest, finalDest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(tempDest);
        https.get(url, (res) => {
            res.pipe(file);
            file.on('finish', () => {
                file.close();
                
                // Команда для ffmpeg: обрезать (-t) и сжать битрейт (-b:a)
                const cmd = `"${ffmpeg}" -y -i "${tempDest}" -t ${DURATION} -b:a ${BITRATE} "${finalDest}"`;
                
                exec(cmd, (err) => {
                    // Всегда удаляем тяжелый исходник
                    if (fs.existsSync(tempDest)) fs.unlinkSync(tempDest);
                    
                    if (err) reject(err);
                    else resolve();
                });
            });
        }).on('error', (err) => {
            if (fs.existsSync(tempDest)) fs.unlinkSync(tempDest);
            reject(err);
        });
    });
}

async function start() {
    console.log('Ищем треки в iTunes...');
    
    let allTracks = [];
    for (const term of searchTerms) {
        process.stdout.write(`Ищем: ${term}... `);
        const results = await searchiTunes(term);
        allTracks = allTracks.concat(results);
        console.log(`Найдено: ${results.length}`);
    }

    const uniqueTracks = new Map();
    allTracks.forEach(t => {
        if (t.previewUrl && t.trackName && t.artistName) {
            uniqueTracks.set(t.trackId, t);
        }
    });

    let tracksToDownload = Array.from(uniqueTracks.values());
    if (tracksToDownload.length > TARGET_COUNT) {
        tracksToDownload = tracksToDownload.slice(0, TARGET_COUNT);
    }

    const catalog = [];
    console.log(`\nНачинаем скачивание и сжатие ${tracksToDownload.length} файлов...`);

    for (let i = 0; i < tracksToDownload.length; i++) {
        const track = tracksToDownload[i];
        const finalName = `${i + 1}.mp3`;
        const tempName = `./music/temp_${i}.m4a`; // iTunes отдает m4a
        const finalPath = `./music/${finalName}`;
        
        try {
            await processTrack(track.previewUrl, tempName, finalPath);
            
            catalog.push({
                trackName: track.trackName,
                artistName: track.artistName,
                previewUrl: `${GITHUB_URL}${finalName}`
            });
            
            process.stdout.write(`\rОбработано: ${i + 1} / ${tracksToDownload.length}`);
        } catch (e) {
            console.log(`\nОшибка при обработке: ${track.trackName}`);
        }
    }

    fs.writeFileSync('catalog.json', JSON.stringify(catalog, null, 2));
    console.log('\n\n✅ Успешно! Файлы обрезаны, база сохранена в catalog.json');
}

start();