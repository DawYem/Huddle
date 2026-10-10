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
    const body = (await res.json()) as { error?: { message?: string } };
    return body.error?.message ?? res.statusText;
  } catch {
    return res.statusText;
  }
}
