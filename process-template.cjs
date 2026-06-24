// Post-build script: substitutes Mustache template variables in index.html
// so it can be served as a static file on Vercel without a backend server.
const fs = require('fs');

const indexPath = 'play/dist/public/index.html';
let html = fs.readFileSync(indexPath, 'utf8');

// Set meaningful values for key meta variables
html = html.replace(/\{\{ title \}\}/g, 'WorkAdventure - Vings Workplace');
html = html.replace(/\{\{ description \}\}/g, 'A collaborative virtual office presented as a 16-bit RPG video game');
html = html.replace(/\{\{ author \}\}/g, 'WorkAdventure');
html = html.replace(/\{\{ provider \}\}/g, 'WorkAdventure');
html = html.replace(/\{\{ themeColor \}\}/g, '#000000');
html = html.replace(/\{\{ url \}\}/g, 'https://vings-workplace.vercel.app');
html = html.replace(/\{\{ cardImage \}\}/g, '');
html = html.replace(/\{\{ msApplicationTileImage \}\}/g, '');

// Remove optional conditional blocks (analytics, icons, etc.)
html = html.replace(/\{\{#favIcons\}\}[\s\S]*?\{\{\/favIcons\}\}/g, '');
html = html.replace(/\{\{#posthogApiKey\}\}[\s\S]*?\{\{\/posthogApiKey\}\}/g, '');
html = html.replace(/\{\{#posthogUrl\}\}[\s\S]*?\{\{\/posthogUrl\}\}/g, '');
html = html.replace(/\{\{#logRocketId\}\}[\s\S]*?\{\{\/logRocketId\}\}/g, '');
html = html.replace(/\{\{#googleDrivePickerClientId\}\}[\s\S]*?\{\{\/googleDrivePickerClientId\}\}/g, '');

// Strip any remaining triple-stash and double-stash variables
html = html.replace(/\{\{\{[^}]+\}\}\}/g, '');
html = html.replace(/\{\{[^}]+\}\}/g, '');

fs.writeFileSync(indexPath, html);
console.log('index.html template variables substituted successfully.');
