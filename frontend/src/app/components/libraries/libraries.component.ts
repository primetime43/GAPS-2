import { Component, OnInit } from '@angular/core';
import { PlexService } from '../../services/plex.service';
import { LibraryService } from '../../services/library.service';
import { Movie } from '../../models/movie.model';
import { ActiveServerResponse } from '../../models/plex.model';

@Component({
    selector: 'app-libraries',
    templateUrl: './libraries.component.html',
    styleUrls: ['./libraries.component.scss'],
    standalone: false
})
export class LibrariesComponent implements OnInit {
  serverName = '';
  libraries: string[] = [];
  movies: Movie[] = [];
  filteredMovies: Movie[] = [];
  selectedLibrary = '';
  searchTerm = '';
  loading = true;
  loadingMovies = false;
  hasServer = false;
  errorMessage = '';

  constructor(
    private plexService: PlexService,
    private libraryService: LibraryService
  ) {}

  ngOnInit(): void {
    this.plexService.getActiveServer().subscribe({
      next: (res: ActiveServerResponse) => {
        if (res && res.server) {
          this.hasServer = true;
          this.serverName = res.server;
          this.libraries = res.libraries ? Object.keys(res.libraries) : [];
        }
        this.loading = false;
      },
      error: () => {
        this.hasServer = false;
        this.loading = false;
      }
    });
  }

  selectLibrary(name: string): void {
    this.selectedLibrary = name;
    this.loadingMovies = true;
    this.movies = [];
    this.filteredMovies = [];
    this.searchTerm = '';
    this.errorMessage = '';

    this.libraryService.getMovies(name).subscribe({
      next: (res: any) => {
        this.movies = Array.isArray(res) ? res : (res.movies || []);
        this.filteredMovies = [...this.movies];
        this.loadingMovies = false;
      },
      error: (err) => {
        this.errorMessage = 'Failed to load movies.';
        this.loadingMovies = false;
      }
    });
  }

  filterMovies(): void {
    const term = this.searchTerm.toLowerCase();
    this.filteredMovies = this.movies.filter(m =>
      m.name.toLowerCase().includes(term)
    );
  }

  clearSelection(): void {
    this.selectedLibrary = '';
    this.movies = [];
    this.filteredMovies = [];
    this.searchTerm = '';
  }
}
