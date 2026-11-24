import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(app, 'dist');
if (!fs.existsSync(path.join(app, 'frontend/dist/index.html')))
  throw new Error('Сначала соберите React.');
fs.rmSync(output, { recursive: true, force: true });
fs.cpSync(path.join(app, 'frontend/dist'), output, { recursive: true });
fs.cpSync(path.join(app, 'backend/src'), path.join(output, 'backend'), { recursive: true });
fs.cpSync(path.join(app, 'backend/database'), path.join(output, 'database'), { recursive: true });
fs.copyFileSync(
  path.join(app, 'backend/config.example.php'),
  path.join(output, 'config.example.php'),
);
fs.writeFileSync(
  path.join(output, 'api.php'),
  "<?php\ndeclare(strict_types=1);\nrequire __DIR__ . '/backend/api.php';\n",
);
fs.writeFileSync(
  path.join(output, '.htaccess'),
  `Options -Indexes
DirectoryIndex index.html
RewriteEngine On
RewriteRule ^(?:backend|database)(?:/|$) - [F,L]
RewriteRule ^api(?:/.*)?$ api.php [QSA,L]
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule ^ index.html [L]
<IfModule mod_headers.c>
    <FilesMatch "^(?:index\\.html|release\\.json)$">
        Header always set Cache-Control "no-cache, max-age=0, must-revalidate"
    </FilesMatch>
</IfModule>
<FilesMatch "^(?:config\\..*\\.php|\\..*)$">
    Require all denied
</FilesMatch>
`,
);
for (const directory of ['backend', 'database'])
  fs.writeFileSync(path.join(output, directory, '.htaccess'), 'Require all denied\n');
console.log(`Сборка React + PHP: ${output}`);
