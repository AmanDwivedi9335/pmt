import "./telemetry";
import { config } from "dotenv";
import { resolve } from "node:path";
import { createApp } from "./app";
import { validateEnvironment } from "./environment";
config({ path: resolve(process.cwd(), "../../.env") });
const env = validateEnvironment(process.env);
createApp()
  .then((app) => app.listen(env.PORT ?? env.API_PORT, "0.0.0.0"))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
