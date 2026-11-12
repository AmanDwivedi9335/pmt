import { expect, it } from "vitest";
import { matchesAttachmentSignature } from "../apps/api/src/attachment-signatures";

it("recognizes supported video headers and rejects an image renamed as a video", () => {
  const mp4 = Buffer.from("000000186674797069736f6d00000200", "hex");
  const mov = Buffer.from("00000014667479707174202000000000", "hex");
  const webm = Buffer.from("1a45dfa39f4286810142f781014282847765626d", "hex");
  const matroska = Buffer.from("1a45dfa3934282886d6174726f736b61", "hex");
  const png = Buffer.from("89504e470d0a1a0a", "hex");
  expect(matchesAttachmentSignature("video/mp4", mp4)).toBe(true);
  expect(matchesAttachmentSignature("video/quicktime", mov)).toBe(true);
  expect(matchesAttachmentSignature("video/webm", webm)).toBe(true);
  expect(matchesAttachmentSignature("video/webm", matroska)).toBe(false);
  expect(matchesAttachmentSignature("video/mp4", png)).toBe(false);
});
