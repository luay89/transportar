// Builds dist/demo.html: one self-contained page that runs the whole app in demo mode
// (data kept in the browser), for previews where no server is running.
const fs = require('fs');
const path = require('path');
const pub = p => fs.readFileSync(path.join(__dirname, '..', 'public', p), 'utf8');
const html = pub('index.html');
const body = html.split('<!--APP-->')[1].split('<!--/APP-->')[0];
// Same order as index.html, without the street-map library (the demo uses the built-in schematic map).
const files = [...html.matchAll(/<script src="\/([^"]+)"/g)].map(m => m[1]).filter(f => !f.startsWith('vendor/leaflet'));
const js = files.map(pub).join('\n;\n');
if (/<\/script/i.test(js)) throw new Error('inline script contains </script');
const out = `<title>Transportar</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Overpass:wght@400;600;700;800&family=Overpass+Mono:wght@400;700&family=IBM+Plex+Sans+Arabic:wght@400;600;700&display=swap">
<style>
${pub('styles.css')}
</style>
${body}
<script>
${js}
</script>
`;
fs.mkdirSync(path.join(__dirname, '..', 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'dist', 'demo.html'), out);
console.log('dist/demo.html', (out.length / 1024).toFixed(1) + ' KB');
