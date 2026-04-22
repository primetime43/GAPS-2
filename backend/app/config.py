import os


def _cors_origins(default: str) -> list[str]:
    """Parse GAPS_CORS_ORIGINS env var (comma-separated) or fall back to default."""
    raw = os.environ.get('GAPS_CORS_ORIGINS', default)
    return [o.strip() for o in raw.split(',') if o.strip()]


class BaseConfig:
    TMDB_BASE_URL = "https://api.themoviedb.org/3"
    TMDB_IMAGE_BASE_URL = "https://image.tmdb.org/t/p/w500"

    RESPONSE_MESSAGES = {
        "api_key_success": "API key is working!",
        "api_key_failure": "Failed to connect to API, status code: ",
        "data_not_found": "Data not found",
        "plex_account_error": "Could not log in to Plex account",
        "plex_data_not_found": "PlexAccountData not found",
        "server_not_found": "Server not found",
        "server_resource_not_found": "Server resource not found",
        "invalid_token": "Invalid token",
        "api_key_saved": "Successfully saved API key",
    }


class DevelopmentConfig(BaseConfig):
    DEBUG = True
    CORS_ORIGINS = _cors_origins("http://localhost:4200")


class ProductionConfig(BaseConfig):
    DEBUG = False
    CORS_ORIGINS = _cors_origins("*")
