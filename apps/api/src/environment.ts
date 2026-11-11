import { z } from "@pmt/shared";
export function validateEnvironment(env: NodeJS.ProcessEnv) {
  const port = z.coerce.number().int().min(1).max(65535);
  const schema = z.object({
    DATABASE_URL: z
      .string()
      .url()
      .refine(
        (v) => /^mongodb(?:\+srv)?:\/\//.test(v),
        "MongoDB connection URL required",
      ),
    APP_ORIGIN: z.string().url(),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: port.optional(),
    API_PORT: port.default(4000),
    IDENTITY_MAIL_KEY: z.string().regex(/^[a-f0-9]{64}$/i),
    INVITATION_HOURS: z.coerce.number().int().min(1).max(168).default(48),
    SESSION_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  });
  const result = schema.safeParse(env);
  if (!result.success) {
    const fields = result.error.flatten().fieldErrors;
    const databaseHelp = fields.DATABASE_URL
      ? ". Set DATABASE_URL to a MongoDB connection string (mongodb:// or mongodb+srv://)"
      : "";
    throw new Error(
      `Invalid environment configuration: ${Object.keys(fields).join(", ")}${databaseHelp}`,
    );
  }
  if (
    result.data.NODE_ENV === "production" &&
    new URL(result.data.APP_ORIGIN).protocol !== "https:"
  )
    throw new Error("Production APP_ORIGIN must use HTTPS");
  return result.data;
}
