export interface MediaLibrary {
  title: string;
  type: string;  // 'movie', 'show', 'artist', 'photo'
}

export interface ActiveServerResponse {
  server: string;
  token: string;
  libraries: MediaLibrary[];
}
