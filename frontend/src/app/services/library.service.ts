import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { Movie } from '../models/movie.model';
import { Show } from '../models/show.model';

@Injectable({
  providedIn: 'root'
})
export class LibraryService {

  constructor(private http: HttpClient) {}

  getMovies(libraryName: string, source: string = 'plex'): Observable<{ movies: Movie[] }> {
    const params = new HttpParams()
      .set('library_name', libraryName)
      .set('source', source);
    return this.http.get<{ movies: Movie[] }>(`${environment.apiUrl}/libraries/movies`, { params });
  }

  getShows(libraryName: string, source: string = 'plex'): Observable<{ shows: Show[] }> {
    const params = new HttpParams()
      .set('library_name', libraryName)
      .set('source', source);
    return this.http.get<{ shows: Show[] }>(`${environment.apiUrl}/libraries/shows`, { params });
  }
}
