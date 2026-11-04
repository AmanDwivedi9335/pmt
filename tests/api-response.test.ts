import { it, expect } from "vitest";
import { readApiResponse } from "../apps/web/lib/api-response";
it("reports backend availability when a proxy returns HTML or an empty failure", async () => {
  await expect(
    readApiResponse(new Response("Bad gateway", { status: 502 })),
  ).rejects.toThrow("Start both servers");
});
it("preserves the actual invalid-credentials error from a reachable API", async () => {
  await expect(
    readApiResponse(
      Response.json(
        { error: { message: "Email or password is incorrect" } },
        { status: 401 },
      ),
    ),
  ).rejects.toThrow("Email or password is incorrect");
});
it("returns successful JSON and actionable field validation", async () => {
  expect(await readApiResponse(Response.json({ ok: true }))).toEqual({
    ok: true,
  });
  await expect(
    readApiResponse(
      Response.json(
        {
          error: {
            message: "Validation failed",
            fields: { fieldErrors: { email: ["Invalid email"] } },
          },
        },
        { status: 400 },
      ),
    ),
  ).rejects.toThrow("email: Invalid email");
});
