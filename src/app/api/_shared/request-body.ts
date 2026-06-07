import { LIMIT_MESSAGES, REQUEST_BYTES_MAX } from "@/shared";

export type JsonRequestResult =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly response: Response };

export async function parseJsonRequest(request: Request): Promise<JsonRequestResult> {
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const byteLength = Number(contentLength);
    if (Number.isFinite(byteLength) && byteLength > REQUEST_BYTES_MAX) {
      return { ok: false, response: invalidRequestResponse(LIMIT_MESSAGES.requestBytes) };
    }
  }

  const value = await request.json().catch(() => null);
  return { ok: true, value };
}

export function invalidRequestResponse(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}
