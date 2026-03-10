import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { Movie } from '../models/movie.model';

@Injectable({
  providedIn: 'root'
})
export class LibraryService {

  constructor(private http: HttpClient) {}

  getMovies(libraryName: string): Observable<{ movies: Movie[] }> {
    const params = new HttpParams().set('library_name', libraryName);
    return this.http.get<{ movies: Movie[] }>(`${environment.apiUrl}/libraries/movies`, { params });
  }
}
