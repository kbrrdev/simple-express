import { writeFileSync } from 'node:fs';
import { buildPostmanCollection } from './postman';

const path = 'docs/postman-collection.json';

writeFileSync(path, `${JSON.stringify(buildPostmanCollection(), null, 2)}\n`);
console.log(`Wrote ${path}`);
