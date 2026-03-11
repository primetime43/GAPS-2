export { MediaLibrary as PlexLibrary, ActiveServerResponse } from './media-server.model';

export interface PlexAuthResponse {
  oauth_url: string;
}

export interface PlexServersResponse {
  servers: string[];
  token: string;
}
