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

/**
 * Fuller profile for the selected actor, shown as a header above their gaps.
 * Sourced from the same /person call that returns the filmography, so it costs
 * no extra TMDB request.
 */
export interface PersonDetails {
  id: number;
  name: string;
  profileUrl: string | null;
  biography: string;
  birthday: string | null;
  deathday: string | null;
  placeOfBirth: string | null;
  knownForDepartment: string | null;
  imdbId: string | null;
}
