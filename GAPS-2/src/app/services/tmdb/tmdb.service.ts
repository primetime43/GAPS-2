import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class TmdbService {
  private apiKey!: string;

  constructor() { }

  setApiKey(key: string): void {
    this.apiKey = key;
  }

  getApiKey(): string {
    return this.apiKey;
  }
}
