const fs = require('fs');
const path = require('path');

const wwwDir = path.join(__dirname, 'www');
if (!fs.existsSync(wwwDir)) {
  fs.mkdirSync(wwwDir, { recursive: true });
}

const filesToCopy = [
  'index.html',
  'style.css',
  'app.js',
  'manifest.json',
  'sw.js',
  'icon.png',
  'icon-192.png',
  'icon-512.png',
  'icon-512.svg'
];

filesToCopy.forEach(file => {
  const src = path.join(__dirname, file);
  const dest = path.join(wwwDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
  }
});

const iconsDir = path.join(__dirname, 'icons');
const wwwIconsDir = path.join(wwwDir, 'icons');
if (fs.existsSync(iconsDir)) {
  fs.cpSync(iconsDir, wwwIconsDir, { recursive: true });
}

// Sincronizar avatar Kumo a Android res/drawable para notificaciones nativas
const kumoAvatarSrc = path.join(iconsDir, 'kumo-avatar.png');
const androidResDir = path.join(__dirname, 'android', 'app', 'src', 'main', 'res');
if (fs.existsSync(kumoAvatarSrc) && fs.existsSync(androidResDir)) {
  const targetDirs = ['drawable', 'mipmap-hdpi', 'mipmap-mdpi', 'mipmap-xhdpi', 'mipmap-xxhdpi', 'mipmap-xxxhdpi'];
  targetDirs.forEach(dirName => {
    const dirPath = path.join(androidResDir, dirName);
    if (fs.existsSync(dirPath)) {
      fs.copyFileSync(kumoAvatarSrc, path.join(dirPath, 'kumo_avatar.png'));
    }
  });
}

console.log('✓ www directory synced successfully');

