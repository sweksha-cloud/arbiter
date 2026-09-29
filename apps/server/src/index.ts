import Fastify from 'fastify';
import { Server } from 'socket.io';

const app = Fastify({ logger: true });
const io = new Server(app.server, {
  cors: { origin: '*' }
});

app.get('/health', async () => ({ status: 'ok' }));

io.on('connection', (socket) => {
  socket.emit('session:connected', { message: 'Connected to Arbiter session server.' });
});

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? '0.0.0.0';

await app.listen({ port, host });
