export interface QbitOptions {
  baseUrl: string;
  username: string;
  password: string;
  category?: string;
  savePath?: string;
  fetch?: typeof fetch;
}

export interface QbitAddOptions {
  magnet: string;
  category?: string;
  savePath?: string;
}

export interface QbitClient {
  test(): Promise<{ ok: boolean; error?: string; status?: number }>;
  add(opts: QbitAddOptions): Promise<{ ok: boolean; error?: string; status?: number }>;
}
