import { Component, OnInit } from '@angular/core';
import { PlexService } from '../../services/plex.service';
import { LibraryService } from '../../services/library.service';
import { RecommendationService } from '../../services/recommendation.service';
import { TmdbService } from '../../services/tmdb/tmdb.service';
import { Movie } from '../../models/movie.model';
import { Recommendation } from '../../models/recommendation.model';
import { ActiveServerResponse, PlexLibrary } from '../../models/plex.model';

@Component({
    selector: 'app-recommended',
    templateUrl: './recommended.component.html',
    styleUrls: ['./recommended.component.scss'],
    standalone: false
})
export class RecommendedComponent implements OnInit {
  libraries: PlexLibrary[] = [];
  selectedLibrary = '';
  movies: Movie[] = [];
  filteredMovies: Movie[] = [];
  movieSearchTerm = '';
  recommendations: Recommendation[] = [];
  selectedMovie: Movie | null = null;
  showExisting = false;

  loading = true;
  loadingMovies = false;
  loadingRecommendations = false;
  hasServer = false;
  errorMessage = '';

  constructor(
    private plexService: PlexService,
    private libraryService: LibraryService,
    private recommendationService: RecommendationService,
    private tmdbService: TmdbService
  ) {}

  ngOnInit(): void {
    this.plexService.getActiveServer().subscribe({
      next: (res: ActiveServerResponse) => {
        if (res && res.server) {
          this.hasServer = true;
          this.libraries = Array.isArray(res.libraries)
            ? res.libraries.filter((lib: PlexLibrary) => lib.type === 'movie')
            : [];
        }
        this.loading = false;
      },
      error: () => {
        this.hasServer = false;
        this.loading = false;
      }
    });
  }

  onLibrarySelect(): void {
    if (!this.selectedLibrary) return;
    this.loadingMovies = true;
    this.movies = [];
    this.filteredMovies = [];
    this.recommendations = [];
    this.selectedMovie = null;
    this.movieSearchTerm = '';
    this.errorMessage = '';

    this.libraryService.getMovies(this.selectedLibrary).subscribe({
      next: (res: any) => {
        this.movies = Array.isArray(res) ? res : (res.movies || []);
        this.filteredMovies = [...this.movies];
        this.loadingMovies = false;
      },
      error: () => {
        this.errorMessage = 'Failed to load movies from library.';
        this.loadingMovies = false;
      }
    });
  }

  filterMovies(): void {
    const term = this.movieSearchTerm.toLowerCase();
    this.filteredMovies = this.movies.filter(m =>
      m.name.toLowerCase().includes(term)
    );
  }

  selectMovie(movie: Movie): void {
    if (!movie.tmdbId) {
      this.errorMessage = 'This movie does not have a TMDB ID. Cannot fetch recommendations.';
      return;
    }

    const apiKey = this.tmdbService.getApiKey();
    if (!apiKey) {
      this.errorMessage = 'No TMDB API key configured. Go to Settings > TMDB to add one.';
      return;
    }

    this.selectedMovie = movie;
    this.loadingRecommendations = true;
    this.recommendations = [];
    this.errorMessage = '';

    this.recommendationService.getRecommendations(
      movie.tmdbId,
      apiKey,
      this.selectedLibrary,
      this.showExisting
    ).subscribe({
      next: (recs) => {
        this.recommendations = recs;
        this.loadingRecommendations = false;
      },
      error: () => {
        this.errorMessage = 'Failed to load recommendations.';
        this.loadingRecommendations = false;
      }
    });
  }

  refreshRecommendations(): void {
    if (this.selectedMovie) {
      this.selectMovie(this.selectedMovie);
    }
  }

  clearMovie(): void {
    this.selectedMovie = null;
    this.recommendations = [];
    this.errorMessage = '';
  }
}
