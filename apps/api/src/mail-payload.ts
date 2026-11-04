import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "@pmt/shared";

const message = z.object({
  to: z.string(),
  subject: z.string(),
  text: z.string(),
});
type Message = z.infer<typeof message>;

function key() {
  const encoded = process.env.IDENTITY_MAIL_KEY ?? "";
  if (!/^[a-f0-9]{64}$/i.test(encoded))
    throw new Error("IDENTITY_MAIL_KEY must be a 32-byte hex key");
  return Buffer.from(encoded, "hex");
}

export function sealIdentityMail(value: Message) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return {
    sealed: Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
      "base64url",
    ),
  };
}

export function openMailPayload(value: unknown): Message {
  const envelope = z.object({ sealed: z.string() }).safeParse(value);
  if (!envelope.success) return message.parse(value);
  const bytes = Buffer.from(envelope.data.sealed, "base64url");
  if (bytes.length < 29) throw new Error("Invalid email envelope");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    bytes.subarray(0, 12),
  );
  decipher.setAuthTag(bytes.subarray(12, 28));
  const plaintext = Buffer.concat([
    decipher.update(bytes.subarray(28)),
    decipher.final(),
  ]);
  return message.parse(JSON.parse(plaintext.toString("utf8")));
}
