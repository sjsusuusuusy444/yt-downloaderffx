const fs = require('fs');
const https = require('https');
const path = require('path');

const isWin = process.platform === 'win32';
const url = isWin 
  ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' 
  : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';
const dest = path.join(__dirname, isWin ? 'yt-dlp.exe' : 'yt-dlp');

console.log(`Downloading yt-dlp from ${url}...`);

function downloadFile(downloadUrl, destination) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destination);
    https.get(downloadUrl, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        // Handle redirect
        downloadFile(response.headers.location, destination).then(resolve).catch(reject);
      } else if (response.statusCode === 200) {
        response.pipe(file);
        file.on('finish', () => {
          file.close();
          if (!isWin) {
            try {
              fs.chmodSync(destination, '755'); // Make executable on Linux
            } catch (err) {
              console.error('Failed to set permissions:', err);
            }
          }
          console.log('yt-dlp downloaded successfully!');
          resolve();
        });
      } else {
        reject(new Error(`Failed to download: status code ${response.statusCode}`));
      }
    }).on('error', (err) => {
      fs.unlink(destination, () => {});
      reject(err);
    });
  });
}

downloadFile(url, dest).catch(err => {
  console.error('Error downloading yt-dlp:', err.message);
  process.exit(1);
});
