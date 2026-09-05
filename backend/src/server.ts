import 'dotenv/config';
import { app } from './app.js';
import { db } from './db.js';

const port = Number(process.env.PORT ?? 4000);
const server = app.listen(port, () => console.log(`DealOS API ready at http://localhost:${port}`));

async function shutdown() {
  server.close(async () => {
    await db.$disconnect();
    process.exit(0);
});
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
