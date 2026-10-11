// Sends iMessages from a short-lived function (the Vercel API), where the
// long-running agent's connection isn't available. Opens a Spectrum
// connection, sends, and closes it again.
export type SendTexts = (handle: string, texts: string[]) => Promise<void>;

export function spectrumSender(projectId: string, projectSecret: string): SendTexts {
  return async (handle, texts) => {
    // Loaded lazily so the API only pays for Spectrum when it actually texts.
    const { Spectrum } = await import('spectrum-ts');
    const { imessage } = await import('spectrum-ts/providers/imessage');
    const app = await Spectrum({ projectId, projectSecret, providers: [imessage.config()] });
    try {
      const im = imessage(app);
      const space = await im.space.create(await im.user(handle));
      for (const text of texts) await space.send(text);
    } finally {
      await app.stop();
    }
  };
}
