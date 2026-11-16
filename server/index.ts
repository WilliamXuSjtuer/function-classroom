import { configFromEnv } from "./config.js";
import { createApp } from "./app.js";
import { seedDemo } from "./seed.js";
const config = configFromEnv();
const { app, store } = await createApp(config);
store.run(
  "UPDATE messages SET status='failed',error='服务重新启动，原消息已保存，请重试。' WHERE status='pending'",
);
if (config.demo) await seedDemo(store);
const server = app.listen(config.port, config.host, () =>
  console.log(
    `Classroom API: http://${config.host}:${config.port}${config.demo ? " (explicit demo mode)" : ""}`,
  ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(() => {
      store.close();
      process.exit(0);
    }),
  );
