export interface ApiMessage {
  message: string;
}

export interface ApiError {
  error: string;
}

export interface ApiResult {
  result: string;
  error?: string;
}
