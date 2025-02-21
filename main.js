const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const ytdl = require('ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const fs = require('fs');

// Указываем путь к FFmpeg
ffmpeg.setFfmpegPath(ffmpegPath);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let store;
let mainWindow;

async function createStore() {
    const { default: Store } = await import('electron-store');
    store = new Store();
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            enableRemoteModule: false,
            nodeIntegration: false,
        },
    });

    mainWindow.loadFile('index.html');
}

app.whenReady().then(async () => {
    await createStore();
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});

function sanitizeTitle(title) {
    return title.replace(/[<>:"/\\|?*]/g, ''); // Удаляем недопустимые символы для путей
}

ipcMain.handle('download-video', async (event, { url, format }) => {
    await delay(2000);
    if (!url || !ytdl.validateURL(url)) {
        throw new Error('Invalid YouTube URL');
    }

    const videoInfo = await ytdl.getInfo(url);
    const title = sanitizeTitle(videoInfo.videoDetails.title);
    const outputPath = path.join(app.getPath('downloads'), `${title}.${format === 'audio' ? 'mp3' : 'mp4'}`);

    try {
        if (format === 'audio') {
            // Загрузка только аудио в максимальном качестве
            await new Promise((resolve, reject) => {
                ffmpeg(ytdl(url, { quality: 'highestaudio' }))
                    .format('mp3')
                    .on('error', (err) => {
                        console.error('FFmpeg error:', err);
                        reject(new Error(`FFmpeg failed: ${err.message}`));
                    })
                    .on('end', () => {
                        const history = store.get('history') || [];
                        history.push({ title, path: outputPath, url });
                        store.set('history', history);
                        resolve(outputPath);
                    })
                    .save(outputPath);
            });
        } else {
            // Загрузка видео в максимальном качестве
            const videoFormat = ytdl.chooseFormat(videoInfo.formats, { quality: 'highestvideo' });
            const audioFormat = ytdl.chooseFormat(videoInfo.formats, { quality: 'highestaudio' });

            if (!videoFormat) {
                throw new Error('Failed to find video format');
            }
            if (!audioFormat) {
                throw new Error('Failed to find audio format');
            }

            // Временные файлы для видео и аудио
            const videoTempPath = path.join(app.getPath('temp'), `${title}_video.mp4`);
            const audioTempPath = path.join(app.getPath('temp'), `${title}_audio.mp4`);

            // Загрузка видео
            await new Promise((resolve, reject) => {
                const videoStream = ytdl(url, { format: videoFormat });
                const fileStream = fs.createWriteStream(videoTempPath);

                videoStream.on('error', (err) => {
                    console.error('Video download error:', err);
                    reject(new Error(`Video download failed: ${err.message}`));
                });

                fileStream.on('error', (err) => {
                    console.error('File write error:', err);
                    reject(new Error(`File write failed: ${err.message}`));
                });

                fileStream.on('finish', resolve);

                videoStream.pipe(fileStream);
            });

            // Загрузка аудио
            await new Promise((resolve, reject) => {
                const audioStream = ytdl(url, { format: audioFormat });
                const fileStream = fs.createWriteStream(audioTempPath);

                audioStream.on('error', (err) => {
                    console.error('Audio download error:', err);
                    reject(new Error(`Audio download failed: ${err.message}`));
                });

                fileStream.on('error', (err) => {
                    console.error('File write error:', err);
                    reject(new Error(`File write failed: ${err.message}`));
                });

                fileStream.on('finish', resolve);

                audioStream.pipe(fileStream);
            });

            // Объединение видео и аудио с помощью ffmpeg
            await new Promise((resolve, reject) => {
                ffmpeg()
                    .input(videoTempPath)
                    .input(audioTempPath)
                    .outputOptions('-c:v copy') // Копируем видео без перекодирования
                    .outputOptions('-c:a aac')  // Кодируем аудио в AAC
                    .on('error', (err) => {
                        console.error('FFmpeg merge error:', err);
                        reject(new Error(`FFmpeg merge failed: ${err.message}`));
                    })
                    .on('end', () => {
                        // Удаляем временные файлы
                        fs.unlinkSync(videoTempPath);
                        fs.unlinkSync(audioTempPath);

                        const history = store.get('history') || [];
                        history.push({ title, path: outputPath, url });
                        store.set('history', history);
                        resolve(outputPath);
                    })
                    .save(outputPath);
            });
        }
    } catch (error) {
        console.error(`Download failed: ${error.message}`);
        throw new Error(`Download failed: ${error.message}`);
    }

    return outputPath;
});

ipcMain.handle('get-history', () => {
    return store.get('history') || [];
});

ipcMain.handle('delete-history-item', (event, url) => {
    const history = store.get('history') || [];
    const updatedHistory = history.filter(item => item.url !== url);
    store.set('history', updatedHistory);
    return updatedHistory;
});

ipcMain.handle('open-folder', (event, path) => {
    shell.showItemInFolder(path);
});