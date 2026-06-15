/**
 * A person (actor/actress) returned by the TMDB people search, used to pick
 * whose filmography to find gaps for (issue #49).
 */
export interface PersonResult {
  id: number;            // TMDB person id
  name: string;
  profileUrl: string | null;
  knownFor: string;      // short comma list of the person's best-known titles
}
