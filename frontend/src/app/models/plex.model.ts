export interface PlexAuthResponse {
  oauth_url: string;
}

export interface PlexServersResponse {
  servers: string[];
  token: string;
}

export interface ActiveServerResponse {
  server: string;
  token: string;
  libraries: Record<string, string[]>;
}
