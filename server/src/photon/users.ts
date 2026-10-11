import { readError, UpstreamError } from '../google/errors.js';

// Spectrum API: https://photon.codes/docs/api-reference/users/create-user
const BASE = 'https://spectrum.photon.codes';
const TIMEOUT_MS = 8000;

export interface SpectrumCredentials {
  projectId: string;
  projectSecret: string;
  // "shared" on Free/Pro (Photon assigns a pool number), "dedicated" on Business.
  userType: 'shared' | 'dedicated';
  // Required for dedicated users: the project's own iMessage line.
  dedicatedLine?: string;
}

export interface SpectrumUserInput {
  phoneNumber: string; // E.164
  firstName: string;
  lastName: string;
  email: string;
}

export interface SpectrumUser {
  id: string;
  // The Huddle number this fan texts.
  assignedPhoneNumber: string;
}

export type RegisterSpectrumUser = (input: SpectrumUserInput) => Promise<SpectrumUser>;

// Adds the fan to the project's Users list in the Photon dashboard. On the
// shared plan Photon only delivers to registered users, so this is what lets
// the agent text them. Re-sending the same phone number updates that user.
export function spectrumUsers(creds: SpectrumCredentials, fetchFn: typeof fetch = fetch): RegisterSpectrumUser {
  const auth = `Basic ${Buffer.from(`${creds.projectId}:${creds.projectSecret}`).toString('base64')}`;

  return async (input) => {
    const body =
      creds.userType === 'dedicated'
        ? { type: 'dedicated', assignedPhoneNumber: creds.dedicatedLine, ...input }
        : { type: 'shared', ...input };

    const res = await fetchFn(`${BASE}/projects/${encodeURIComponent(creds.projectId)}/users/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new UpstreamError('Spectrum API', res.status, await readError(res));

    const { data } = (await res.json()) as { data: SpectrumUser };
    return { id: data.id, assignedPhoneNumber: data.assignedPhoneNumber };
  };
}
