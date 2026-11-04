export async function readApiResponse(response: Response) {
  let result: any;
  try {
    result = await response.json();
  } catch {
    throw new Error(
      response.status >= 500
        ? "The API is unavailable. Start both servers with pnpm dev, then reload the portal."
        : "Unexpected server response. Open the portal using the APP_ORIGIN URL configured in .env.",
    );
  }
  if (!response.ok) {
    const fields = result.error?.fields?.fieldErrors;
    const details = fields
      ? Object.entries(fields)
          .map(
            ([name, messages]) =>
              `${name}: ${(messages as string[]).join(", ")}`,
          )
          .join("; ")
      : "";
    throw new Error(details || result.error?.message || "Request failed");
  }
  return result;
}
