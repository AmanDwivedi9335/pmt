export function matchesAttachmentSignature(mimeType: string, bytes: Buffer) {
  switch (mimeType) {
    case "application/pdf":
      return bytes.subarray(0, 5).toString() === "%PDF-";
    case "image/png":
      return bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a";
    case "image/jpeg":
      return bytes.subarray(0, 3).toString("hex") === "ffd8ff";
    case "image/webp":
      return (
        bytes.subarray(0, 4).toString() === "RIFF" &&
        bytes.subarray(8, 12).toString() === "WEBP"
      );
    case "video/mp4":
    case "video/quicktime":
      return bytes.length >= 16 && bytes.subarray(4, 8).toString() === "ftyp";
    case "video/webm":
      return (
        bytes.subarray(0, 4).toString("hex") === "1a45dfa3" &&
        bytes
          .subarray(4, 64)
          .includes(Buffer.from([0x42, 0x82, 0x84, 0x77, 0x65, 0x62, 0x6d]))
      );
    default:
      return false;
  }
}
