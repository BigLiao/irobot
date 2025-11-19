import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 4100;
const STATIC_ROOT = path.join(__dirname, 'static');
const PAGES_DIR = path.join(STATIC_ROOT, 'pages');

app.use(express.json());
app.use('/pages', express.static(PAGES_DIR));
app.use(express.static(STATIC_ROOT));

app.get('/api/test', (_req, res) => {
  res.json({
    status: 'ok',
    message: 'html-demo test endpoint reached',
    timestamp: new Date().toISOString()
  });
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(PAGES_DIR, 'test.html'));
});

app.listen(PORT, () => {
  console.log(`html-demo sandbox listening on http://localhost:${PORT}`);
  console.log('Test page: http://localhost:' + PORT + '/pages/test.html');
});
