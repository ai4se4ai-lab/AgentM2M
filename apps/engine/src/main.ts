import { buildServer } from "./http/server.js";

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";

const { app } = buildServer({ dataDir: process.env.DATA_DIR });

app
  .listen({ port, host })
  .then(() => {
    // eslint-disable-next-line no-console
    console.log(`AgentM2M engine listening on http://${host}:${port}`);
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
