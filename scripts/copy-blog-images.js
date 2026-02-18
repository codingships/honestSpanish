import fs from 'fs';
import path from 'path';

const srcDir = path.join('public', 'images', 'blog');
const destDir = path.join('src', 'assets', 'blog');

console.log(`Copying from ${srcDir} to ${destDir}`);

if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
    console.log('Created destination directory');
}

try {
    const files = fs.readdirSync(srcDir);
    files.forEach(file => {
        const srcFile = path.join(srcDir, file);
        const destFile = path.join(destDir, file);
        if (fs.lstatSync(srcFile).isFile()) {
            fs.copyFileSync(srcFile, destFile);
            console.log(`Copied ${file}`);
        }
    });
    console.log('All files copied successfully.');
} catch (error) {
    console.error('Error copying files:', error);
    process.exit(1);
}
