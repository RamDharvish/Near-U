const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const assetsDir = path.join(projectRoot, 'assets');
const tempDir = path.join(projectRoot, '.temp_assets');

if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const BRAND_PURPLE = '#7958CF';
const WHITE = '#FFFFFF';

// Symmetrical, modern, smooth bezier heart path
const HEART_BASE_PATH = `
  M 512 360
  C 486 295 425 252 345 252
  C 238 252 165 335 165 448
  C 165 572 285 675 496 788
  C 506 794 518 794 528 788
  C 739 675 859 572 859 448
  C 859 335 786 252 679 252
  C 599 252 538 295 512 360
  Z
`;

function renderPng(targetFile, width, height, svgContent, bgColor = 'transparent') {
  const tempHtml = path.join(tempDir, `${path.basename(targetFile, '.png')}.html`);

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    width: ${width}px;
    height: ${height}px;
    background: ${bgColor};
    overflow: hidden;
  }
  svg {
    width: ${width}px;
    height: ${height}px;
    display: block;
  }
</style>
</head>
<body>
  ${svgContent}
</body>
</html>`;

  fs.writeFileSync(tempHtml, html, 'utf8');

  execFileSync(chromePath, [
    '--headless=new',
    `--screenshot=${targetFile}`,
    `--window-size=${width},${height}`,
    '--default-background-color=00000000',
    '--hide-scrollbars',
    `file:///${tempHtml.replace(/\\/g, '/')}`
  ]);

  console.log(`✓ Rendered ${path.relative(projectRoot, targetFile)} (${width}x${height}, ${fs.statSync(targetFile).size} bytes)`);
}

// 1. icon.png (1024x1024, Solid #7958CF background with centered white heart)
const iconSvg = `
<svg width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="${BRAND_PURPLE}" />
  <g transform="translate(512, 512) scale(0.50) translate(-512, -510)">
    <path d="${HEART_BASE_PATH}" fill="${WHITE}" />
  </g>
</svg>
`;
renderPng(path.join(assetsDir, 'icon.png'), 1024, 1024, iconSvg, BRAND_PURPLE);

// 2. android-icon-foreground.png (1024x1024, 100% transparent background with centered white heart within 66dp safe zone)
const foregroundSvg = `
<svg width="1024" height="1024" viewBox="0 0 1024 1024">
  <g transform="translate(512, 512) scale(0.50) translate(-512, -510)">
    <path d="${HEART_BASE_PATH}" fill="${WHITE}" />
  </g>
</svg>
`;
renderPng(path.join(assetsDir, 'android-icon-foreground.png'), 1024, 1024, foregroundSvg, 'transparent');

// 3. android-icon-background.png (1024x1024, Solid #7958CF background)
const backgroundSvg = `
<svg width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="${BRAND_PURPLE}" />
</svg>
`;
renderPng(path.join(assetsDir, 'android-icon-background.png'), 1024, 1024, backgroundSvg, BRAND_PURPLE);

// 4. android-icon-monochrome.png (1024x1024, transparent background with centered white heart for Android Material You)
const monochromeSvg = `
<svg width="1024" height="1024" viewBox="0 0 1024 1024">
  <g transform="translate(512, 512) scale(0.50) translate(-512, -510)">
    <path d="${HEART_BASE_PATH}" fill="${WHITE}" />
  </g>
</svg>
`;
renderPng(path.join(assetsDir, 'android-icon-monochrome.png'), 1024, 1024, monochromeSvg, 'transparent');

// 5. splash-icon.png (1024x1024, transparent background with centered white heart)
const splashSvg = `
<svg width="1024" height="1024" viewBox="0 0 1024 1024">
  <g transform="translate(512, 512) scale(0.50) translate(-512, -510)">
    <path d="${HEART_BASE_PATH}" fill="${WHITE}" />
  </g>
</svg>
`;
renderPng(path.join(assetsDir, 'splash-icon.png'), 1024, 1024, splashSvg, 'transparent');

// 6. favicon.png (48x48, solid #7958CF background with centered white heart)
const faviconSvg = `
<svg width="48" height="48" viewBox="0 0 48 48">
  <rect width="48" height="48" rx="10" fill="${BRAND_PURPLE}" />
  <g transform="translate(24, 23.8) scale(0.038) translate(-512, -520)">
    <path d="${HEART_BASE_PATH}" fill="${WHITE}" />
  </g>
</svg>
`;
renderPng(path.join(assetsDir, 'favicon.png'), 48, 48, faviconSvg, BRAND_PURPLE);

// 7. notification-icon.png (96x96, transparent background with centered white heart for Android status bar)
const notificationSvg = `
<svg width="96" height="96" viewBox="0 0 96 96">
  <g transform="translate(48, 47.6) scale(0.076) translate(-512, -520)">
    <path d="${HEART_BASE_PATH}" fill="${WHITE}" />
  </g>
</svg>
`;
renderPng(path.join(assetsDir, 'notification-icon.png'), 96, 96, notificationSvg, 'transparent');

// Clean up temp directory
try {
  fs.rmSync(tempDir, { recursive: true, force: true });
} catch (e) {}

console.log('All NearU assets generated successfully!');
