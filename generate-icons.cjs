const fs = require('fs');
const sharp = require('sharp');
const pngToIco = require('png-to-ico').default || require('png-to-ico');
const path = require('path');

async function generate() {
    const svgPath = path.join(__dirname, 'public', 'favicon.svg');
    const png192Path = path.join(__dirname, 'public', 'logo192.png');
    const png512Path = path.join(__dirname, 'public', 'logo512.png');
    const appleTouchPath = path.join(__dirname, 'public', 'apple-touch-icon.png');
    const icoPath = path.join(__dirname, 'public', 'favicon.ico');

    // Generate 192x192 PNG
    await sharp(svgPath)
        .resize(192, 192)
        .toFile(png192Path);

    // Generate 512x512 PNG
    await sharp(svgPath)
        .resize(512, 512)
        .toFile(png512Path);

    // Generate Apple Touch Icon (180x180 with white background)
    await sharp({
        create: {
            width: 180,
            height: 180,
            channels: 4,
            background: { r: 255, g: 255, b: 255, alpha: 1 }
        }
    })
        .composite([{ input: await sharp(svgPath).resize(150, 150).toBuffer() }])
        .png()
        .toFile(appleTouchPath);

    // Generate an intermediary 256x256 PNG for ICO
    const tempPng = path.join(__dirname, 'public', 'temp-icon.png');
    await sharp(svgPath)
        .resize(256, 256)
        .toFile(tempPng);

    // Generate ICO
    const buf = await pngToIco(tempPng);
    fs.writeFileSync(icoPath, buf);

    // Clean up temp
    fs.unlinkSync(tempPng);

    console.log('Icons generated successfully!');
}

generate().catch(console.error);
