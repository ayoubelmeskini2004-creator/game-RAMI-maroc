import { createApp } from './app.js';

const port = process.env.PORT || 3001;
const { httpServer } = createApp();
httpServer.listen(port, () => console.log(`Rami Marocain 71 — http://localhost:${port}`));
