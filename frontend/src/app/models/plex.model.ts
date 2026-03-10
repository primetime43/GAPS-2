export interface PlexAuthResponse {
  oauth_url: string;
}

export interface PlexServersResponse {
  servers: string[];
  token: string;
}

export interface PlexLibrary {
  title: string;
  type: string;  // 'movie', 'show', 'artist', 'photo'
}

export interface ActiveServerResponse {
  server: string;
  token: string;
  libraries: PlexLibrary[];
}
