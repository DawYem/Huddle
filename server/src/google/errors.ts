export class UpstreamError extends Error {
  constructor(
    public service: string,
    public status: number,
    public detail: string,
  ) {
    super(`${service} returned ${status}: ${detail}`);
  }
}

export async function readError(res: Response): Promise<string> {
  try {
    // Google nests the message under `error`; Photon's Spectrum API puts it at the top.
    const body = (await res.json()) as { error?: { message?: string }; message?: string };
    return body.error?.message ?? body.message ?? res.statusText;
  } catch {
    return res.statusText;
  }
}
