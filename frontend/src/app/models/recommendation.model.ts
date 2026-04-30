export interface CollectionGap {
  tmdbId: number;
  name: string;
  year: string;
  releaseDate?: string;
  posterUrl: string | null;
  overview: string;
  collectionName: string;
  owned: boolean;
}
